const mongoose = require('mongoose');
const { randomInt } = require('crypto');

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
  // Monthly AI-action usage counters: { 'YYYY-MM': { chat, scan, generation, manualParse, aiHelper } }.
  // Mixed so we can $inc arbitrary month/action paths without a fixed schema.
  usage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
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
