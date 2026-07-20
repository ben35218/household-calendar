---
title: Households & sharing
status: current
last-verified: dad7c5a (2026-07-20)
code:
  - mobile/src/screens/profile/HouseholdScreen.tsx
  - server/src/routes/household.js
  - server/src/routes/keys.js
  - server/src/services/{householdKey,keyEnvelope,securityAlerts,e2eePolicy}.js
  - server/src/models/{Household,HouseholdInvitation,JoinRequest,HouseholdKeyEnvelope,ResourceKeyEnvelope}.js
  - mobile/src/lib/safetyNumbers.ts
---

# Households & sharing

## Purpose

A household is the unit of shared, encrypted data — every content record belongs
to one. This spec covers membership, invitations, approve-on-device join, the
household key (HDK) lifecycle, member removal + rotation, and safety-number
verification. The cryptographic mechanics are in
[platform/crypto-e2ee.md](../platform/crypto-e2ee.md); this is the product view.

## Behavior (normative)

### Membership & roles

- Every user has exactly one `householdId`. `Household` has an owner; the owner
  is the only member who can remove others and is the authority for key
  rotation.
- The household `name` is plaintext metadata (admin/support UX depends on it);
  everything else about the household's content is encrypted.

### Invitations & joining

- An owner/member invites by email → `POST /household/invitations`
  (`HouseholdInvitation`). Invitations are **discovery only**: no key material is
  ever in the email or link.
- The invitee sees it via `GET /household/invitations/mine` and accepts
  (`POST /household/invitations/:id/accept`, rate-limited) — which creates a
  `JoinRequest`, **not** an instant join.
- **Approve-on-device:** an existing member reviews pending requests
  (`GET /household/join-requests`), **verifies the joiner's safety number**
  out-of-band, and approves (`.../approve`) — only then is the current HDK sealed
  to the joiner's public key. Reject and cancel paths exist
  (`.../reject`, `DELETE /household/join-requests/mine`).
- `POST /household/leave` and `POST /household/members/:userId/remove`
  (owner-only) move a member to a fresh solo household.

### Key lifecycle

- The owner lazily mints **HDK v1** on first unlock. Members read/rotate via
  `GET /household/key`, `POST /household/key`, `GET /household/member-keys`.
- **Removal → rotation:** removing a member flags rotation; the next member
  unlock mints HDK v(N+1) via `POST /household/key/rotate` (compare-and-set on
  the version, new-version envelopes for every remaining member). Old versions
  are kept for historical reads, then retired (`POST /household/key/retire`,
  `e2ee/old-versions`, `reseal-all`/`reseal-complete`) once nothing references
  them — a removed member's keys then open nothing.
- **Born-encrypted enforcement:** `e2eePolicy` blocks plaintext content writes;
  `POST /household/e2ee/activate` marks the household active; `e2ee/readiness`,
  `e2ee/stragglers` + `e2ee/seal`, and `e2ee/client-version` support the
  migration/consistency tooling.

### Security alerts & verification

- Members are notified (`services/securityAlerts.js`) when a factor is added/
  removed, a member joins/leaves, the key rotates, or a new device signs in.
- **Safety numbers** (`mobile/src/lib/safetyNumbers.ts`) are a human-comparable
  digest of a member's identity public key, verified from HouseholdScreen; state
  is device-local and resets if the key changes.

### Cross-household sharing

- Sharing a **calendar** or **trip** with someone in another household uses
  per-resource keys (`ResourceKeyEnvelope`, managed under
  `/household`-adjacent and `/trips/:id/keys`, `/calendars/:key/keys`), so a
  collaborator reads just that resource without holding the HDK. See
  [calendar.md](calendar.md) and [trips.md](trips.md).

## Data & API surface

- **Models:** `Household`, `HouseholdInvitation`, `JoinRequest`,
  `HouseholdKeyEnvelope` (HDK sealed per member × version), `ResourceKeyEnvelope`.
- **Endpoints:** `server/src/routes/household.js` (membership, invitations,
  join-requests, key lifecycle, e2ee activation/readiness) and
  `server/src/routes/keys.js` (identity factors + public keys — see
  [auth-identity.md](auth-identity.md)).
- **Client:** `HouseholdScreen` (members, invite, remove, safety numbers).

## Encryption boundary

Membership graph and household name are server-visible by necessity; all content
is sealed. See [platform/crypto-e2ee.md](../platform/crypto-e2ee.md) and
[operations/transparency.md](../operations/transparency.md).

## Open questions

- Document exact role capabilities (member vs owner) for each mutating endpoint.
- Confirm the periodic (90-day) rotation trigger path end-to-end.
