const express = require('express');
const User = require('../models/User');
const Household = require('../models/Household');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { dedupeCategoriesForScope } = require('../services/dedupeCategories');

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

// Join another household by its code. The user's own data automatically becomes
// shared (it's scoped by household membership), so this is the "merge".
router.post('/join', joinLimiter, async (req, res) => {
  try {
    const code = (req.body.joinCode || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'Join code required' });

    const target = await Household.findOne({ joinCode: code });
    if (!target) return res.status(404).json({ error: 'No household found for that code' });
    if (String(target._id) === String(req.user.householdId)) {
      return res.json({ message: 'Already a member', householdId: target._id });
    }

    const oldId = req.user.householdId;
    await User.updateOne({ _id: req.user._id }, { $set: { householdId: target._id } });
    await handleDeparture(oldId, req.user._id);

    // Merge the joiner's categories into the destination household's set so the
    // members' identical default categories don't surface as duplicates. The
    // existing members' copies win (the joiner is excluded from preferred ids).
    const members = await User.find({ householdId: target._id }, '_id').lean();
    const memberIds = members.map((m) => m._id);
    const preferred = memberIds.filter((id) => String(id) !== String(req.user._id));
    await dedupeCategoriesForScope(memberIds, preferred);

    res.json({ message: 'Joined', householdId: target._id, name: target.name });
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
