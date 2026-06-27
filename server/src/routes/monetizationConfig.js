// Admin surface for monetization config. Consumed by the separate admin web app
// and gated to admin users (requireAuth + requireAdmin).
//
//   GET  /api/monetization-config           → full config singleton
//   PUT  /api/monetization-config           → replace editable sections
//   GET  /api/monetization-config/households → list households + plan + usage
//   POST /api/monetization-config/plan       → manually set a household's plan

const express = require('express');
const MonetizationConfig = require('../models/MonetizationConfig');
const Household = require('../models/Household');
const { invalidateConfigCache, currentMonthKey } = require('../middleware/usageMeter');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const EDITABLE = ['tiers', 'costs', 'models', 'activity', 'fees', 'guards'];

router.get('/', async (_req, res) => {
  try {
    const doc = await MonetizationConfig.getSingleton();
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const doc = await MonetizationConfig.getSingleton();
    for (const key of EDITABLE) {
      if (req.body[key] !== undefined) doc[key] = req.body[key];
      doc.markModified(key); // Mixed fields need explicit dirty marking.
    }
    await doc.save();
    invalidateConfigCache();
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Households + current-month usage, for the temp page's plan management table.
router.get('/households', async (_req, res) => {
  try {
    const month = currentMonthKey();
    const households = await Household.find({}, 'name joinCode plan usage').lean();
    res.json(
      households.map((h) => ({
        _id: h._id,
        name: h.name,
        joinCode: h.joinCode,
        plan: h.plan || 'free',
        usageThisMonth: h.usage?.[month] || {},
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Override a household's plan from the admin page. Match by joinCode or _id.
router.post('/plan', async (req, res) => {
  try {
    const { joinCode, householdId, plan } = req.body;
    if (!MonetizationConfig.TIERS.includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    const query = householdId ? { _id: householdId } : { joinCode };
    const hh = await Household.findOneAndUpdate(query, { $set: { plan } }, { new: true });
    if (!hh) return res.status(404).json({ error: 'Household not found' });
    res.json({ _id: hh._id, name: hh.name, joinCode: hh.joinCode, plan: hh.plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
