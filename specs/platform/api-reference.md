---
title: API reference
status: current
last-verified: d7c71e0 (2026-07-22)
code:
  - server/src/app.js        # the mount table — source of truth for what exists
  - server/src/routes/
  - server/src/routes/records.js
tests:
  - server/src/test/         # every integration suite boots the real app over in-memory MongoDB
---

# API reference

All routes are prefixed with `/api`. The route mount table in
[`server/src/app.js`](../../server/src/app.js) is the authoritative index; this
spec explains the shape and the parts that aren't obvious from the mounts.

## Conventions

- **Auth:** `Authorization: Bearer <JWT>` on everything except the public
  endpoints listed below. The token is issued by `/api/auth/login` (and the
  passkey/OTP flows) and stored on-device in `expo-secure-store`.
- **Sliding session:** responses may carry an `X-Refreshed-Token` header; the
  admin (browser) client can only read it because it's in CORS `exposedHeaders`.
  The mobile client swaps its stored token when present.
- **CORS:** the native app sends no `Origin` and is allowed through; the admin
  app's origin must be in `CORS_ORIGINS` (or `CLIENT_URL`). Dev adds
  `http://localhost:5174` automatically.
- **Rate limits:** auth, key, and join endpoints carry per-IP limiters
  (`trust proxy` is set so limits key off the real client IP behind Render).
- **Large bodies:** the AI chat paths get a 15 MB JSON limit (inline base64
  image/PDF attachments); every other route keeps the default small limit.

## The content path: one opaque record store

This is the most important and least obvious part of the API. **Household content
is not stored through per-entity CRUD routes.** Every content record (calendar
events, people, tasks, chores, recipes, trips, items, trip items, …) is a
client-**sealed** blob in a single server collection, reached through
[`server/src/routes/records.js`](../../server/src/routes/records.js):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/records/sync` | Incremental **last-writer-wins** pull: every record in the caller's scope changed after `?since=<cursor>`, including tombstones for deletes. |
| POST | `/api/records` | Create a sealed record. |
| PUT | `/api/records/:id` | Replace a sealed record (LWW). |
| DELETE | `/api/records/:id` | Delete → tombstone. |

- The server stores ciphertext plus a small set of **plaintext scope fields** it
  must act on (household/owner, collection tag, sharing/scheduling metadata). It
  cannot read record content. See
  [platform/crypto-e2ee.md](crypto-e2ee.md) and [data-model.md](data-model.md).
- Records may be scoped to a shared **calendar** or **trip** resource (with a key
  version), which is how sharing and key rotation ride along.
- The mobile client mirrors this into a local replica and drives the UI
  offline-first (`mobile/src/lib/recordStore.ts`, `records.ts`).

Legacy per-entity routers (`/api/items`, `/api/tasks`, `/api/chores`,
`/api/recipes`, …) remain mounted but the live content path folds into the record
store; treat them as compatibility/aux surfaces, not the primary CRUD API.

## Route groups (by mount)

See `app.js` for exact paths. Grouped for orientation:

- **Auth & identity:** `/api/auth` (register, login, forgot/reset + reset-cancel,
  sessions, me, email/password change, delete account), `/api/keys` (E2EE factor
  enrollment, recovery, factor add/remove, device-link, public keys). Passkeys
  are under `/api/auth` too (`register-options`, `register`, `challenge`,
  `login`). See [features/auth-identity.md](../features/auth-identity.md).
- **Household, membership & E2EE:** `/api/household` (get/update, invitations,
  join-requests + approve-on-device, member remove, leave, key get/rotate/retire,
  `e2ee/activate`, `e2ee/readiness`, `e2ee/stragglers`+`seal`, reseal,
  `client-version`). See [features/households-sharing.md](../features/households-sharing.md).
- **Calendar:** `/api/calendars` (custom calendars + per-calendar key envelopes +
  calendar invitations), `/api/calendar` (event attachments), `/api/invitations`
  (event invitations incl. public `ics` + `lookup`). See
  [features/calendar.md](../features/calendar.md).
- **Maintenance & home:** `/api/items`, `/api/tasks`, `/api/task-templates`,
  `/api/chores`, `/api/chore-templates`, `/api/manuals`, `/api/receipts`,
  `/api/categories`, `/api/properties`, `/api/vehicles/:itemId/odometer`,
  `/api/history`.
- **Kitchen:** `/api/recipes` (incl. `suggest-recipes`), `/api/recipe-schedule`.
- **Trips:** `/api/trips`.
- **People:** `/api/people`.
- **AI:** `/api/calendar/chat`, `/api/maintenance/chat`,
  `/api/maintenance/plan-chat`, `/api/chores/chat`, `/api/trips/chat`,
  `/api/form-assist`, `/api/calls` (Vapi phone calls), `/api/places` (biasing).
  See [features/ai-assistant.md](../features/ai-assistant.md). All AI routes
  sit behind `middleware/aiConsent.js` (`requireAiEnabled` → 403 when
  `User.aiEnabled` is false; the flag syncs from the device via `PUT /settings`
  and is returned by `GET /settings`).
- **Billing:** `/api/billing` (`webhook` — public, HMAC-verified; `status`;
  `select` — admin). See [features/billing-plans.md](../features/billing-plans.md).
- **Misc:** `/api/weather`, `/api/notifications`, `/api/settings`,
  `/api/moderation`, `/api/health` (public).
- **Admin app surfaces:** `/api/monetization-config`, `/api/admin/analytics`,
  `/api/admin/email`, `/api/admin` — all `requireAdmin`-gated.

## Public (unauthenticated) endpoints

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/forgot`,
  `POST /api/auth/reset`
- `POST /api/auth/passkey/challenge`, `POST /api/auth/passkey/login`
- `GET /api/invitations/public/:id/ics`, `GET /api/invitations/lookup`
- `POST /api/billing/webhook` (verified via `REVENUECAT_WEBHOOK_SECRET`)
- `GET /api/keys/link/:linkId`, `GET /api/keys/public/:userId`
- `GET /api/health`

## Verification

- The API surface is exercised end-to-end by the integration suites in
  `server/src/test/` — each boots the real Express app (real routes, middleware,
  models) over in-memory MongoDB via `server/src/test/harness.js`. Per-area
  coverage is mapped in each feature spec's own Verification section; this spec
  claims only the cross-cutting conventions (auth requirement, public endpoint
  list, rate limiting), which every suite hits implicitly.

## Open questions

- Enumerate the exact plaintext scope fields the record store persists and index
  them against `server/src/models/encFields.js` (tracked in
  [data-model.md](data-model.md)).
- Confirm whether the legacy per-entity routers still serve any live client path
  or are fully superseded by `/records`.
