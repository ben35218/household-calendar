const mongoose = require('mongoose');

// The Household Data Key (HDK), sealed-boxed to one member's identity public key
// — one row per (household, member, keyVersion). The server stores only opaque
// ciphertext: it can neither read the HDK nor produce an envelope itself (that
// requires an unlocked member's session). A member fetches their envelope(s) and
// unwraps with their private key to obtain the HDK. See docs/E2EE-SYNC-PLAN.md §4.2.
const householdKeyEnvelopeSchema = new mongoose.Schema({
  householdId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  keyVersion:     { type: Number, required: true },
  wrappedHDK:     { type: String, required: true },   // b64url sealed box
  // Who wrapped it (owner self-wrap at mint, or the approving member at join).
  wrappedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// One envelope per member per key version; also the lookup for "my envelopes".
householdKeyEnvelopeSchema.index({ householdId: 1, userId: 1, keyVersion: 1 }, { unique: true });

module.exports = mongoose.model('HouseholdKeyEnvelope', householdKeyEnvelopeSchema);
