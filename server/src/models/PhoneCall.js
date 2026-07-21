const mongoose = require('mongoose');

// An outbound AI phone call placed by the calendar assistant (call_business).
// The row is created when the call is queued with Vapi; status/summary are
// refreshed from Vapi lazily on read (GET /api/calls) and whenever the chat's
// check_call_status tool runs. `seenAt` drives the unseen-result badge on the
// Calen icon: null on a finished call = the user hasn't viewed the outcome yet.
//
// E2EE note: only what already left the device to place the call is stored
// (event title/date/phone travel in the Vapi request); the full transcript is
// NOT persisted — it stays at Vapi and is fetched through on demand.
const schema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Stamped at creation so usage metering can bump the shared household pool
  // without a lookup on each lazy refresh. Absent on legacy/solo rows (then only
  // the per-user counter moves — enough for free-tier enforcement).
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
  callId:  { type: String, required: true, unique: true }, // Vapi call id
  eventId: { type: String },
  eventTitle: String,
  eventDate:  String, // human label, e.g. "July 22, 2026"
  action: { type: String, enum: ['cancel', 'reschedule'], required: true },
  phone:  String,
  // queued/ringing/in-progress → ended (terminal) or failed (terminal).
  status: { type: String, default: 'queued' },
  endedReason:     String,
  summary:         String, // Vapi's post-call outcome summary
  durationSeconds: Number,
  // Vapi's PassFail success evaluation of the call's goal. A 'confirmed'
  // cancel call marks the event cancelled and files an Invitations notice.
  outcome: { type: String, enum: ['confirmed', 'unconfirmed'] },
  // Once the call ends we charge its connected `durationSeconds` against the
  // household's weekly call-time budget exactly once. `metered` guards against
  // double-counting across the lazy status refreshes.
  metered: { type: Boolean, default: false },
  seenAt: Date,
  // When the user dismissed the outcome notice in the Invitations "New" tab
  // (separate from seenAt, which the assistant's Recent-calls card sets).
  acknowledgedAt: Date,
}, { timestamps: true });

schema.index({ userId: 1, createdAt: -1 });

// Vapi statuses that mean the call is finished (successfully or not).
const TERMINAL_STATUSES = ['ended', 'failed'];
schema.statics.isTerminal = (status) => TERMINAL_STATUSES.includes(status);

module.exports = mongoose.model('PhoneCall', schema);
