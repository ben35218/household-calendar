const mongoose = require('mongoose');

// A cross-household calendar-event invitation, addressed by EMAIL. Like shared
// trips (services/tripSharing.js), sharing an event outside the household is a
// deliberate step across the E2EE boundary: the inviting client supplies a
// PLAINTEXT snapshot of the event at invite time, which is what the recipient
// sees (and what the emailed .ics is built from). The source CalendarEvent is
// never touched — accepting creates an independent copy owned by the recipient,
// so the snapshot here is the complete contract between the two households.
const eventInvitationSchema = new mongoose.Schema({
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Display snapshot of the sender, so the recipient's list renders without a
  // populate (and survives the sender later changing their name/email).
  fromName:   String,
  fromEmail:  String,

  toEmail:  { type: String, required: true, lowercase: true, trim: true },
  // Resolved when toEmail matches an account — at send time, or lazily on the
  // recipient's first fetch if they register later.
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

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

  status:      { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  respondedAt: Date,
}, { timestamps: true });

eventInvitationSchema.index({ toEmail: 1, status: 1 });
eventInvitationSchema.index({ toUserId: 1, status: 1 });

module.exports = mongoose.model('EventInvitation', eventInvitationSchema);
