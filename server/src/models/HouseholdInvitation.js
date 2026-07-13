const mongoose = require('mongoose');

// A household-membership invitation (mobile Household → Invite by email),
// replacing the old shared join code. A member invites an email; the recipient
// sees it in their Invitations inbox and accepts. Because household data is
// encrypted under the HDK — which the server never holds — accepting cannot
// grant access on its own: it opens (or refreshes) the joiner's JoinRequest,
// pinning their identity public key, and an existing member finishes by wrapping
// the HDK to that key on-device (approve-on-device, §5.1). So the invitation
// replaces code-based discovery/authorization while the cryptographic approval
// stays. The link back to the request lets the approval queue show "invited".
const householdInvitationSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  fromUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Display snapshot of the sender + household, so the inbox renders without a
  // populate and survives later renames.
  fromName:      String,
  fromEmail:     String,
  householdName: { type: String, required: true },

  // Addressed by EMAIL or by PHONE (exactly one). Phone invites are texted from
  // the inviter's own device (no SMTP) and resolve to an account by the saved
  // User.phone; email invites are emailed. Either way accepting opens a
  // JoinRequest a member then approves on-device.
  toEmail:  { type: String, lowercase: true, trim: true },
  toPhone:  { type: String, trim: true },
  // Resolved when toEmail/toPhone matches an account — at send time, or lazily on
  // the recipient's first fetch if they register later.
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Set when the recipient accepts: the JoinRequest their acceptance opened, so
  // approving that request can retire this invitation.
  joinRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'JoinRequest' },

  // 'accepted' here only means the joiner asked in (a JoinRequest exists); actual
  // membership is granted when a member approves that request.
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  respondedAt: Date,
}, { timestamps: true });

householdInvitationSchema.pre('validate', function () {
  if (!this.toEmail && !this.toPhone) throw new Error('An invitee email or phone number is required');
});

// One live invitation per (household, address). Partial unique indexes so a
// phone-only invite (null email) and an email-only invite (null phone) don't
// collide on the missing field.
householdInvitationSchema.index(
  { householdId: 1, toEmail: 1 },
  { unique: true, partialFilterExpression: { toEmail: { $type: 'string' } } },
);
householdInvitationSchema.index(
  { householdId: 1, toPhone: 1 },
  { unique: true, partialFilterExpression: { toPhone: { $type: 'string' } } },
);
householdInvitationSchema.index({ toUserId: 1, status: 1 });
householdInvitationSchema.index({ toEmail: 1 });
householdInvitationSchema.index({ toPhone: 1 });

module.exports = mongoose.model('HouseholdInvitation', householdInvitationSchema);
