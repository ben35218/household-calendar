// Plan management.
//   GET  /api/billing/status        → plan, usage, quotas, tier catalog (any user)
//   POST /api/billing/webhook       → RevenueCat purchase events (no auth; shared secret)
//   POST /api/billing/select {tier} → manual plan override (admin only)
//
// Real consumer payments flow through native in-app purchase (App Store / Play)
// → RevenueCat → the webhook below, which flips the household's plan. The
// `/select` route is kept for admin/manual overrides only.

const express = require('express');
const mongoose = require('mongoose');
const Household = require('../models/Household');
const User = require('../models/User');
const MonetizationConfig = require('../models/MonetizationConfig');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getConfig, currentPeriodKey, nextPeriodResetAt, effectivePeriodUsage, upgradeBaselineUpdate, enforcedTokens } = require('../middleware/usageMeter');

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

// Decide what a webhook event does to a household: the plan change (null = the
// plan itself doesn't change) plus lifecycle-state $set/$unset fragments. Pure —
// exported for tests.
function planUpdateForEvent(event) {
  let plan = null;
  const set = {};
  const unset = {};
  const revoke = () => {
    plan = 'free';
    set.planBillingIssue = false;
    unset.planAutoRenew = 1;
    unset.planExpiresAt = 1;
    unset.planProductId = 1;
  };
  if (event.type === 'EXPIRATION' || event.type === 'SUBSCRIPTION_PAUSED') {
    revoke();
  } else if (event.type === 'CANCELLATION') {
    // CANCELLATION = auto-renew turned off; access continues until EXPIRATION
    // fires. Only a refund (CUSTOMER_SUPPORT) revokes immediately.
    if (event.cancel_reason === 'CUSTOMER_SUPPORT') revoke();
    else set.planAutoRenew = false;
  } else if (event.type === 'BILLING_ISSUE') {
    // Payment failed; the store's grace period governs access, so the plan
    // stays put. EXPIRATION arrives later if recovery fails.
    set.planBillingIssue = true;
  } else {
    // Grant-shaped events (INITIAL_PURCHASE, RENEWAL, PRODUCT_CHANGE,
    // UNCANCELLATION, …) set the entitlement tier. A grant never downgrades,
    // so unrecognized entitlement ids are ignored rather than silently
    // flipping the household to free.
    const tier = tierFromEntitlements(event.entitlement_ids);
    if (tier !== 'free') {
      plan = tier;
      set.planAutoRenew = true;
      set.planBillingIssue = false;
      if (event.expiration_at_ms) set.planExpiresAt = new Date(event.expiration_at_ms);
      if (event.product_id) set.planProductId = event.product_id;
      // Who bought it: the client sets this subscriber attribute just before
      // purchase (all members share one app_user_id, so it's the only signal).
      const purchaser = event.subscriber_attributes?.purchaser_user_id?.value;
      if (purchaser && mongoose.isValidObjectId(purchaser)) set.planPurchasedBy = purchaser;
    }
  }
  return { plan, set, unset };
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

    // Decide the plan change + lifecycle-state updates before requiring
    // app_user_id: events we ignore (e.g. TRANSFER) don't carry one and must
    // not 400 into RC's retry loop.
    const { plan, set, unset } = planUpdateForEvent(event);
    if (!plan && !Object.keys(set).length) {
      return res.json({ ok: true, ignored: event.type });
    }

    const appUserId = event.app_user_id;
    if (!appUserId) return res.status(400).json({ error: 'Missing app_user_id' });

    // app_user_id is the household id (or a household's stored revenueCatId).
    const household = await Household.findOne({
      $or: [{ revenueCatId: appUserId }, { _id: appUserId }],
    }).catch(() => null);
    if (!household) {
      // Acknowledge so RevenueCat doesn't retry forever for unknown users.
      return res.json({ ok: true, matched: false });
    }

    const update = {
      $set: {
        ...set,
        revenueCatId: appUserId,
        // Fresh pool on upgrade: baseline the current week's counter when moving up.
        ...(plan ? { plan, ...upgradeBaselineUpdate(household, plan) } : {}),
      },
    };
    if (Object.keys(unset).length) update.$unset = unset;
    await Household.updateOne({ _id: household._id }, update);
    res.json({ ok: true, plan: plan ?? household.plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(requireAuth);

router.get('/status', async (req, res) => {
  try {
    const config = await getConfig();
    const plan = req.household?.plan || 'free';
    const period = currentPeriodKey();
    const tiers = config.tiers || {};
    // Free-tier quotas are per-user; paid tiers share a household pool. Report the
    // counter that's actually enforced so the usage bars match what the user hits.
    const perUser = plan === 'free';
    const usage = perUser
      ? (req.user?.usage?.[period] || {})
      : effectivePeriodUsage(req.household, period);

    // Token budget is the enforced metric. Report used / limit / % for the gauge.
    const weeklyTokenLimit = tiers[plan]?.weeklyTokenLimit ?? null;
    const tokensUsed = enforcedTokens(req, period);
    const tokenPct = weeklyTokenLimit
      ? Math.min(100, Math.round((tokensUsed / weeklyTokenLimit) * 100))
      : 0;

    // Subscription lifecycle (paid plans only): renewal/cancellation/billing
    // state maintained by the RevenueCat webhook, plus who bought it.
    let subscription;
    if (plan !== 'free' && req.household) {
      const h = req.household;
      let managedBy = null;
      if (h.planPurchasedBy) {
        const buyer = await User.findById(h.planPurchasedBy)
          .select('firstName lastName')
          .catch(() => null);
        if (buyer) managedBy = { userId: buyer._id, name: buyer.name };
      }
      subscription = {
        autoRenew: h.planAutoRenew ?? null, // null = unknown (predates lifecycle tracking)
        expiresAt: h.planExpiresAt ? h.planExpiresAt.toISOString() : null,
        billingIssue: Boolean(h.planBillingIssue),
        productId: h.planProductId ?? null,
        managedBy,
      };
    }

    // Per-member token usage for the shared pool (paid plans). Per-user counters
    // aren't baselined at a mid-week upgrade (only the household pool is), so
    // these are relative shares, not a reconciliation against tokensUsed.
    let members;
    if (!perUser && req.household) {
      const users = await User.find({ householdId: req.household._id })
        .select('firstName lastName usageTokens');
      members = users
        .map((u) => ({
          userId: u._id,
          name: u.name,
          tokens: u.usageTokens?.[period]?.tokens || 0,
        }))
        .sort((a, b) => b.tokens - a.tokens);
    }

    res.json({
      plan,
      planLabel: tiers[plan]?.label || plan,
      // Token budget (primary — drives the Plan view gauge).
      tokensUsed,
      weeklyTokenLimit,     // null = unlimited
      tokenPct,             // 0–100 (0 when unlimited)
      // Per-action counts (analytics / legacy usage list).
      usage,
      usageScope: perUser ? 'user' : 'household',
      quotas: tiers[plan]?.quotas || {},
      resetsAt: nextPeriodResetAt().toISOString(),
      models: config.models || {},
      hasHousehold: Boolean(req.household),
      ...(subscription ? { subscription } : {}),
      ...(members ? { members } : {}),
      catalog: MonetizationConfig.TIERS.map((key) => ({
        key,
        label: tiers[key]?.label || key,
        price: tiers[key]?.price ?? 0,
        quotas: tiers[key]?.quotas || {},
        weeklyTokenLimit: tiers[key]?.weeklyTokenLimit ?? null,
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
    await Household.updateOne(
      { _id: req.household._id },
      { $set: { plan: tier, ...upgradeBaselineUpdate(req.household, tier) } }
    );
    res.json({ plan: tier });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.planUpdateForEvent = planUpdateForEvent;
