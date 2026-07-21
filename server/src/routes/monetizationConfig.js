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
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { invalidateConfigCache, currentPeriodKey } = require('../middleware/usageMeter');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const EDITABLE = ['tiers', 'costs', 'models', 'activity', 'fees', 'guards', 'admin'];

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

// Households + usage, for the plan-management table. Returns the current-week
// counters plus the full per-period usage history (so the admin UI can show
// trends across weeks) and each household's member count + E2EE state.
router.get('/households', async (_req, res) => {
  try {
    const period = currentPeriodKey();
    const households = await Household.find({}, 'name plan usage e2eeActive createdAt revenueCatId').lean();

    // Member counts for all households in one aggregate.
    const counts = await User.aggregate([
      { $match: { householdId: { $in: households.map((h) => h._id) } } },
      { $group: { _id: '$householdId', n: { $sum: 1 } } },
    ]);
    const countById = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));

    res.json(
      households.map((h) => ({
        _id: h._id,
        name: h.name,
        plan: h.plan || 'free',
        e2eeActive: !!h.e2eeActive,
        memberCount: countById[String(h._id)] || 0,
        createdAt: h.createdAt,
        // Billing source: a RevenueCat mapping means the plan is driven by a
        // real subscription/webhook; otherwise it's a manual admin override.
        revenueCatId: h.revenueCatId || null,
        billingSource: h.revenueCatId ? 'revenuecat' : 'manual',
        usageThisWeek: h.usage?.[period] || {},
        usageHistory: h.usage || {}, // { 'YYYY-MM-DD': { chat, scan, generation, manualParse, aiHelper } }
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Override a household's plan from the admin page. Match by _id.
// Audited (plan_changed) so manual overrides leave a trail.
router.post('/plan', async (req, res) => {
  try {
    const { householdId, plan } = req.body;
    if (!MonetizationConfig.TIERS.includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    if (!householdId) return res.status(400).json({ error: 'householdId is required' });
    const query = { _id: householdId };
    const before = await Household.findOne(query).select('plan').lean();
    const hh = await Household.findOneAndUpdate(query, { $set: { plan } }, { new: true });
    if (!hh) return res.status(404).json({ error: 'Household not found' });
    if (before && before.plan !== plan) {
      await AuditLog.create({
        userId: req.user._id,
        householdId: hh._id,
        event: 'plan_changed',
        meta: { from: before.plan || 'free', to: plan, source: 'admin_override' },
      });
    }
    res.json({ _id: hh._id, name: hh.name, plan: hh.plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
