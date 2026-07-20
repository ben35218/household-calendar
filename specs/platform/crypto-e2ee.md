---
title: Cryptography & E2EE
status: current
last-verified: b242e6c (2026-07-20)
code:
  - shared/crypto/src/core.ts
  - shared/crypto/src/enrollment.ts
  - server/src/services/{householdKey,keyEnvelope,e2eePolicy,securityAlerts}.js
  - mobile/src/lib/e2ee.ts
  - server/src/models/{Record,HouseholdKeyEnvelope,ResourceKeyEnvelope}.js
---

# Cryptography & E2EE

This is the system-level view of end-to-end encryption: how keys, records, and
membership fit together. The **formal primitive-level specification** —
algorithms, envelope byte layout, AAD, work factors — is
[`docs/CRYPTO-SPEC.md`](../../docs/CRYPTO-SPEC.md), the auditable spec for the
`shared/crypto` package. This spec should not restate primitives; it explains the
model and points there.

## Invariant

Every household's content is **born encrypted**: sealed on the device with keys
the servers never hold, before upload. E2EE is **mandatory** — there is no
plaintext-content lane and no opt-out (`server/src/services/e2eePolicy.js`
rejects a content write without ciphertext; `POST /household/e2ee/activate`
marks a household born-encrypted). There is no admin override or recovery
backdoor: lose every unlock factor and the data is unrecoverable, by design.

## Key hierarchy (one paragraph)

A per-user **X25519 identity keypair** has its private key stored server-side
only as ciphertext, wrapped **independently by each enrolled factor** (any one
opens it): a **password** (Argon2id KEK), a **passkey** (WebAuthn-PRF KEK), and a
one-time **recovery code** (KEK). Adding/removing a factor never re-keys anything
else. A per-**household** symmetric key (**HDK**, versioned) is sealed to each
member's public key (`crypto_box_seal` → `HouseholdKeyEnvelope`) and encrypts the
household's records; per-file content keys are wrapped by the HDK. Shared
calendars/trips get their own resource keys (`ResourceKeyEnvelope`) so a
cross-household collaborator can read just that resource without the HDK. See
[features/auth-identity.md](../features/auth-identity.md) (factors) and
[features/households-sharing.md](../features/households-sharing.md) (HDK
lifecycle).

## Records are opaque

Content is stored in one content-blind collection
([`Record`](../../server/src/models/Record.js)). The **v2 envelope** moved the
collection type out of the AAD and into the sealed payload, so the server can't
tell an event from a recipe — it sees only routing metadata (`householdId`, key
version, ciphertext, optional resource `scope`, tombstone, timestamps). Full
field-by-field boundary in [data-model.md](data-model.md); read/write API in
[api-reference.md](api-reference.md).

## Membership, rotation, retirement

- **Join** is approve-on-device: the joiner's public-key fingerprint (safety
  number) is verified out-of-band, then an existing member seals the current HDK
  to the joiner. Invitation emails are discovery-only — no key material rides in
  email or links.
- **Rotation** on member removal (and every `KEY_ROTATION_INTERVAL_DAYS`,
  default 90): a member mints HDK v(N+1), seals it to every remaining member;
  a compare-and-set on the version prevents racing rotations. Clients eagerly
  re-seal old-version records; once nothing references an old version its
  envelopes are deleted (**retirement**), so a removed member's keys open nothing.
- **Safety numbers** are device-local and reset on key change; members get
  **security alerts** (`services/securityAlerts.js`) on factor/membership/key/
  device changes.

## Server enforces vs. cryptography enforces

Cryptography enforces content confidentiality, record-slot integrity, and
household read access (HDK possession). The server enforces write authorization,
scoping, and quotas via the plaintext routing fields — and it can withhold
service or serve stale ciphertext, but the client's safety-number and
key-version checks surface that. A valid legal request yields exactly the
server-visible set, nothing more. See [operations/transparency.md](../operations/transparency.md).

## Deliberate plaintext exceptions

Content leaves encryption **only** where a chosen feature requires it: things
**shared outside** the household (trips/calendars — the collaborator lacks the
HDK), **event invitations** to non-account people (a readable event snapshot for
the email + `.ics`), and **AI phone calls** (the event essentials needed to place
the call). Each is documented in the relevant feature spec and in
[operations/transparency.md](../operations/transparency.md).

## Open questions

- **Reconcile `docs/CRYPTO-SPEC.md` §7 + `docs/TRANSPARENCY.md`.** Both still
  list the **household name** and **`nextDueDate`** as server-visible. Both are
  now **sealed** (C2 and D4 respectively — confirmed in `Household.js` /
  `dropReadiness.DROP_FIELDS`). The user-facing docs are stale (conservative,
  and prod households dropped before the re-seal backfill may still carry the
  plaintext); update them once the prod re-drop is confirmed complete.
- E3 (third-party audit) is the only remaining Signal-parity item — an ops/comms
  engagement, not code.
- E2 open-source action: publish `shared/crypto` + `CRYPTO-SPEC.md` so the
  claims are independently inspectable.
