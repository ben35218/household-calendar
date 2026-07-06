const mongoose = require('mongoose');

// A pending request to join a household under E2EE. The join code is only an
// invite handle — it carries no key. The request sits `pending` until an online,
// unlocked member wraps the current HDK to the requester's public key and
// approves it (approve-on-device). Only then is the requester's membership set.
// See docs/E2EE-SYNC-PLAN.md §4.6 / §5.1.
const joinRequestSchema = new mongoose.Schema({
  householdId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  requesterUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The requester's identity public key at request time. Pinned so the approver
  // wraps to (and the human verifies the fingerprint of) exactly this key; the
  // server rejects approval if the live key has since diverged.
  requesterPublicKey: { type: String, required: true },
  status:           { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  resolvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Approvers list their household's pending requests; joiners poll their own.
joinRequestSchema.index({ householdId: 1, status: 1 });
joinRequestSchema.index({ requesterUserId: 1, status: 1 });

module.exports = mongoose.model('JoinRequest', joinRequestSchema);
