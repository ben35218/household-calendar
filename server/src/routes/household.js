const express = require('express');
const User = require('../models/User');
const Household = require('../models/Household');
const HouseholdKeyEnvelope = require('../models/HouseholdKeyEnvelope');
const JoinRequest = require('../models/JoinRequest');
const HouseholdInvitation = require('../models/HouseholdInvitation');
const AuditLog = require('../models/AuditLog');
const { requireAuth } = require('../middleware/auth');
const { sendHouseholdInvitation } = require('../services/mailer');
const { resolveShareTarget } = require('../services/phone');
const { rateLimit } = require('../middleware/rateLimit');
const { dedupeCategoriesForScope } = require('../services/dedupeCategories');
const { validateHDKEnvelope, validateRotation, pickRecordEnc } = require('../services/householdKey');
const { computeReadiness, DROP_FIELDS } = require('../services/dropReadiness');
const { e2eeRequired } = require('../services/e2eePolicy');
const { dropPlaintext } = require('../scripts/dropPlaintext');
const { CONTENT_MODELS } = require('../services/contentModels');
const { sharedTripIds, excludeSharedFilter } = require('../services/tripSharing');
const { outsideSharedCalendarKeys, excludeOutsideCalendarFilter } = require('../services/calendarSharing');
const CustomCalendar = require('../models/CustomCalendar');

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
// ownership to a remaining member if the departing user was the owner, and flag
// a key rotation so the departed member can't read future writes (§5.2). The
// departed member's stale envelopes are dropped — they're no longer a member.
async function handleDeparture(householdId, departedUserId) {
  if (!householdId) return;
  const members = await User.find({ householdId }, '_id').sort('createdAt').lean();
  if (!members.length) {
    await Household.deleteOne({ _id: householdId });
    await HouseholdKeyEnvelope.deleteMany({ householdId });
    return;
  }
  const hh = await Household.findById(householdId);
  const update = {};
  if (hh && String(hh.ownerId) === String(departedUserId)) update.ownerId = members[0]._id;
  // Only rotate a household that actually has a key; a keyless one has nothing to
  // protect yet (its v1 mint will simply exclude the departed member).
  if (hh && (hh.currentKeyVersion || 0) >= 1) update.keyRotationPending = true;
  if (Object.keys(update).length) await Household.updateOne({ _id: householdId }, { $set: update });
  await HouseholdKeyEnvelope.deleteMany({ householdId, userId: departedUserId });
}

// Current household + members.
router.get('/', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const members = await membersOf(req.household._id);
    res.json({
      _id: req.household._id,
      name: req.household.name,
      ownerId: req.household.ownerId,
      isOwner: String(req.household.ownerId) === String(req.user._id),
      e2eeActive: !!req.household.e2eeActive,
      members,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// §9 drop readiness gate (read-only): is every member enrolled + holding a
// current-version key envelope? Powers the household-wide readiness checklist
// before the plaintext drop. See docs/E2EE-SYNC-PLAN.md §9.2.
router.get('/e2ee/readiness', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const [members, envelopes] = await Promise.all([
      User.find({ householdId: req.household._id }).select('email identityPublicKey clientVersion clientPlatform').lean(),
      HouseholdKeyEnvelope.find({ householdId: req.household._id }).select('userId keyVersion').lean(),
    ]);
    res.json({
      e2eeActive: !!req.household.e2eeActive,
      ...computeReadiness({
        members,
        envelopes,
        currentKeyVersion: req.household.currentKeyVersion,
        minAppVersion: process.env.E2EE_MIN_APP_VERSION || null,
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// §9 straggler re-encrypt pass. Records created before dual-write (or minted
// server-side, e.g. from a template) lack an `enc` blob and would be lost at the
// drop. This returns, per collection, the plaintext content fields of records
// missing ciphertext, so the owner's device can seal them under the current HDK
// and POST them back to /e2ee/seal. Household-scoped; capped per collection.
router.get('/e2ee/stragglers', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const LIMIT = 500;
    const collections = [];
    let total = 0;
    // Shared trips (and their items) stay plaintext for cross-household
    // collaborators, so they're not stragglers — never offer them for sealing.
    // Same for events on outside-shared custom calendars (§9.5).
    const sharedIds = await sharedTripIds(CONTENT_MODELS.Trip, req.scopeIds);
    const sharedCalKeys = await outsideSharedCalendarKeys(CustomCalendar, req.scopeIds);
    for (const [collection, Model] of Object.entries(CONTENT_MODELS)) {
      const fields = DROP_FIELDS[collection];
      if (!fields) continue;
      const projection = fields.reduce((p, f) => ((p[f] = 1), p), { keyVersion: 1 });
      const rows = await Model.find({
        userId: { $in: req.scopeIds },
        ...excludeSharedFilter(collection, sharedIds),
        ...excludeOutsideCalendarFilter(collection, sharedCalKeys),
        $or: [{ enc: { $exists: false } }, { enc: null }],
      }).select(projection).limit(LIMIT).lean();
      if (rows.length) { collections.push({ collection, fields, records: rows }); total += rows.length; }
    }
    res.json({ total, collections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write a client-sealed `enc` blob onto an existing record (the seal step of the
// straggler pass). Content-blind: validates the ciphertext shape + collection
// allowlist + household scope, and sets only enc/keyVersion.
router.post('/e2ee/seal', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const { collection, _id } = req.body || {};
    const Model = CONTENT_MODELS[collection];
    if (!Model) return res.status(400).json({ error: 'unknown collection' });
    let encFields;
    try { encFields = pickRecordEnc(req.body); } catch (msg) { return res.status(400).json({ error: String(msg) }); }
    if (!encFields.enc) return res.status(400).json({ error: 'enc required' });
    const r = await Model.updateOne(
      { _id, userId: { $in: req.scopeIds } },
      { $set: encFields },
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'record not found in your household' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// §9 born-encrypted activation. A brand-new mandated household (typically a solo
// owner who just enrolled → minted HDK → sealed their seeded self-Person) flips
// itself E2EE-live on first login: verify the policy applies, then reuse the
// household-scoped plaintext drop. Idempotent — 'already-active' is success, and
// an exempt/grandfathered household is left for the managed drop instead. The
// client seals any stragglers and retries when this reports 'stragglers'.
router.post('/e2ee/activate', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    if (!e2eeRequired(req.household)) {
      return res.json({ status: 'not-required', e2eeActive: !!req.household.e2eeActive });
    }
    const result = await dropPlaintext(req.household._id, { commit: true });
    const hh = await Household.findById(req.household._id).select('e2eeActive').lean();
    res.json({ ...result, e2eeActive: !!hh?.e2eeActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clients report their app version so the readiness gate can confirm every
// member is on a compatible build before the drop (§9). Idempotent stamp.
router.post('/e2ee/client-version', async (req, res) => {
  try {
    const { version, platform } = req.body || {};
    if (!version) return res.status(400).json({ error: 'version required' });
    await User.updateOne({ _id: req.user._id }, {
      $set: { clientVersion: String(version), clientPlatform: platform || undefined, clientVersionAt: new Date() },
    });
    res.json({ ok: true });
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
      // Signals the client to drive a lazy rotation (§5.2) after unlock.
      keyRotationPending: !!req.household.keyRotationPending,
      // All the caller's envelopes across versions — the client unwraps each so
      // it can still decrypt historical records sealed under an older HDK.
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

// ── Member removal + lazy HDK rotation (Phase 7 / §5.2) ──────────────────────

// The identity public keys of the current household members (those who've
// enrolled), so a rotating member can wrap the new HDK to everyone at once.
router.get('/member-keys', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const members = await User.find(
      { householdId: req.household._id, identityPublicKey: { $exists: true, $ne: null } },
      '_id identityPublicKey',
    ).lean();
    res.json(members.map((m) => ({ userId: m._id, identityPublicKey: m.identityPublicKey })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Owner removes another member: the member is moved to a fresh solo household
// (their own records travel with them, scoped by userId) and this household is
// flagged for rotation via handleDeparture so the removed member can't read
// future writes. The owner cannot remove themselves — they use /leave.
router.post('/members/:userId/remove', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    if (String(req.household.ownerId) !== String(req.user._id)) {
      return res.status(403).json({ error: 'Only the household owner can remove members' });
    }
    const targetId = req.params.userId;
    if (String(targetId) === String(req.user._id)) {
      return res.status(400).json({ error: 'Use “leave household” to remove yourself' });
    }
    const target = await User.findOne({ _id: targetId, householdId: req.household._id }, 'firstName');
    if (!target) return res.status(404).json({ error: 'That member is not in your household' });

    const oldId = req.household._id;
    const fresh = await Household.createForOwner(target._id, `${target.firstName}'s Household`);
    await User.updateOne({ _id: target._id }, { $set: { householdId: fresh._id } });
    await JoinRequest.deleteMany({ requesterUserId: target._id, status: 'pending' });
    await handleDeparture(oldId, target._id);
    await AuditLog.create({
      userId: target._id, householdId: oldId, event: 'member_removed', meta: { removedBy: req.user._id },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complete a lazy rotation: a remaining member generated a fresh HDK_vN+1 and
// wrapped it to every current member. We atomically bump currentKeyVersion
// (compare-and-set on version = keyVersion-1, so concurrent rotations can't both
// win), write the new-version envelopes, and clear the pending flag. Old-version
// envelopes are kept — remaining members still read historical records with them.
router.post('/key/rotate', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const current = req.household.currentKeyVersion || 0;
    if (current < 1) return res.status(409).json({ error: 'Household key is not ready yet' });

    const err = validateRotation(req.body);
    if (err) return res.status(400).json({ error: err });
    if (req.body.keyVersion !== current + 1) {
      return res.status(409).json({ error: 'Key version moved — please retry' });
    }

    // The envelopes must cover every current member that can hold a key; refuse a
    // partial rotation that would lock someone out.
    const members = await User.find(
      { householdId: req.household._id, identityPublicKey: { $exists: true, $ne: null } },
      '_id',
    ).lean();
    const provided = new Set(req.body.envelopes.map((e) => String(e.userId)));
    const missing = members.filter((m) => !provided.has(String(m._id)));
    if (missing.length) return res.status(400).json({ error: 'Rotation must cover every enrolled member' });

    // Compare-and-set the version so only one rotation from `current` wins.
    const claimed = await Household.findOneAndUpdate(
      { _id: req.household._id, currentKeyVersion: current },
      { $set: { currentKeyVersion: req.body.keyVersion, keyRotationPending: false } },
    );
    if (!claimed) return res.status(409).json({ error: 'Key already rotated — please retry' });

    await Promise.all(req.body.envelopes.map((e) => HouseholdKeyEnvelope.updateOne(
      { householdId: req.household._id, userId: e.userId, keyVersion: req.body.keyVersion },
      {
        $set: { wrappedHDK: e.wrappedHDK, wrappedByUserId: req.user._id },
        $setOnInsert: { householdId: req.household._id, userId: e.userId, keyVersion: req.body.keyVersion },
      },
      { upsert: true },
    )));
    await AuditLog.create({
      userId: req.user._id, householdId: req.household._id, event: 'hdk_rotated',
      meta: { keyVersion: req.body.keyVersion },
    });
    res.json({ ok: true, keyVersion: req.body.keyVersion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Invite by email (replaces the shared join code) ──────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The invitations addressed to a user: to their account, or (before it's claimed)
// to their email or saved phone. Used by the inbox/accept/decline endpoints.
function addressedToUser(user) {
  const or = [{ toUserId: user._id }];
  if (user.email) or.push({ toEmail: user.email.toLowerCase() });
  if (user.phone) or.push({ toPhone: user.phone });
  return or;
}

// A member invites an email OR phone number to join the household. Creates (or
// refreshes) a HouseholdInvitation; email invites are emailed, phone invites are
// texted from the inviter's own device. The recipient accepts from their
// Invitations inbox, which opens a JoinRequest a member then approves on-device.
router.post('/invitations', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });

    let target;
    try { target = await resolveShareTarget({ email: req.body?.email, phone: req.body?.phone }); }
    catch (msg) { return res.status(400).json({ error: String(msg) }); }
    const { toEmail, toPhone, toUserId, recipient } = target;

    if ((toEmail && toEmail === (req.user.email || '').toLowerCase()) ||
        (toPhone && toPhone === (req.user.phone || ''))) {
      return res.status(400).json({ error: "You can't invite yourself" });
    }
    if (recipient && String(recipient.householdId) === String(req.household._id)) {
      return res.status(400).json({ error: 'That person is already in your household' });
    }

    const fromName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ');
    // One live invitation per (household, address); refresh its sender snapshot
    // and re-open it if a prior one was declined.
    const match = toEmail
      ? { householdId: req.household._id, toEmail }
      : { householdId: req.household._id, toPhone };
    const invitation = await HouseholdInvitation.findOneAndUpdate(
      match,
      {
        $set: {
          fromUserId: req.user._id, fromName, fromEmail: req.user.email,
          householdName: req.household.name, toUserId,
          toEmail: toEmail || undefined, toPhone: toPhone || undefined,
          status: 'pending', respondedAt: null, joinRequestId: null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    // Phone invites carry no email to send — the inviter's device texts them.
    if (toEmail) {
      sendHouseholdInvitation({ toEmail, fromName, householdName: req.household.name, hasAccount: !!recipient });
    }
    res.status(201).json({ invitation, userExists: !!recipient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pending/most-recent invitations this household has sent (members see the list).
router.get('/invitations', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const invitations = await HouseholdInvitation
      .find({ householdId: req.household._id }).sort('-createdAt').lean();
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke a sent invitation (and any pending join request it opened).
router.delete('/invitations/:id', async (req, res) => {
  try {
    if (!req.household) return res.status(404).json({ error: 'No household' });
    const invitation = await HouseholdInvitation.findOneAndDelete({
      _id: req.params.id, householdId: req.household._id,
    });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.joinRequestId) {
      await JoinRequest.deleteOne({ _id: invitation.joinRequestId, status: 'pending' }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Invitations addressed to me, newest first (my Invitations inbox).
router.get('/invitations/mine', async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase();
    const phone = req.user.phone || '';
    const invitations = await HouseholdInvitation
      .find({ $or: addressedToUser(req.user) })
      .sort('-createdAt');
    // Lazily claim email/phone-only invitations sent before this account existed.
    const unclaimed = invitations.filter(
      (i) => !i.toUserId && ((i.toEmail && i.toEmail === email) || (i.toPhone && i.toPhone === phone)),
    );
    if (unclaimed.length) {
      await HouseholdInvitation.updateMany(
        { _id: { $in: unclaimed.map((i) => i._id) } },
        { toUserId: req.user._id },
      );
    }
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept an invitation → open (or refresh) a JoinRequest pinning my public key.
// Membership isn't granted here: a member still approves on-device (wrapping the
// HDK), exactly as before — the invitation just replaced the shared code.
router.post('/invitations/:id/accept', joinLimiter, async (req, res) => {
  try {
    if (!req.user.identityPublicKey) {
      return res.status(400).json({ error: 'Set up your encryption key before joining a household' });
    }
    const invitation = await HouseholdInvitation.findOne({
      _id: req.params.id,
      $or: addressedToUser(req.user),
    });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (String(invitation.householdId) === String(req.user.householdId)) {
      return res.status(400).json({ error: "You're already in this household" });
    }

    // One live request per (requester, target); refresh the pinned public key.
    const request = await JoinRequest.findOneAndUpdate(
      { householdId: invitation.householdId, requesterUserId: req.user._id, status: 'pending' },
      { $set: { requesterPublicKey: req.user.identityPublicKey } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    invitation.toUserId = req.user._id;
    invitation.status = 'accepted';
    invitation.respondedAt = new Date();
    invitation.joinRequestId = request._id;
    await invitation.save();
    res.status(201).json({ status: 'pending', requestId: request._id, name: invitation.householdName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/invitations/:id/decline', async (req, res) => {
  try {
    const invitation = await HouseholdInvitation.findOne({
      _id: req.params.id,
      $or: addressedToUser(req.user),
    });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    // Declining after accepting also withdraws the pending join request.
    if (invitation.joinRequestId) {
      await JoinRequest.deleteOne({ _id: invitation.joinRequestId, status: 'pending' }).catch(() => {});
    }
    invitation.toUserId = req.user._id;
    invitation.status = 'declined';
    invitation.respondedAt = new Date();
    invitation.joinRequestId = null;
    await invitation.save();
    res.json({ invitation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Approve-on-device join ──────────────────────────────────────────────────

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
    const requester = await User.findById(
      request.requesterUserId,
      'identityPublicKey householdId',
    );
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
    await User.updateOne(
      { _id: requester._id },
      { $set: { householdId: req.household._id } },
    );
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
    // The invitation has done its job — clear it from both inboxes.
    await HouseholdInvitation.deleteMany({
      householdId: req.household._id, toUserId: requester._id,
    }).catch(() => {});
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
    const request = await JoinRequest.findOneAndUpdate(
      { _id: req.params.id, householdId: req.household._id, status: 'pending' },
      { $set: { status: 'rejected', resolvedByUserId: req.user._id } },
    );
    if (!request) return res.status(404).json({ error: 'No pending request found' });
    // Retire the invitation the reject answers, so the person sees it was declined.
    await HouseholdInvitation.updateMany(
      { householdId: req.household._id, toUserId: request.requesterUserId, status: 'accepted' },
      { $set: { status: 'declined', respondedAt: new Date(), joinRequestId: null } },
    ).catch(() => {});
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
