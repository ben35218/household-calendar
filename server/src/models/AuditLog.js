const mongoose = require('mongoose');

// Server-side audit trail for the E2EE key/membership lifecycle plus sensitive
// admin actions. Records who did what and when — never any content. Phase 2
// writes `hdk_minted` and `member_approved`; the storage-mode/purge events land
// with Phase 6; the admin-action events are written from the admin web app's
// routes. See docs/E2EE-SYNC-PLAN.md §4.5.
const AUDIT_EVENTS = [
  'hdk_minted', 'member_approved', 'member_removed', 'hdk_rotated', 'key_enrolled',
  'deletion_scheduled', 'deletion_canceled', 'deletion_purged',
  'plaintext_dropped', // §9 point-of-no-return: household went E2EE-live
  // Admin-console actions (who changed what from the admin web app):
  'admin_role_changed', // an admin granted/revoked another user's admin role
  'plan_changed',       // an admin manually overrode a household's plan
];

const auditLogSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
  event: {
    type: String,
    required: true,
    enum: AUDIT_EVENTS,
  },
  meta: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: { createdAt: 'at', updatedAt: false } });

auditLogSchema.index({ householdId: 1, at: -1 });
auditLogSchema.index({ event: 1, at: -1 }); // event-filtered admin queries

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
AuditLog.EVENTS = AUDIT_EVENTS;

module.exports = AuditLog;
