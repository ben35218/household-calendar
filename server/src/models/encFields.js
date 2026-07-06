// Shared schema fragment for E2EE dual-write (Phase 3+).
//
// Spread `encFields` into any content model's schema definition to give it a
// client-written ciphertext blob + its key version, stored alongside the
// plaintext fields during dual-write. The server never reads `enc`; plaintext
// stays authoritative until the verified drop. See docs/E2EE-SYNC-PLAN.md §3.2.
const encFields = {
  keyVersion: { type: Number },
  enc: {
    alg:   { type: String },
    nonce: { type: String },
    ct:    { type: String },
  },
};

module.exports = { encFields };
