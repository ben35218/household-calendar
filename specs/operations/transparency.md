---
title: Transparency (what Calen can/can't see)
status: reference
last-verified: dad7c5a (2026-07-20)
code:
  - docs/TRANSPARENCY.md
---

# Transparency

The **canonical, user-facing** long form is
[`docs/TRANSPARENCY.md`](../../docs/TRANSPARENCY.md) — it is the source for the
in-app Privacy & data section and the website page, and is written for users, not
engineers. It must be updated whenever a change alters what the server stores.
This spec is the engineering pointer + the internal contract it commits us to.

## The server-visible contract (must stay true)

A server (or a valid legal request) can obtain **only**:

- Account identity (email, name, timestamps) and household structure
  (membership, join/leave timing, household **name**).
- Encrypted records: existence, owning household, create/change time, key
  version, padded size — **never content or type** (opaque store; see
  [platform/data-model.md](../platform/data-model.md)).
- Plan/billing status and AI-usage counts; a device label per session.
- Operational logs referencing ids only (no content).
- The deliberate plaintext exceptions (outside sharing, non-account event
  invitations, AI-call essentials) — only if any exist for that account.

It can **never** obtain record content, locations, attachments/manuals, AI
conversation content, passwords, or any key.

## Change rule

Any PR that changes the encryption boundary, adds a field the server can read,
or adds an external data flow (e.g. a new AI surface) MUST update
`docs/TRANSPARENCY.md` in the same change. Cross-check
[platform/crypto-e2ee.md](../platform/crypto-e2ee.md) and the relevant feature
spec's "Encryption boundary" section.

## Known state

The stale "Local-only mode / 7-day cloud purge" retention bullet was removed
(2026-07-20) — that feature no longer exists in the code.
