# Calen E2EE — Cryptographic Specification

*Signal-parity plan E2: the auditable spec for `shared/crypto` (the package to
open-source). Everything here is implemented in `shared/crypto/src/core.ts` +
`enrollment.ts` and exercised by its `node:test` suite. All primitives are
libsodium; there is no custom cryptography.*

<!-- E2 (OPS ACTION, Ben): to complete E2, publish shared/crypto + this spec
     (separate public repo or public folder) so the claims are inspectable. -->

Last updated: 2026-07-17.

## 1. Primitives

| Purpose | Primitive |
|---|---|
| Record/file AEAD | XChaCha20-Poly1305 IETF (`crypto_aead_xchacha20poly1305_ietf`), random 24-byte nonce per encryption |
| Identity keypair | X25519; HDK wrapped to members via anonymous sealed box (`crypto_box_seal`) |
| Private-key-at-rest | `crypto_secretbox` (XSalsa20-Poly1305) under a per-factor KEK |
| Password KEK | Argon2id (`crypto_pwhash`), explicit ops/mem limits, per-factor salt |
| Passkey KEK | WebAuthn PRF (`hmac-secret`) output → `crypto_generichash` → KEK |
| Recovery KEK | ≥128-bit Crockford-base32 code (shown once) → `crypto_generichash` → KEK |

Portability constraints (both `libsodium-wrappers-sumo` and
`react-native-libsodium`): UTF-8 via `TextEncoder`/`TextDecoder`; chunked AEAD
for files (no `secretstream`); explicit Argon2 work factors; AEAD
`additionalData` passed as a string.

## 2. Key hierarchy

```
factor secret (password / passkey-PRF / recovery code)
  └─KEK──wraps──► identity private key (X25519)        [per-factor envelope]
                     └─opens──► HouseholdKeyEnvelope    [sealed box per member × key version]
                                  └──► HDK (256-bit, versioned)
                                         ├──encrypts──► records (AEAD)
                                         └──wraps─────► per-file keys (Kf) ──► file bytes
```

- Any single factor envelope decrypts the private key; factor add/remove never
  re-keys anything else.
- The server stores only: identity PUBLIC key, factor envelopes (ciphertext),
  HDK envelopes (sealed-box ciphertext), record/file ciphertext. It can decrypt
  none of them.

## 3. Record envelope

```jsonc
{ "alg": "xchacha20poly1305-ietf", "nonce": "<b64 24B>", "ct": "<b64 ct+tag>" }
```

- **AAD** binds ciphertext to its slot. Two envelope versions exist:
  - **v1** (`RECORD_ALG`): AAD = `collection \0 id \0 householdId \0 keyVersion`;
    the sealed payload is the bare record JSON.
  - **v2** (`RECORD_ALG_V2`, current — Signal-parity C3 opaque records): the AAD
    **drops `collection`** and binds a generic `record` tag in its place, while
    the collection type moves *inside* the sealed payload (`{ c: collection,
    r: record }`). The record id already pins the exact slot, so removing the
    type from the AAD doesn't weaken the move/replay binding — it stops the AAD
    from revealing a record's collection to the server. This is what lets the
    unified opaque record store (`server/src/models/Record.js`) be fully
    content- and type-blind.

  In both versions a ciphertext moved to another record, household, or key
  version fails authentication.
- **Plaintext body** = record JSON, **padded (C1)**: trailing spaces up to a
  size bucket — powers of two from 256 B to 4 KiB, then 4 KiB steps — so
  ciphertext length only reveals the bucket. `JSON.parse` ignores the pad, so
  padding needed no envelope version and is compatible in both directions.

## 4. Files / attachments

Per-file random key `Kf`; bytes encrypted as chunked AEAD (`hcfile-v1`): each
chunk is `nonce(24) || ct` with AAD `index/total` — chunk drop, add, or
reorder fails decryption. `Kf` is wrapped by the HDK with the same record-AAD
binding and stored in the record's metadata.

## 5. Membership, rotation, retirement

- **Join** (approve-on-device): joiner's public-key fingerprint is verified
  out-of-band (safety number); an existing member seals the current HDK to the
  joiner's public key. Invitation emails are discovery only — no key material
  ever rides in email or invite links.
- **Rotation** (member removal, or every `KEY_ROTATION_INTERVAL_DAYS`, default
  90): a member mints HDK v(N+1) and seals it to every remaining member;
  compare-and-set on the version prevents racing rotations.
- **Eager re-encryption (B1):** clients re-seal all old-version records under
  the current version after any rotation.
- **Retirement (B3):** once nothing (records or wrapped file keys) references
  an old version, its envelopes are deleted server-side. Net effect: a removed
  member's key material decrypts nothing, past or future, once the pass
  completes.
- **Safety numbers (A2):** fingerprint = short human-comparable digest of the
  identity public key; verified state is device-local and resets on key change.

## 6. What the server enforces vs. what cryptography enforces

| Property | Enforced by |
|---|---|
| Content confidentiality | Cryptography (AEAD under HDK) |
| Record-slot integrity | Cryptography (AAD) |
| Household read access | Cryptography (HDK possession) |
| Write authorization, scoping, quotas | Server (plaintext scope fields) |
| Outside-share access (trips/calendars) | Server — these records are deliberately plaintext (see `docs/TRANSPARENCY.md`) |

## 7. Known limitations (current, honest)

- Membership graph, household name, record existence/timing/bucket-size, and
  `nextDueDate` scheduling metadata are server-visible (Signal-parity plan
  C2/C3/C4/D4 track the subset being closed).
- Consented AI payloads are decrypted client-side and sent per-request
  (identifier-stripped and aliased — G1); Anthropic sees that content.
- A compromised *server* cannot read data but can withhold service, serve
  stale ciphertext, or lie about membership *until* the client's safety-number
  and version checks surface it.
