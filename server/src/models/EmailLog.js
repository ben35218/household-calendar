const mongoose = require('mongoose');

// Outbound-email history for the admin console. Every services/mailer.js send
// (real, failed, or dry-run) is recorded here so admins can monitor what left
// no-reply@householdcalendar.com. Bodies are NOT stored — recipients can be
// invitees with E2EE households, and subject + kind is enough to monitor
// delivery. Rows are best-effort observability: a logging failure never blocks
// the send it describes.
const emailLogSchema = new mongoose.Schema({
  to:      { type: String, required: true },
  subject: { type: String, required: true },
  // Which template sent it (password_reset, trip_invite, …) — see mailer.js.
  kind:    { type: String, default: 'other' },
  status:  { type: String, required: true, enum: ['sent', 'failed', 'dry'] },
  error:   { type: String },
}, { timestamps: { createdAt: 'at', updatedAt: false } });

emailLogSchema.index({ at: -1 });
emailLogSchema.index({ status: 1, at: -1 });
emailLogSchema.index({ kind: 1, at: -1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
