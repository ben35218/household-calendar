const mongoose = require('mongoose');

// A per-trip sharing invitation (mobile Trip → Share → add an email). Created
// when the owner adds an email to a trip's `sharedWithOutside`; deleted when the
// email is removed or the trip is deleted (revoke). Accepting adds the recipient
// to the trip's `collaborators`, which grants live access to the trip and its
// items — the same ongoing-feed model as a shared calendar (CalendarInvitation).
// A shared trip stays plaintext (collaborators hold no household key, §9.3), so
// unlike a household invitation there is no key-wrap approval step: accept =
// access.
const tripInvitationSchema = new mongoose.Schema({
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

  // The shared trip + a display snapshot so the inbox renders without the
  // recipient needing trip access before they accept.
  tripId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
  tripName: { type: String, required: true },
  destination: String,

  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  respondedAt: Date,
}, { timestamps: true });

tripInvitationSchema.pre('validate', function () {
  if (!this.toEmail && !this.toPhone) throw new Error('An invitee email or phone number is required');
});

// One live invitation per (trip, address); partial unique indexes so a
// phone-only invite doesn't collide with an email-only invite on the null field.
tripInvitationSchema.index(
  { tripId: 1, toEmail: 1 },
  { unique: true, partialFilterExpression: { toEmail: { $type: 'string' } } },
);
tripInvitationSchema.index(
  { tripId: 1, toPhone: 1 },
  { unique: true, partialFilterExpression: { toPhone: { $type: 'string' } } },
);
tripInvitationSchema.index({ toUserId: 1, status: 1 });
tripInvitationSchema.index({ toEmail: 1 });
tripInvitationSchema.index({ toPhone: 1 });

module.exports = mongoose.model('TripInvitation', tripInvitationSchema);
