const mongoose = require('mongoose');

// User-submitted reports of objectionable AI-generated content (Apple Guideline
// 1.2: apps with generated content need a way to report it and for us to act).
// Durable so an admin can review and act — not just a fire-and-forget email.
const contentReportSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
  // Which assistant surface produced it (calendar / maintenance / trips / chat).
  surface:     { type: String, default: 'assistant' },
  // The flagged assistant message. Capped — enough to review, not a transcript.
  content:     { type: String, default: '', maxlength: 4000 },
  reason:      { type: String, default: '' },
  status:      { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open', index: true },
}, { timestamps: true });

module.exports = mongoose.model('ContentReport', contentReportSchema);
