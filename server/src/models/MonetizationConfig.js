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

// Action keys we meter. Helper actions are tracked but seeded unlimited (null)
// across every tier per product decision.
const METERED_ACTIONS = ['chat', 'scan', 'generation', 'manualParse', 'aiHelper'];

function tier(label, price, quotas) {
  return { label, price, quotas };
}

// Defaults reflect the agreed plan: Free / Premium ($5.99) / Unlimited ($12.99).
const DEFAULTS = {
  tiers: {
    free:      tier('Free',       0,     { chat: 15,  scan: 15,  generation: 5,    manualParse: 1,  aiHelper: null }),
    premium:   tier('Premium',    5.99,  { chat: 200, scan: 200, generation: 60,   manualParse: 10, aiHelper: null }),
    unlimited: tier('Unlimited',  12.99, { chat: 600, scan: 600, generation: null, manualParse: 30, aiHelper: null }),
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
  if (doc.tiers) {
    for (const key of Object.keys(doc.tiers)) {
      if (doc.tiers[key] && 'stripePriceId' in doc.tiers[key]) {
        delete doc.tiers[key].stripePriceId;
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
