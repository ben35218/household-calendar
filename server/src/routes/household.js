const express = require('express');
const User = require('../models/User');
const Household = require('../models/Household');
const HouseholdKeyEnvelope = require('../models/HouseholdKeyEnvelope');
const JoinRequest = require('../models/JoinRequest');
const AuditLog = require('../models/AuditLog');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { dedupeCategoriesForScope } = require('../services/dedupeCategories');
const { validateHDKEnvelope } = require('../services/householdKey');

const router = express.Router();
router.use(requireAuth);

// Throttle code-guessing on the join endpoint: a handful of tries per minute is
// plenty for a real invite, but makes brute-force enumeration infeasible.
const joinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many join attempts. Please wait a minute and try again.',
});

async function membersOf(householdId) {
  return User.find({ householdId }, 'firstName lastName email').sort('firstName').lean();
}

// After a member leaves a household: delete it if now empty, otherwise transfer
// ownership to a remaining member if the departing user was the owner.
async function handleDeparture(householdId, departedUserId) {
  if (!householdId) return;
  const members = await User.find({ householdId }, '_id').sort('createdAt').lean();
  if (!members.length) { await Household.deleteOne({ _id: householdId }); return; }
  const hh = await Household.findById(householdId);
  if (hh && String(hh.ownerId) === String(departedUserId)) {
    await Household.updateOne({ _id: householdId }, { $set: { ownerId: members[0]._id } });
  }
}

// Current household + members.
router.get('/', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const members = await membersOf(req.household._id);
    res.json({
      _id: req.household._id,
      name: req.household.name,
      joinCode: req.household.joinCode,
      ownerId: req.household.ownerId,
      isOwner: String(req.household.ownerId) === String(req.user._id),
      e2eeActive: !!req.household.e2eeActive,
      members,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const { name } = req.body;
    if (name) await Household.updateOne({ _id: req.household._id }, { $set: { name } });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── HDK envelopes (approve-to-join key material) ────────────────────────────

// The caller's own HDK envelope(s) for their current household, plus the
// household's current key version. The client unwraps `wrappedHDK` with its
// private key to obtain the HDK. An empty `envelopes` with `currentKeyVersion`
// > 0 means "you're a member but nobody has wrapped the key to you yet" — the
// pending-approval state.
router.get('/key', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const envelopes = await HouseholdKeyEnvelope
      .find({ householdId: req.household._id, userId: req.user._id }, 'keyVersion wrappedHDK')
      .lean();
    res.json({
      householdId: req.household._id,
      currentKeyVersion: req.household.currentKeyVersion || 0,
      isOwner: String(req.household.ownerId) === String(req.user._id),
      envelopes: envelopes.map((e) => ({ keyVersion: e.keyVersion, wrappedHDK: e.wrappedHDK })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner mints HDK v1: self-wrap. Guarded to the owner and to households that
// have no key yet (currentKeyVersion === 0), so the mint is idempotent under a
// race — a second attempt sees version 1 and 409s. See §5 / HDK-minting decision.
router.post('/key', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    if (String(req.household.ownerId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the household owner mints the key' });
    }
    const err = validateHDKEnvelope(req.body);
    if (err) return res.status(400).json({ error: err });
    if (req.body.keyVersion !== 1) return res.status(400).json({ error: 'The initial key must be version 1' });

    // Atomically claim v1: only succeeds while the household is still at 0.
    const claimed = await Household.findOneAndUpdate(
      { _id: req.household._id, currentKeyVersion: 0 },
      { $set: { currentKeyVersion: 1 } },
    );
    if (!claimed) return res.status(409).json({ error: 'Household key already exists' });

    await HouseholdKeyEnvelope.create({
      householdId: req.household._id,
      userId: req.user._id,
      keyVersion: 1,
      wrappedHDK: req.body.wrappedHDK,
      wrappedByUserId: req.user._id,
    });
    await AuditLog.create({
      userId: req.user._id, householdId: req.household._id, event: 'hdk_minted', meta: { keyVersion: 1 },
    });
    res.status(201).json({ keyVersion: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Approve-on-device join ──────────────────────────────────────────────────

// Request to join a household by its invite code. Under E2EE the code carries no
// key — this only opens a pending JoinRequest; membership (and the HDK envelope)
// are granted when an existing member approves on-device. Replaces instant join.
router.post('/join', joinLimiter, async (req, res) => {
  try {
    const code = (req.body.joinCode || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Join code required' });
    if (!req.user.identityPublicKey) {
      return res.status(400).json({ error: 'Set up your encryption key before joining a household' });
    }

    const target = await Household.findOne({ joinCode: code });
    if (!target) return res.status(404).json({ error: 'No household found for that code' });
    if (String(target._id) === String(req.user.householdId)) {
      return res.json({ status: 'member', householdId: target._id });
    }

    // One live request per (requester, target); refresh the pinned public key in
    // case it changed since a prior attempt.
    const request = await JoinRequest.findOneAndUpdate(
      { householdId: target._id, requesterUserId: req.user._id, status: 'pending' },
      { $set: { requesterPublicKey: req.user.identityPublicKey } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ status: 'pending', requestId: request._id, name: target.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The caller's own pending/most-recent join request (joiner polls this while
// waiting for a family member to approve).
router.get('/join-requests/mine', async (req, res) => {
  try {
    const request = await JoinRequest
      .findOne({ requesterUserId: req.user._id })
      .sort('-createdAt')
      .lean();
    if (!request) return res.json({ status: 'none' });
    const target = await Household.findById(request.householdId, 'name').lean();
    res.json({ status: request.status, requestId: request._id, name: target?.name || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel one's own pending request.
router.delete('/join-requests/mine', async (req, res) => {
  try {
    await JoinRequest.deleteMany({ requesterUserId: req.user._id, status: 'pending' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pending requests to join the caller's household (for members to approve). Each
// carries the requester's pinned public key so the client can show a fingerprint
// for out-of-band verification and wrap the HDK to it.
router.get('/join-requests', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const requests = await JoinRequest
      .find({ householdId: req.household._id, status: 'pending' })
      .sort('createdAt')
      .lean();
    const users = await User.find(
      { _id: { $in: requests.map((r) => r.requesterUserId) } },
      'firstName lastName email',
    ).lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    res.json(requests.map((r) => {
      const u = byId.get(String(r.requesterUserId)) || {};
      return {
        _id: r._id,
        requesterUserId: r.requesterUserId,
        requesterPublicKey: r.requesterPublicKey,
        firstName: u.firstName || null,
        lastName: u.lastName || null,
        email: u.email || null,
        createdAt: r.createdAt,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve a pending request: the approving member has wrapped the current HDK to
// the requester's public key (client-side) and posts the envelope here. The
// server writes the HouseholdKeyEnvelope, moves the requester into the household,
// and merges their categories — this is the point membership actually changes.
router.post('/join-requests/:id/approve', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const version = req.household.currentKeyVersion || 0;
    if (version < 1) return res.status(409).json({ error: 'Your household key is not ready yet' });

    const err = validateHDKEnvelope(req.body);
    if (err) return res.status(400).json({ error: err });
    if (req.body.keyVersion !== version) {
      return res.status(409).json({ error: 'Household key version changed — please retry' });
    }

    const request = await JoinRequest.findOne({ _id: req.params.id, status: 'pending' });
    if (!request || String(request.householdId) !== String(req.household._id)) {
      return res.status(404).json({ error: 'No pending request found' });
    }

    // The requester's live key must still match what the approver verified and
    // wrapped to; otherwise the key changed mid-flight and we refuse.
    const requester = await User.findById(request.requesterUserId, 'identityPublicKey householdId');
    if (!requester) return res.status(404).json({ error: 'Requester no longer exists' });
    if (requester.identityPublicKey !== request.requesterPublicKey) {
      return res.status(409).json({ error: 'Requester key changed — ask them to request again' });
    }

    await HouseholdKeyEnvelope.updateOne(
      { householdId: req.household._id, userId: requester._id, keyVersion: version },
      {
        $set: { wrappedHDK: req.body.wrappedHDK, wrappedByUserId: req.user._id },
        $setOnInsert: { householdId: req.household._id, userId: requester._id, keyVersion: version },
      },
      { upsert: true },
    );

    // Move the requester into this household (their own data comes with them) and
    // clean up the household they left.
    const oldId = requester.householdId;
    await User.updateOne({ _id: requester._id }, { $set: { householdId: req.household._id } });
    if (String(oldId) !== String(req.household._id)) await handleDeparture(oldId, requester._id);

    // Merge the joiner's default categories into the destination set so identical
    // defaults don't surface as duplicates (existing members' copies win).
    const members = await User.find({ householdId: req.household._id }, '_id').lean();
    const memberIds = members.map((m) => m._id);
    const preferred = memberIds.filter((id) => String(id) !== String(requester._id));
    await dedupeCategoriesForScope(memberIds, preferred);

    await JoinRequest.updateOne(
      { _id: request._id },
      { $set: { status: 'approved', resolvedByUserId: req.user._id } },
    );
    await AuditLog.create({
      userId: requester._id, householdId: req.household._id, event: 'member_approved',
      meta: { approvedBy: req.user._id, keyVersion: version },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject a pending request.
router.post('/join-requests/:id/reject', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const result = await JoinRequest.updateOne(
      { _id: req.params.id, householdId: req.household._id, status: 'pending' },
      { $set: { status: 'rejected', resolvedByUserId: req.user._id } },
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'No pending request found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leave the current household → start a fresh solo one.
router.post('/leave', async (req, res) => {
  try {
    const oldId = req.user.householdId;
    const fresh = await Household.createForOwner(req.user._id, `${req.user.firstName}'s Household`);
    await User.updateOne({ _id: req.user._id }, { $set: { householdId: fresh._id } });
    if (String(oldId) !== String(fresh._id)) await handleDeparture(oldId, req.user._id);
    res.json({ message: 'Left', householdId: fresh._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
