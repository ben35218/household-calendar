// Plan management.
//   GET  /api/billing/status        → plan, usage, quotas, tier catalog (any user)
//   POST /api/billing/webhook       → RevenueCat purchase events (no auth; shared secret)
//   POST /api/billing/select {tier} → manual plan override (admin only)
//
// Real consumer payments flow through native in-app purchase (App Store / Play)
// → RevenueCat → the webhook below, which flips the household's plan. The
// `/select` route is kept for admin/manual overrides only.

const express = require('express');
const Household = require('../models/Household');
const MonetizationConfig = require('../models/MonetizationConfig');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getConfig, currentMonthKey } = require('../middleware/usageMeter');

const router = express.Router();

// --- RevenueCat webhook (must be BEFORE requireAuth; authenticated by a shared
// secret RevenueCat sends in the Authorization header). ---
//
// Map RevenueCat entitlement identifiers → our plan tiers. Configure the
// matching entitlement ids ('premium', 'unlimited') in the RevenueCat dashboard.
const ENTITLEMENT_TO_TIER = { premium: 'premium', unlimited: 'unlimited' };

// Pick the highest-value active entitlement (unlimited > premium > free).
function tierFromEntitlements(entitlementIds = []) {
  const tiers = entitlementIds.map((e) => ENTITLEMENT_TO_TIER[e]).filter(Boolean);
  if (tiers.includes('unlimited')) return 'unlimited';
  if (tiers.includes('premium')) return 'premium';
  return 'free';
}

router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    const auth = req.headers.authorization || '';
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    if (!secret || provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const event = req.body?.event;
    if (!event) return res.status(400).json({ error: 'Missing event' });

    const appUserId = event.app_user_id;
    if (!appUserId) return res.status(400).json({ error: 'Missing app_user_id' });

    // Active-grant events set the entitlement tier; revocations drop to free.
    const REVOKED = ['CANCELLATION', 'EXPIRATION', 'SUBSCRIPTION_PAUSED'];
    const plan = REVOKED.includes(event.type)
      ? 'free'
      : tierFromEntitlements(event.entitlement_ids);

    // app_user_id is the household id (or a household's stored revenueCatId).
    const household = await Household.findOne({
      $or: [{ revenueCatId: appUserId }, { _id: appUserId }],
    }).catch(() => null);
    if (!household) {
      // Acknowledge so RevenueCat doesn't retry forever for unknown users.
      return res.json({ ok: true, matched: false });
    }

    await Household.updateOne(
      { _id: household._id },
      { $set: { plan, revenueCatId: appUserId } }
    );
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(requireAuth);

router.get('/status', async (req, res) => {
  try {
    const config = await getConfig();
    const plan = req.household?.plan || 'free';
    const month = currentMonthKey();
    const tiers = config.tiers || {};
    res.json({
      plan,
      planLabel: tiers[plan]?.label || plan,
      usage: req.household?.usage?.[month] || {},
      quotas: tiers[plan]?.quotas || {},
      models: config.models || {},
      hasHousehold: Boolean(req.household),
      catalog: MonetizationConfig.TIERS.map((key) => ({
        key,
        label: tiers[key]?.label || key,
        price: tiers[key]?.price ?? 0,
        quotas: tiers[key]?.quotas || {},
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual plan override (admin only). Consumer upgrades flow through the
// RevenueCat webhook above; this is a back-office / testing escape hatch.
router.post('/select', requireAdmin, async (req, res) => {
  try {
    const { tier } = req.body;
    if (!MonetizationConfig.TIERS.includes(tier)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    if (!req.household) {
      return res.status(400).json({ error: 'Join or create a household first' });
    }
    await Household.updateOne({ _id: req.household._id }, { $set: { plan: tier } });
    res.json({ plan: tier });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
