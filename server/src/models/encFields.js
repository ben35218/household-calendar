// Shared schema fragment for E2EE dual-write (Phase 3+).
//
// Spread `encFields` into any content model's schema definition to give it a
// client-written ciphertext blob + its key version, stored alongside the
// plaintext fields during dual-write. The server never reads `enc`; plaintext
// stays authoritative until the verified drop. See docs/E2EE-SYNC-PLAN.md §3.2.
const mongoose = require('mongoose');

const encFields = {
  // Signal-parity C4 (hide record authorship): the household this record belongs
  // to, stamped plaintext on every write. It is the record's server-visible
  // attribution once the member-granular plaintext `userId` (the author) is
  // sealed inside `enc` and nulled — the server scopes by `householdId` instead
  // of `userId ∈ scopeIds`. Household- not member-granular (the coarser leak the
  // membership-graph line in the plan's "Out of scope" already accepts). Indexed
  // because it becomes the primary read filter. See the §C4 decision doc.
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', index: true },
  keyVersion: { type: Number },
  enc: {
    alg:   { type: String },
    nonce: { type: String },
    ct:    { type: String },
    // Signal-parity D1/D2 key-scope discriminator: absent = sealed under the
    // household HDK; 'cal' = sealed under a CalendarKey, 'trip' under a TripKey
    // (its keyVersion is then a resource-key version). Lets a reader pick the key.
    ks:    { type: String, enum: ['cal', 'trip'] },
  },
};

// A `required` predicate for sealed content fields (name/title/startDate/…): the
// plaintext is mandatory UNTIL the record carries ciphertext. Once `enc.ct` is
// set — a sealed record, whether post-drop or born-encrypted — the plaintext
// content is legitimately absent (the steady-state write rule in
// services/e2eePolicy.js strips it, and the drop nulls it), so it is no longer
// required. This keeps a sealed record a VALID mongoose document (so a stripped
// create/`.save()` on a post-drop record no longer trips full-document
// validation) while still enforcing plaintext on un-encrypted rows — including
// the shared-trip (§9.3) and outside-shared-calendar (§9.5) plaintext lanes,
// which carry no `enc`. Must be a plain function so `this` binds to the doc.
function requiredUntilSealed() {
  return !this.enc?.ct;
}

module.exports = { encFields, requiredUntilSealed };
