const mongoose = require('mongoose');
const crypto = require('crypto');

// A cross-household calendar-event invitation, addressed by EMAIL or by PHONE
// (SMS). Like shared trips (services/tripSharing.js), sharing an event outside
// the household is a deliberate step across the E2EE boundary: the inviting
// client supplies a PLAINTEXT snapshot of the event at invite time, which is
// what the recipient sees (and what the emailed .ics is built from). The source
// CalendarEvent is never touched — accepting creates an independent copy owned
// by the recipient, so the snapshot here is the complete contract between the
// two households.
const eventInvitationSchema = new mongoose.Schema({
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Display snapshot of the sender, so the recipient's list renders without a
  // populate (and survives the sender later changing their name/email).
  fromName:   String,
  fromEmail:  String,

  // Exactly one of toEmail/toPhone is set. Phone invites are sent as a text
  // from the organizer's own device (no account resolution — accounts are
  // keyed by email) and carry the public .ics link below.
  toEmail:  { type: String, lowercase: true, trim: true },
  toPhone:  { type: String, trim: true },
  // Resolved when toEmail matches an account — at send time, or lazily on the
  // recipient's first fetch if they register later.
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Capability secret for the public (unauthenticated) .ics download link —
  // the SMS equivalent of the email's .ics attachment.
  shareToken: { type: String, default: () => crypto.randomBytes(16).toString('hex') },

  // The source event (informational — the snapshot below is authoritative).
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'CalendarEvent' },
  event: {
    title:        { type: String, required: true },
    description:  String,
    location:     String,
    url:          String,
    phone:        String,
    startDate:    { type: Date, required: true },
    endDate:      Date,
    allDay:       { type: Boolean, default: true },
    calendarType: { type: String, enum: ['activities', 'appointments'], default: 'activities' },
  },

  // 'left' = the recipient accepted, then later left the event (their copy is
  // deleted but the organizer's invitee list still shows they were invited).
  status:      { type: String, enum: ['pending', 'accepted', 'declined', 'left'], default: 'pending' },
  respondedAt: Date,
  // The recipient's copy created on accept — what a leave (recipient) or a
  // revoke (organizer) deletes.
  acceptedEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'CalendarEvent' },
}, { timestamps: true });

eventInvitationSchema.pre('validate', function () {
  if (!this.toEmail && !this.toPhone) throw new Error('An invitee email or phone number is required');
});

eventInvitationSchema.index({ toEmail: 1, status: 1 });
eventInvitationSchema.index({ toUserId: 1, status: 1 });

module.exports = mongoose.model('EventInvitation', eventInvitationSchema);
