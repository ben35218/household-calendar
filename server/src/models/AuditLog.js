const mongoose = require('mongoose');

// Server-side audit trail for the E2EE key/membership lifecycle. Records who did
// what and when — never any content. Phase 2 writes `hdk_minted` and
// `member_approved`; the storage-mode/purge events land with Phase 6.
// See docs/E2EE-SYNC-PLAN.md §4.5.
const auditLogSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
  event: {
    type: String,
    required: true,
    enum: [
      'hdk_minted', 'member_approved', 'hdk_rotated', 'key_enrolled',
      'deletion_scheduled', 'deletion_canceled', 'deletion_purged',
    ],
  },
  meta: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
}, { timestamps: { createdAt: 'at', updatedAt: false } });

auditLogSchema.index({ householdId: 1, at: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
