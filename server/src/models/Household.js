const mongoose = require('mongoose');
const { encFields } = require('./encFields');

const householdSchema = new mongoose.Schema({
  // Content since Signal-parity C2: sealed into the household-settings blob
  // (`enc`, with homeAddress) and nulled at the §9 drop. Admin/support then
  // identify households by id (see the C2 runbook note in the plan doc).
  name:     { type: String },
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
  // When the current HDK version was minted (rotation or v1). Drives B2's
  // periodic-rotation cron (Signal-parity plan): a version older than
  // KEY_ROTATION_INTERVAL_DAYS gets keyRotationPending flagged so the next
  // unlocked member rotates — bounding how much ciphertext any one key covers.
  lastKeyRotationAt: { type: Date },
  // Per-household "plaintext is dead" signal. Flips true only at the §9 plaintext
  // drop, after which the server must not create readable content (the client
  // seeds encrypted records instead). Gates Person.ensureSelf + the onboarding
  // self-Person seed. Defaults false → identical pre-drop behavior.
  e2eeActive: { type: Boolean, default: false },
  // The DROP_FIELDS schema version this household's plaintext was last nulled at
  // (services/dropReadiness.DROP_FIELDS_VERSION). A committed drop stamps the
  // current version; a household dropped under an OLDER version still has the
  // newer content columns in plaintext and must run the re-seal + re-drop
  // backfill (scripts/reDropPlaintext.js). 0 = pre-versioning / never dropped.
  dropFieldsVersion: { type: Number, default: 0 },
  // Shared (household-level) settings — moved off User in Phase 3.
  timezone:           { type: String, default: 'America/Toronto' },
  homeAddress:        { type: String, default: '' },
  lat:                { type: Number },
  lon:                { type: Number },
  // null = no shopping day configured yet. New households start unset so no
  // recurring grocery-shopping marker appears on the calendar until a member
  // picks a day in the grocery schedule.
  groceryShoppingDay: { type: Number, default: null },  // 0=Sun…6=Sat, null=unset
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
  // Pooled (paid-tier) weekly assistant CALL-TIME usage, in connected seconds:
  // { 'YYYY-MM-DD': { seconds } }. Separate budget from tokens (calls are billed
  // per-minute by Vapi). Recorded from the call's duration when it ends.
  usageCallSeconds: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Snapshot of usageCallSeconds[period] at a mid-week upgrade so the pooled
  // call-time budget restarts fresh at 0 (mirrors usageTokensBaseline).
  usageCallSecondsBaseline: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
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
