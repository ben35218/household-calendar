const mongoose = require('mongoose');
const { randomInt } = require('crypto');
const { encFields } = require('./encFields');

// Short, unambiguous join code (no 0/O/1/I) used to invite members.
// Uses a CSPRNG so codes aren't predictable from previously issued ones.
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[randomInt(alphabet.length)];
  return s;
}

const householdSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  ownerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  joinCode: { type: String, required: true, unique: true, index: true },
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
  // Shared (household-level) settings — moved off User in Phase 3.
  timezone:           { type: String, default: 'America/Toronto' },
  homeAddress:        { type: String, default: '' },
  lat:                { type: Number },
  lon:                { type: Number },
  groceryShoppingDay: { type: Number, default: 6 },  // 0=Sun…6=Sat
  grocerySections:    { type: [String], default: () => ['Produce', 'Deli', 'Bakery', 'Meat & Seafood', 'Dairy', 'Frozen', 'Pantry', 'Other'] },
  reminderLeadDays:   { type: Number, default: 7 },

  // --- Monetization (plan is per-household) ---
  plan: { type: String, enum: ['free', 'premium', 'unlimited'], default: 'free', index: true },
  // RevenueCat app_user_id this household is mapped to (set at SDK init in the
  // mobile app to the household id; webhooks carry it back to flip `plan`).
  revenueCatId: { type: String, index: true },
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
  // and read from `enc` after the drop. Name/joinCode/plan/timezone stay plaintext.
  ...encFields,
}, { timestamps: true, minimize: false });

// Create a household with a guaranteed-unique join code.
householdSchema.statics.createForOwner = async function createForOwner(ownerId, name) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const joinCode = genCode();
    if (await this.exists({ joinCode })) continue;
    return this.create({ name, ownerId, joinCode });
  }
  throw new Error('Could not generate a unique household join code');
};

module.exports = mongoose.model('Household', householdSchema);
