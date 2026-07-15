const mongoose = require('mongoose');
const { encFields } = require('./encFields');

const householdSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  ownerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Current Household Data Key version. 0 = no HDK minted yet; the owner mints
  // v1 (self-wrapped envelope) on first unlock. Bumped on lazy rotation (Phase 7).
  currentKeyVersion: { type: Number, default: 0 },
  // Set when a member is removed or leaves (§5.2 lazy rotation): the household
  // must mint HDK_vN+1 so the departed member can't read *future* writes. The
  // server can't generate a key, so this is a signal — the next remaining member
  // to unlock (self-healing, like the v1 mint) performs the rotation client-side
  // via POST /household/key/rotate, which clears the flag. Historical records
  // stay at their old version and remain readable by whoever holds that envelope.
  keyRotationPending: { type: Boolean, default: false },
  // Per-household "plaintext is dead" signal. Flips true only at the §9 plaintext
  // drop, after which the server must not create readable content (the client
  // seeds encrypted records instead). Gates Person.ensureSelf + the onboarding
  // self-Person seed. Defaults false → identical pre-drop behavior.
  e2eeActive: { type: Boolean, default: false },
  // Exempts this household from *mandatory* E2EE enforcement. E2EE is required for
  // all new households (they're born encrypted); exempt households — QA/test
  // accounts and the pre-mandate users grandfathered at rollout — may run without
  // it. Independent of e2eeActive (an exempt household can still opt into E2EE).
  // Enforcement also always bypasses when NODE_ENV === 'test'.
  e2eeExempt: { type: Boolean, default: false },
  // Shared (household-level) settings — moved off User in Phase 3.
  timezone:           { type: String, default: 'America/Toronto' },
  homeAddress:        { type: String, default: '' },
  lat:                { type: Number },
  lon:                { type: Number },
  groceryShoppingDay: { type: Number, default: 6 },  // 0=Sun…6=Sat
  // Shopping cadence; for 'biweekly', groceryAnchor (YYYY-MM-DD, any known
  // shopping day) fixes which alternating week is the shopping week.
  groceryFrequency:   { type: String, enum: ['weekly', 'biweekly'], default: 'weekly' },
  groceryAnchor:      { type: String, default: null },
  grocerySections:    { type: [String], default: () => ['Produce', 'Deli', 'Bakery', 'Meat & Seafood', 'Dairy', 'Frozen', 'Pantry', 'Other'] },
  reminderLeadDays:   { type: Number, default: 7 },

  // --- Monetization (plan is per-household) ---
  plan: { type: String, enum: ['free', 'premium', 'unlimited'], default: 'free', index: true },
  // RevenueCat app_user_id this household is mapped to (set at SDK init in the
  // mobile app to the household id; webhooks carry it back to flip `plan`).
  revenueCatId: { type: String, index: true },
  // Subscription lifecycle state, maintained by the RevenueCat webhook. Absent =
  // unknown (household predates these fields or has never had a paid plan).
  planAutoRenew:    { type: Boolean },  // false after CANCELLATION; true again on any grant
  planExpiresAt:    { type: Date },     // current period end (renewal or access-until date)
  planBillingIssue: { type: Boolean, default: false },  // payment failed; store grace period running
  // Which member initiated the purchase. All members share one RevenueCat
  // app_user_id (the household), so only the client-set purchaser_user_id
  // subscriber attribute identifies the buyer.
  planPurchasedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Store product id of the active subscription, so clients can match it to a
  // store package for a localized price string.
  planProductId:    { type: String },
  // Weekly AI-action usage counters: { 'YYYY-MM-DD': { chat, scan, generation, manualParse, aiHelper } }.
  // Mixed so we can $inc arbitrary period/action paths without a fixed schema.
  // This is the RAW counter (never reset mid-week) — it feeds admin analytics and
  // paid-tier enforcement. Enforcement/display subtract `usageBaseline` (below).
  usage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Snapshot of `usage[period]` captured when the household upgraded to a higher
  // paid tier mid-week, so the new pool starts fresh at 0 without discarding the
  // raw counter analytics depends on. Holds only the period an upgrade landed in
  // ({ 'YYYY-MM-DD': { action: count } }); absent/other periods → baseline 0.
  usageBaseline: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Pooled (paid-tier) weekly TOKEN usage — the enforced metric for paid plans:
  // { 'YYYY-MM-DD': { tokens, byAction? } }. Always incremented (even on free) so
  // admin analytics see fleet token totals regardless of tier.
  usageTokens: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Token equivalent of `usageBaseline`: snapshot of usageTokens[period] captured
  // at a mid-week upgrade so the pooled token budget restarts fresh at 0.
  usageTokensBaseline: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Content-blind feature-activity counters for the admin analytics/adoption
  // views: { 'YYYY-MM-DD': { eventCreated, choreCreated, taskCompleted, ... } }.
  // Same shape/keying as `usage` but for non-AI actions; records only that an
  // action happened, never its payload (E2EE-safe). Written by activity().
  activity: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

  // E2EE dual-write ciphertext (§9.1 P5): the home location (homeAddress/lat/lon)
  // is sensitive, so it's sealed here alongside the plaintext during dual-write
  // and read from `enc` after the drop. Name/plan/timezone stay plaintext.
  ...encFields,
}, { timestamps: true, minimize: false });

householdSchema.statics.createForOwner = async function createForOwner(ownerId, name) {
  return this.create({ name, ownerId });
};

module.exports = mongoose.model('Household', householdSchema);
