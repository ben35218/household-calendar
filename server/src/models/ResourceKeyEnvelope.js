const mongoose = require('mongoose');

// A per-resource content key (a CalendarKey — Signal-parity D1; a TripKey — D2)
// wrapped to one recipient. Generalizes HouseholdKeyEnvelope beyond the HDK so an
// outside-shared calendar's events (or a shared trip's Trip + TripItems +
// attachments) can be sealed under a key that both the owning household AND each
// accepted cross-household collaborator can unwrap — replacing the §9.5/§9.3
// plaintext feeds. The server stores only opaque ciphertext; it can no more read
// a resource key than an HDK. See docs/SIGNAL-PARITY-PLAN.md §D1/§D2.
//
// Two recipient shapes per (resource, keyVersion):
//   - recipient 'household': the resource key wrapped under the owning household's
//     HDK (AEAD), so any member holding the HDK unwraps it. `hdkVersion` records
//     which HDK version wrapped it; `householdId` is the owning household.
//   - recipient 'member': the resource key wrapped to a collaborator's identity
//     public key (anonymous sealed box). `userId` is that collaborator.
const resourceKeyEnvelopeSchema = new mongoose.Schema({
  resourceType: { type: String, enum: ['calendar', 'trip'], required: true },
  // The globally-unique resource id: a CustomCalendar `key` (`custom-<slug>`,
  // referenced by events via calendarType) or a Trip `_id` (referenced by items
  // via tripId) — a plaintext routing value either way, so no new id leaks.
  resourceKey:  { type: String, required: true },
  // The resource-key version (rotates on revoke/un-share; a sealed record's
  // keyVersion binds to this via the scoped AAD).
  keyVersion:   { type: Number, required: true },

  recipient:    { type: String, enum: ['household', 'member'], required: true },
  // recipient 'member' → the collaborator; recipient 'household' → unused.
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // recipient 'household' → the owning household; recipient 'member' → unused.
  householdId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
  // recipient 'household' → which HDK version sealed it (needed to unwrap).
  hdkVersion:   { type: Number },

  wrappedKey:   { type: String, required: true }, // JSON RecordEnvelope (household) | b64url sealed box (member)
  wrappedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// One household envelope per (resource, version); one member envelope per
// (resource, version, collaborator). Partial unique indexes keep the two
// recipient shapes from colliding on their unused fields.
resourceKeyEnvelopeSchema.index(
  { resourceKey: 1, keyVersion: 1, recipient: 1 },
  { unique: true, partialFilterExpression: { recipient: 'household' } },
);
resourceKeyEnvelopeSchema.index(
  { resourceKey: 1, keyVersion: 1, userId: 1 },
  { unique: true, partialFilterExpression: { recipient: 'member' } },
);
// "Every envelope I can use" — my member wraps across resources.
resourceKeyEnvelopeSchema.index({ userId: 1, recipient: 1 });

module.exports = mongoose.model('ResourceKeyEnvelope', resourceKeyEnvelopeSchema);
