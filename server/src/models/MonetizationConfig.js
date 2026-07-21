const mongoose = require('mongoose');

// Single source of truth for monetization: tier prices/quotas, per-call API
// costs (used only by the projection on the temp config page), model choices,
// the activity curve, processor-fee assumption, and abuse guards.
//
// There is exactly ONE document (singleton). The temp /monetization-config page
// reads and writes it; the usageMeter middleware and billing routes read it.
// Quota value `null` = unlimited. Counters listed in `METERED_ACTIONS` are
// always tracked (incremented) even when their quota is null, so usage stays
// visible for actions we don't currently limit.

// Action keys we still COUNT for analytics (feature-mix / adoption), even though
// enforcement moved to a weekly token budget. The per-action counts are no longer
// caps — `weeklyTokenLimit` (below) is the enforced limit.
const METERED_ACTIONS = ['chat', 'scan', 'generation', 'manualParse', 'aiHelper'];

// `weeklyTokenLimit` is the enforced cap per tier: total Claude tokens (input +
// output + cache read + cache write) a user (free, per-user) or household (paid,
// pooled) may consume per weekly window. `null` = unlimited. `quotas` are retained
// only so the admin analytics keep the per-action breakdown; they no longer cap.
//
// `weeklyCallSecondsLimit` is a SEPARATE enforced cap for assistant phone calls,
// measured in seconds of connected call time per weekly window (same scope model:
// per-user on free, pooled on paid). Phone calls are billed by Vapi per-minute
// (STT + TTS + telephony dominate; the LLM tokens are a rounding error), so they
// draw down this seconds budget rather than the token budget. `null` = unlimited.
function tier(label, price, quotas, weeklyTokenLimit, weeklyCallSecondsLimit) {
  return { label, price, quotas, weeklyTokenLimit, weeklyCallSecondsLimit };
}

// Prices are USD. The App Store base prices are CAD 5.99/12.99, which Apple
// maps to 3.99/9.99 on the US storefront; this field is only a fallback
// display (the paywall shows StoreKit's localized price whenever packages
// load). Weekly token limits are seeded from today's per-action quotas ×
// typical tokens per action; tune against real usage once token metering has
// run for a week.
const DEFAULTS = {
  // weeklyCallSecondsLimit is the 5th tier() arg. At Vapi's measured ~$0.082/min
  // (~$0.00137/sec) these seed to roughly: free 2 min (~$0.16/wk), premium 15 min
  // (~$1.23/wk), unlimited 60 min (~$4.90/wk). Tune in the admin config against
  // real margins — these are starting points, not fixed policy.
  tiers: {
    free:      tier('Free',       0,     { chat: 15,  scan: 15,  generation: 5,    manualParse: 1,  aiHelper: null }, 150000,  120),
    premium:   tier('Premium',    3.99,  { chat: 200, scan: 200, generation: 60,   manualParse: 10, aiHelper: null }, 2000000, 900),
    unlimited: tier('Unlimited',  9.99,  { chat: 600, scan: 600, generation: null, manualParse: 30, aiHelper: null }, null,    3600),
  },
  // $ per call — projection inputs only; not used for billing.
  costs: {
    sonnetChat:  0.03,
    haikuChat:   0.01,
    scan:        0.015,
    generation:  0.012,
    manualParse: 0.15,
    mapsMonthly: 0.10,
  },
  models: {
    freeChat: 'claude-haiku-4-5-20251001',
    paidChat: 'claude-sonnet-4-6',
  },
  // Calls per household per month, used by the projection.
  activity: {
    heavyMonths: 2,
    heavy: {
      free:      { chat: 15,  scan: 15,  generation: 5,  manualParse: 1 },
      premium:   { chat: 60,  scan: 80,  generation: 30, manualParse: 5 },
      unlimited: { chat: 150, scan: 200, generation: 60, manualParse: 15 },
    },
    steady: {
      free:      { chat: 5,  scan: 2,  generation: 2,  manualParse: 0 },
      premium:   { chat: 20, scan: 15, generation: 10, manualParse: 1 },
      unlimited: { chat: 50, scan: 30, generation: 20, manualParse: 2 },
    },
  },
  // Payment-processor fee assumption, used only by the projection on the config
  // page (the mobile app will handle real payments later).
  fees: { pct: 2.9, flat: 0.30 },
  guards: { mapsPerDay: 500 },
  // Admin-account policy. `unlimitedAi: true` exempts users with role 'admin'
  // from the weekly AI token / call-time budgets (internal team + testing);
  // usage is still tracked either way. Flip to false in the admin app to meter
  // admins exactly like everyone else. Read by the usageMeter middleware and the
  // billing-status gauge.
  admin: { unlimitedAi: true },
};

const monetizationConfigSchema = new mongoose.Schema(
  {
    // Marker so we can upsert the one-and-only document.
    singleton: { type: String, default: 'config', unique: true, index: true },
    tiers:    { type: mongoose.Schema.Types.Mixed, default: () => DEFAULTS.tiers },
    costs:    { type: mongoose.Schema.Types.Mixed, default: () => DEFAULTS.costs },
    models:   { type: mongoose.Schema.Types.Mixed, default: () => DEFAULTS.models },
    activity: { type: mongoose.Schema.Types.Mixed, default: () => DEFAULTS.activity },
    fees:     { type: mongoose.Schema.Types.Mixed, default: () => DEFAULTS.fees },
    guards:   { type: mongoose.Schema.Types.Mixed, default: () => DEFAULTS.guards },
    admin:    { type: mongoose.Schema.Types.Mixed, default: () => DEFAULTS.admin },
  },
  { timestamps: true, minimize: false }
);

// Fetch the singleton, creating it from defaults on first access. Normalizes
// docs created before the Stripe integration was removed: legacy `stripe`
// {feePct,feeFlat} → `fees` {pct,flat}, and drops any leftover `stripePriceId`.
monetizationConfigSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ singleton: 'config' });
  if (!doc) doc = await this.create({ singleton: 'config' });

  let dirty = false;
  if (!doc.fees && doc.get('stripe')) {
    const legacy = doc.get('stripe');
    doc.fees = { pct: legacy.feePct ?? 2.9, flat: legacy.feeFlat ?? 0.30 };
    doc.set('stripe', undefined, { strict: false });
    doc.markModified('fees');
    dirty = true;
  } else if (!doc.fees) {
    doc.fees = { ...DEFAULTS.fees };
    doc.markModified('fees');
    dirty = true;
  }
  // Backfill the admin-policy section for configs created before it existed.
  if (!doc.admin) {
    doc.admin = { ...DEFAULTS.admin };
    doc.markModified('admin');
    dirty = true;
  }
  if (doc.tiers) {
    for (const key of Object.keys(doc.tiers)) {
      if (doc.tiers[key] && 'stripePriceId' in doc.tiers[key]) {
        delete doc.tiers[key].stripePriceId;
        doc.markModified('tiers');
        dirty = true;
      }
      // Backfill the weekly token limit for configs created before token
      // metering. `null` is a valid value (unlimited), so only fill when absent.
      if (doc.tiers[key] && !('weeklyTokenLimit' in doc.tiers[key])) {
        doc.tiers[key].weeklyTokenLimit = DEFAULTS.tiers[key]?.weeklyTokenLimit ?? null;
        doc.markModified('tiers');
        dirty = true;
      }
      // Backfill the weekly call-seconds limit for configs created before call
      // metering. `null` (unlimited) is valid, so only fill when the key is absent.
      if (doc.tiers[key] && !('weeklyCallSecondsLimit' in doc.tiers[key])) {
        doc.tiers[key].weeklyCallSecondsLimit = DEFAULTS.tiers[key]?.weeklyCallSecondsLimit ?? null;
        doc.markModified('tiers');
        dirty = true;
      }
    }
  }
  if (dirty) await doc.save();

  return doc;
};

const MonetizationConfig = mongoose.model('MonetizationConfig', monetizationConfigSchema);
MonetizationConfig.DEFAULTS = DEFAULTS;
MonetizationConfig.METERED_ACTIONS = METERED_ACTIONS;
MonetizationConfig.TIERS = ['free', 'premium', 'unlimited'];

module.exports = MonetizationConfig;
