const mongoose = require('mongoose');

// An outside-household calendar-sharing invitation (mobile Add/Edit Calendar →
// "Outside My Household"). Created when the owner adds an email to a custom
// calendar's `sharedWithOutside`; deleted when the email is removed or the
// calendar is deleted (revoke). Accepting adds the recipient to the calendar's
// `collaborators`, which grants live read access to its events — so unlike an
// event invitation (one-shot plaintext snapshot, §9.4), a shared calendar is an
// ongoing feed and follows the shared-trip plaintext exception (§9.3/§9.5):
// events on an outside-shared calendar stay plaintext.
const calendarInvitationSchema = new mongoose.Schema({
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Display snapshot of the sender, so the recipient's list renders without a
  // populate (and survives the sender later changing their name/email).
  fromName:   String,
  fromEmail:  String,

  // Addressed by EMAIL or by PHONE (exactly one). Phone invites are texted from
  // the owner's own device (no SMTP) and resolve to an account by the saved
  // User.phone; email invites are emailed.
  toEmail:  { type: String, lowercase: true, trim: true },
  toPhone:  { type: String, trim: true },
  // Resolved when toEmail/toPhone matches an account — at send time, or lazily on
  // the recipient's first fetch if they register later.
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // The shared calendar (by client-minted key) + display snapshot.
  calendarKey:  { type: String, required: true },
  calendarName: { type: String, required: true },
  color:        String,
  // What accepting grants (kept in sync when the owner changes it): View Only
  // or Full Access (create/edit/delete events on the calendar).
  access: { type: String, enum: ['view', 'full'], default: 'view' },

  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  respondedAt: Date,
}, { timestamps: true });

calendarInvitationSchema.pre('validate', function () {
  if (!this.toEmail && !this.toPhone) throw new Error('An invitee email or phone number is required');
});

// One live invitation per (calendar, address); partial unique indexes so a
// phone-only invite doesn't collide with an email-only invite on the null field.
calendarInvitationSchema.index(
  { calendarKey: 1, toEmail: 1 },
  { unique: true, partialFilterExpression: { toEmail: { $type: 'string' } } },
);
calendarInvitationSchema.index(
  { calendarKey: 1, toPhone: 1 },
  { unique: true, partialFilterExpression: { toPhone: { $type: 'string' } } },
);
calendarInvitationSchema.index({ toUserId: 1, status: 1 });
calendarInvitationSchema.index({ toEmail: 1 });
calendarInvitationSchema.index({ toPhone: 1 });

module.exports = mongoose.model('CalendarInvitation', calendarInvitationSchema);
