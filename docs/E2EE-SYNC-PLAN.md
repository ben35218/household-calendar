# E2EE Cloud Sync + Device-Local Storage — Design Doc & Implementation Plan

Status: **APPROVED & IN PROGRESS.** Phases 0–2 done + on-device-verified; 3a, 4a, 4b, 4c, 5a, 5b landed (build/test-verified). Detailed per-phase status lives in §11.
Author: exploration + design pass over the current monorepo.

---

## CURRENT STATUS SNAPSHOT (2026-07-06)

**Everything below is in the working tree and NOT yet committed** (one large diff spanning Phases 2→5b). All of it stays behind dual-write: **plaintext is still authoritative and server-visible — no live E2EE boundary yet.** The boundary goes live only at the §9 plaintext drop.

**Done + verified (green):**
- **Phase 0/1** — shared crypto (`shared/crypto`, 23 `node:test`) + key management/factors, on-device verified (iOS sim). §11.
- **Phase 2** — Household Data Key (HDK) + `HouseholdKeyEnvelope` + `JoinRequest` + **approve-on-device join** replacing instant join, public-key fingerprint verification, `AuditLog`. Owner mints HDK v1 lazily on first unlock. §11.
- **Phase 3a** — dual-write crypto slice for **CalendarEvent** (encrypt-subset-on-save + decrypt-on-load; `enc` blob alongside plaintext). §11.
- **Phase 4a** — dual-write rolled out to **9 collections**: CalendarEvent, Person, MaintenanceTask, Chore, Recipe, Trip, Item, FoodInventory, TripItem. Reusable helpers: server `models/encFields.js` + `services/householdKey.js` (`isObjectId`/`pickRecordEnc`/`validateRecordEnvelope`); client `e2ee` `sealNew`/`sealUpdate`/`openRecord` (with a **content-subset** arg so foreign keys / server-scheduled dates stay plaintext). §11.
- **Phase 4b** — offline **local replica** (web IndexedDB `services/replica.js`; mobile AsyncStorage `lib/replica.ts` — interim, D5=expo-sqlite later) + `syncedList` offline-first on the primary list of every dual-write collection. §11.
- **Phase 4c** — **manuals** attachment encryption end-to-end (web full: encrypt-on-upload + decrypt-to-blob-URL; mobile graceful "open on web"); crypto flow locked by a `shared/crypto` test; `Manual.{encrypted,wrappedFileKey,keyVersion}`. §11.
- **Phase 5a** — mobile **on-device local notifications** (`lib/notifications.ts` + `hooks/useReminderScheduler.ts`, rolling 60-item window) + server **cron guard** (`User.localReminders`) so no duplicate reminders. §11.
- **Phase 5b** — mobile **AI consent enforcement + transparency** in `FormAssist` (the `aiEnabled`/`aiUsePersonalInfo` prefs were stored but unenforced). §11.

**Not started / blocked / gated:**
- **§9 plaintext drop** — the real milestone (records actually private). Point-of-no-return migration; **gated behind a prerequisite stack P1–P7** (§9), because the server still reads plaintext content in live paths (`scheduler.js` cron, AI chat/scan routes, `weather.js` location, `Person.ensureSelf`). **P1** (onboarding self-Person seed → client-side, dormant behind `Household.e2eeActive`) and **P2** (shared client-side recurrence/range engine, all calendar view surfaces expand client-side) **landed** (build/test-verified). P4–P7 remain.
- **Phase 4c remaining** — mobile-full attachments (needs `expo-file-system` native dep + dev-client rebuild); item photos (AI-scan flow → Phase 5 ephemeral, not stored); **trip attachments** (hit **cross-household** sharing — collaborators outside your household don't hold your HDK; out of the single-household E2EE model, needs a design decision).
- **Phase 5 remaining** — client-side weather (blocked: home location still plaintext on `Household`); extend AI enforce+indicator to other AI surfaces (chat, scans, manual-extract); on-device notif background-refresh + user toggle.
- **Phases 6, 7** — storage-mode toggle + download-first + 7-day purge; member removal / HDK rotation + whole-household migration. Not started.

**Verification bar (keep green):** `cd shared/crypto && npm test` (23) · `cd server && npm test` (22) · `cd client && npm run build` · `cd mobile && npx tsc --noEmit` · `cd mobile && CI=1 npx expo export --platform ios`. On-device optional (Metro dev server + iOS sim).

**Hard constraints (Phase-1 lessons, don't regress):** the shared crypto core must use only primitives present on BOTH `libsodium-wrappers-sumo` and `react-native-libsodium` — UTF-8 via `TextEncoder`/`TextDecoder` (no `from_string`), chunked AEAD for files (no `crypto_secretstream`), explicit Argon2 work factors (no `*_MODERATE` on native), and **AEAD `additionalData` passed as a `string`** (native throws on `Uint8Array`/`null`).

---

## 0. Repo facts (verified against code)

| Claim | Verified | Notes |
|---|---|---|
| Monorepo `server/ client/ admin/ mobile/ shared/` | ✅ | `shared/` currently holds **only** seed JSON (`choreTemplates.json`, `taskTemplates.json`) — there is **no shared code package yet**. We will need to create one for crypto. |
| `auth.js` sets `req.scopeIds` to all household members; queries filter `userId: { $in: req.scopeIds }` | ✅ | `server/src/middleware/auth.js:20-31`. Sharing == "server returns any household member's records." |
| Instant code-join | ✅ | `server/src/routes/household.js:66-93`. Also: `/leave` spins up a fresh solo household; `handleDeparture` reassigns ownership / deletes empty households. |
| Reminders are a server cron reading plaintext | ✅ | `server/src/jobs/scheduler.js`. **Two** cron paths: hourly per-item 7am (tasks/chores/birthdays) and every-15-min per-occurrence event reminders. Both read plaintext + recurrence server-side. |
| Server-side plaintext readers: AI, weather, places/geo, FX | ✅ | AI via `chatStream.js` + `calendarChat/maintenanceChat/vacationChat/formAssist/recipes/manuals`. `calendarData.js` expands recurrence server-side and is shared by the calendar API **and** the calendar assistant. |
| Content models listed | ✅ | Plus `WeatherRecord` (server-side weather cache) and `MonetizationConfig`. User/Household are auth/infra. |
| Mobile device-local privacy store w/ `dataStorage: 'cloud' \| 'local'` | ✅ | `mobile/src/lib/privacyPrefs.ts` — AsyncStorage, defaults to `cloud`. The mode exists but is **not wired to anything** yet. |
| Admin "Households & plans" view | ✅ | `admin/src/views/HouseholdsView.vue` shows household **name**, **joinCode**, **plan**, and weekly usage counters. |

### New facts that change the plan (not in your brief)

1. **There is no local persistence layer today.** All three clients treat the server as the source of truth: web uses axios + `localStorage` token; mobile uses React Query (`staleTime: 30s`) + axios; no offline DB. "Store on this device only" therefore requires building a **real local datastore** (SQLite/expo-sqlite on mobile, IndexedDB on web), not just flipping a flag. This is the single largest hidden cost.

2. **Binary attachments exist and must be encrypted too.** Manuals (PDFs), item photos, receipt images, trip attachments are uploaded as blobs and served via `?token=` download URLs (`client/src/services/api.js`, `server/.../manuals|trips`). Your brief only covered document ciphertext. **File/blob encryption is in scope** and has its own ciphertext framing + upload/download changes.

3. **Household-level plaintext settings feed server features.** `Household` stores `homeAddress`, `lat`, `lon`, `timezone`, `grocerySections`, `reminderLeadDays`. `homeAddress/lat/lon` drive server-side weather + places. Encrypting them breaks server weather. This forces a weather decision (below).

4. **Onboarding seeds *content* server-side.** Registration seeds default Categories and a self `Person` in plaintext (`routes/auth.js`, `seed.js`, `Person.ensureSelf`). Under E2EE the server can't create plaintext content — seeding must move client-side, post key-enrollment.

5. **RevenueCat `app_user_id == householdId`** (`Household.revenueCatId`). Billing keys off `householdId`, which stays plaintext → **billing is unaffected by E2EE.** Good.

---

## 1. Challenges to your pre-answered decisions

I agree with most of your pre-answers. These are the ones I'd change or qualify **before** you approve.

### 1.1 ⚠️ Passkey-only "primary passwordless unlock" is too aggressive for v1 — make it progressive enhancement, keep a password/Argon2id KEK as the mandatory baseline.

A WebAuthn/passkey credential does **not** hand you a stable symmetric key. To wrap the private key with a passkey you need the **PRF extension** (`hmac-secret` at the CTAP layer) to derive a per-credential secret. As of the current cutoff, PRF support is **uneven**: solid on recent Chrome/Android + some password managers, partial/emerging on Safari + iOS `ASAuthorization` passkeys, and `react-native-passkeys` PRF support is young and device-dependent. If PRF isn't present, a passkey can authenticate a *login* but **cannot unlock data**.

If we make passkey-PRF the *sole primary* unlock, we gate the entire feature on the least-mature part of the stack and risk users who can log in but can't decrypt.

**Recommendation:** In v1, the **mandatory baseline factor is a password-derived KEK (Argon2id / libsodium `crypto_pwhash`)**. Passkey-PRF is an *additional enrolled factor* offered where the platform advertises PRF, and becomes the smooth passwordless path over time. Recovery code always enrolled. This keeps your "any one factor decrypts" envelope model exactly, but doesn't bet the launch on PRF. Revisit passkey-primary in a later phase once PRF telemetry looks good.

*(If you retain passwordless login via magic-link only and drop passwords entirely, then the "baseline factor" becomes the recovery code + passkey-PRF, and users without PRF must keep their recovery code as the literal only key — much more dangerous. I'd keep passwords for now.)*

### 1.2 ⚠️ Encrypt binary attachments — add to decision 9's scope.

Not optional. Manuals/photos/receipts/trip files must be encrypted client-side with a per-file content key (wrapped by the HDK), uploaded as opaque bytes, and decrypted on download. The server keeps only `{householdId, size, contentType?, keyVersion}` metadata. Thumbnails, if any, must be generated client-side pre-encryption.

### 1.3 ⚠️ Home location + weather: pick a lane. Recommend encrypt location, move weather client-side.

`homeAddress/lat/lon` are exactly the kind of data E2EE should protect. Options:
- **(A) Keep location as plaintext household metadata** → server weather cron keeps working, no client weather rebuild. Leaks home address to the server (contradicts the promise).
- **(B) Encrypt location, fetch weather from the client** using ephemeral coords (like the AI ephemeral-consent pattern). Loses the shared `WeatherRecord` cache; each client fetches its own. Consistent with E2EE.

**Recommendation: (B).** Weather is low-stakes to move client-side and home address is genuinely sensitive. Accept losing the server cache.

### 1.4 ⚠️ Household **name** stays plaintext metadata — confirm you accept it (admin/support UX depends on it).

Admin "Households & plans" searches by name + join code. If we encrypt the name, admin sees only an ObjectId — worse support UX. Recommend **household name remains plaintext metadata** and we tell users "your household's *name* is visible to us for support; its *contents* are not." If you want name encrypted too, admin degrades to id-only and we drop name search.

### 1.5 iOS local-notification 64-pending cap → rolling scheduler (affects decision 8).

Moving reminders on-device (Expo local notifications) hits the iOS ~64 pending-notification ceiling. Recurring tasks/chores/events can't all be pre-scheduled. We need a **rolling window** (schedule the next N days on app foreground + a background-refresh task) and accept that far-future reminders are only guaranteed once the window rolls forward. Worth stating explicitly as a trade-off alongside the web-push regression you already noted.

### 1.6 Solo local-only = genuinely single-device — say it in the toggle copy.

With no server copy, a solo local-only user has **no second-device sync path at all** (the optional encrypted export in decision 12 is the only bridge). This is consistent with your decisions but must be explicit in the confirmation dialog, not just "no automatic recovery."

**Agreed as-is:** ephemeral-consent AI (1), lazy/versioned removal (2), layered/passwordless *recovery* model and "at least one factor must survive / no server escrow" (3), separate login-vs-data recovery (4), same-user multi-device via keychain sync or re-enroll (5), async pending-join (6), client-side search/sort/pagination (7), on-device local notifications (8), whole-household all-or-nothing migration (10), no admin break-glass (11), optional encrypted export for solo local-only (12).

---

## 2. Open decisions that still need your call

**DECIDED (2026-07-02):**
- **D1 = Password-KEK baseline** (Argon2id mandatory; passkey-PRF progressive; recovery code always). See §1.1.
- **D2 = Encrypt location + client-side weather.** Drop the server `WeatherRecord` cache. See §1.3.
- **D3 = Household name stays plaintext metadata** (admin/support search keeps working). See §1.4.

**DECIDED (2026-07-02) — "go with best practices":**
- **D4 = Retain password login.** Password stays a supported login + baseline unlock factor.
- **D5 = expo-sqlite** for the mobile local replica (IndexedDB on web); ciphertext rows, we own the schema.
- **D6 = Keep server last-write-wins on plaintext `updatedAt`** metadata; no client-side merge engine in v1.
- **D7 = `joinCode` is an invite handle only** post-E2EE — it carries no key; access comes from device approval.
- **D8 = Ephemeral-consent for FX + Google Places** (client sends the query string per request, unstored), same surface as AI.

**Scope confirmed:** attachment/blob encryption is in scope; the device-local replica store is net-new engineering (Phase 4).

---

## 3. Cryptographic design

### 3.1 Library

- **Web + admin:** `libsodium-wrappers` (WASM).
- **Mobile (Expo):** `react-native-libsodium` (JSI bindings; same libsodium primitives). Requires a dev/prebuild client — already have a dev-client build profile per recent commits.
- **Shared crypto package:** create `shared/crypto/` (new) exporting a platform-agnostic API (`wrapHDK`, `sealToPublicKey`, `encryptRecord`, `decryptRecord`, `deriveKEK`, …) with two thin adapters binding to the platform's libsodium. All three clients import from here → one audited implementation.

All primitives are libsodium standards — no custom crypto:
- **Identity keypair (per user):** X25519 (`crypto_box` / `crypto_box_seal`). One anonymous **sealed box** wraps the HDK to a member's public key during approve-to-join. (Add an Ed25519 signing key only if we later want signed envelopes; not required for v1.)
- **Household Data Key (HDK):** 256-bit symmetric key, versioned. Record encryption uses **XChaCha20-Poly1305 IETF** (`crypto_aead_xchacha20poly1305_ietf`) with a random 24-byte nonce per encryption.
- **Private-key-at-rest wrapping:** the user's X25519 private key is stored server-side **only as ciphertext**, wrapped independently by each enrolled factor via `crypto_secretbox` (XSalsa20-Poly1305) under a per-factor **KEK**.
- **KEK derivation per factor:**
  - Password → `crypto_pwhash` (Argon2id, `MODERATE` ops/mem; store salt + params).
  - Passkey → PRF/`hmac-secret` output → HKDF → KEK (only where PRF available).
  - Recovery code → 128-bit+ code (e.g. 24 Crockford-base32 chars, shown once) → HKDF → KEK.

### 3.2 Record ciphertext format

Each encrypted document stores a single `enc` blob (all sensitive fields serialized to JSON, then AEAD-sealed) plus plaintext routing/metadata columns:

```jsonc
{
  "_id":         "…",            // plaintext (Mongo id)
  "userId":      "…",            // plaintext (scope / LWW)
  "householdId": "…",            // plaintext (scope)
  "collection":  "CalendarEvent",// plaintext (routing)
  "keyVersion":  3,              // plaintext (which HDK version encrypted this)
  "createdAt":   "…",            // plaintext (metadata)
  "updatedAt":   "…",            // plaintext (server LWW)
  "enc": {
    "alg":   "xchacha20poly1305-ietf",
    "nonce": "<b64, 24 bytes>",
    "ct":    "<b64 ciphertext+tag>"
  }
}
```

- **AAD binds ciphertext to its location:** `AAD = collection || "\0" || _id || "\0" || householdId || "\0" || keyVersion`. Prevents an attacker/curious server from moving a ciphertext to another record slot or replaying an old key version.
- **Everything sensitive is inside `enc`,** including calendar `title/description/location/startDate/endDate` (per decision 9 — dates encrypted; calendar range-filters client-side after download).
- **Plaintext is minimal:** `_id, userId, householdId, collection, keyVersion, createdAt, updatedAt`. Nothing else — no `calendarType`, no `alertAudience`, no titles.

### 3.3 File/attachment ciphertext

Per-file random content key `Kf` → `Kf` wrapped by HDK (stored in the file's metadata `enc` blob). File bytes encrypted with XChaCha20-Poly1305 in a chunked/streaming framing (libsodium `secretstream`) so large PDFs/photos don't need full buffering. Server stores opaque ciphertext + `{householdId, size, keyVersion}`.

### 3.4 Unlock-factor envelope model

`User` gains `identityPublicKey` (plaintext) and a set of **wrapped-private-key envelopes**, one per factor:

```jsonc
wrappedPrivateKey: [
  { factor: "password", kdf: "argon2id", salt, opslimit, memlimit, nonce, ct },
  { factor: "passkey",  credentialId, prfSalt, nonce, ct },   // only if PRF enrolled
  { factor: "recovery", nonce, ct }                            // one-time code
]
```

Any single envelope decrypts the private key → the private key unwraps the HDK envelope(s) → HDK decrypts records. Add/remove a factor = add/remove an envelope; the private key never changes, so re-keying is unnecessary for factor changes.

---

## 4. Key & data-model changes

### 4.1 `User`
- `identityPublicKey: string` (b64 X25519 pub) — plaintext.
- `wrappedPrivateKey: [FactorEnvelope]` (§3.4).
- `keyEnrolledAt`, `keySchemaVersion`.
- **Storage mode + purge state:**
  - `storageMode: 'cloud' | 'local'` (server-authoritative mirror of device pref; only settable to `local` when solo).
  - `cloudDeletionScheduledAt: Date | null`
  - `cloudDeletionState: 'none' | 'scheduled' | 'purged'`
  - `localReplicaVerifiedAt: Date | null`, `localReplicaManifestHash: string` (proof the download-first copy verified before we ever schedule deletion).
- **Index:** `{ cloudDeletionScheduledAt: 1 }` (sparse) for the purge sweep.

### 4.2 New collection `HouseholdKeyEnvelope`
One row per (household, member, keyVersion): the HDK wrapped (sealed box) to that member's public key.
```jsonc
{ householdId, userId, keyVersion, wrappedHDK, createdAt, wrappedByUserId }
```
- Current HDK version stored on `Household.currentKeyVersion`.
- A member unwraps its envelope for each version it needs (to read historical records under lazy rotation).

### 4.3 `Household`
- `currentKeyVersion: number`
- Location fields (`homeAddress/lat/lon`) → **move into an encrypted household-settings record** if D2 = encrypt; otherwise stay plaintext.
- `name`, `joinCode`, `plan`, `revenueCatId`, `usage` stay plaintext (metadata/billing).

### 4.4 Content models (CalendarEvent, Person, MaintenanceTask, …)
- Add `enc` blob + `keyVersion`; **stop storing plaintext content fields** once migrated (kept during migration window, dropped after — §8/§11).
- Keep plaintext `userId, householdId, timestamps` for scope + LWW.
- Indexes that referenced encrypted fields (e.g. `nextDueDate`, `startDate`) are dropped; those queries move client-side.

### 4.5 New collection `AuditLog`
`{ userId, householdId, event: 'deletion_scheduled'|'deletion_canceled'|'deletion_purged'|'key_enrolled'|'member_approved'|'hdk_rotated', at, meta }` — server-side audit for the storage-mode/purge lifecycle (decision 7).

### 4.6 Pending joins `JoinRequest`
`{ householdId, requesterUserId, requesterPublicKey, status: 'pending'|'approved'|'rejected', createdAt, resolvedByUserId }` — powers async approve-on-device (§5).

---

## 5. Membership under E2EE

### 5.1 Approve-on-device join (replaces instant code-join)
1. Joiner enters/【scans an invite (household `joinCode` becomes an **invite handle only — it carries no key**). A `JoinRequest` is created with the joiner's `identityPublicKey`.
2. Joiner UI: "Waiting for a family member to approve." (async pending — decision 6.)
3. Any existing member, when online **and unlocked**, sees the pending request, verifies the joiner (out-of-band, e.g. shows joiner's name/email + a short public-key fingerprint to confirm), and **wraps the current HDK to the joiner's public key** → writes a `HouseholdKeyEnvelope`. Sets `User.householdId` on the joiner.
4. Joiner's next sync finds its envelope, unwraps the HDK, and can read household data.
5. If the joiner was **local-only solo**, this triggers the **local→household transition**: encrypt their local data with the HDK and upload it so the family can see it (decision 6). Join UI must state this.

**Reject any invite-code-carries-key shortcut** (decision 6) — the code never transports the HDK.

### 5.2 Member removal → lazy/versioned HDK rotation (decision 2, agreed)
On removal (or `/leave`):
1. `Household.currentKeyVersion++`; a remaining member generates HDK_vN+1 and writes new envelopes for all remaining members (not the removed one).
2. **Future writes** use HDK_vN+1. Historical records stay at their old version and remain readable by anyone who still holds the old envelope — i.e. **removal protects future data only.** Documented honestly in the removal UI.
3. Optional later enhancement: eager background re-encryption of hot collections. Not v1.
4. `handleDeparture`/ownership-transfer logic (`routes/household.js`) is reworked to trigger rotation and to ensure at least one remaining member re-wraps.

**Edge case to handle:** if the *only other* member is offline at removal time, rotation is queued until a member is online+unlocked; until then new writes still use the old key (the removed member could still read them). Flag in UI ("removal completes when a family member is next online").

---

## 6. Storage-mode + purge flow (decisions 3–7)

### 6.1 Who can pick what
- **Solo (no household):** may choose `cloud` (E2EE) or `local`.
- **Household member:** `local` is **disabled/hidden** with an explanation ("shared family data stays in the encrypted cloud so everyone can see it; E2EE already keeps it private"). No requirement to leave the household.

### 6.2 cloud → local (solo only) — DOWNLOAD-FIRST, never delete an unverified copy
1. User toggles → **blocking confirmation dialog** (states: single-device, no automatic recovery, optional export available).
2. Client fully replicates every record + attachment into the local store, decrypting as it goes.
3. **Verify:** client computes a manifest (per-collection counts + a content hash over record ids/updatedAt/blob hashes), server returns its own manifest, they must match. On success client sends `localReplicaVerifiedAt` + `localReplicaManifestHash`; server records them.
4. **Only then** the server sets `cloudDeletionScheduledAt = now + 7d`, `cloudDeletionState = 'scheduled'`, writes an `AuditLog`, and sends a **confirmation email** ("your cloud copy will be deleted on <date>; switch back before then to cancel").
5. A **persistent in-app countdown banner** shows while a purge is pending.
6. **7-day auto-purge cron** (extend `scheduler.js`): sweep `cloudDeletionScheduledAt <= now && state==='scheduled'`, delete that user's ciphertext + attachments, set `state='purged'`, `AuditLog`, purge email. **No manual "delete now" button.** Never schedules against an unverified replica (guaranteed by step 3).

### 6.3 Undo window
Switching back to `cloud` before the deadline: cancel the scheduled purge (`cloudDeletionScheduledAt=null`, `state='none'`, `AuditLog`, resume sync). If the local copy diverged while offline, reconcile by LWW on `updatedAt`.

### 6.4 local → household
A local-only solo user who joins a household is transitioned to cloud E2EE (§5.1 step 5): encrypt local data with the HDK, upload, cancel any pending purge, resume sync. Join flow communicates this.

### 6.5 household → solo
Leaving a household creates a fresh solo household (existing `/leave`) — user stays on cloud E2EE by default; may *then* choose local (triggering 6.2). Removal triggers rotation (§5.2).

---

## 7. Reconciling broken server features

| Feature | Under E2EE | Mechanism |
|---|---|---|
| **AI** (chat assistants, form-assist, recipe/receipt scan, manual lookup) | **Ephemeral-consent** (decision 1, agreed) | Client decrypts only the needed context and sends it per-request, unstored, gated by existing `aiEnabled`/`aiUsePersonalInfo` toggles, with a per-feature "this sends data to Anthropic" indicator. Image scans send the image bytes ephemerally the same way. `calendarData.js` recurrence expansion moves client-side (mobile already has `recurrence.ts`; port to web + a shared module). Server AI routes become thin proxies that never persist prompt content. Usage metering (counts only) still works. |
| **Push reminders** (both cron paths) | **On-device local notifications** (decision 8, agreed) | Compute from decrypted local data; Expo local notifications on mobile with a **rolling schedule window** (§1.5) + background refresh. Retire the cron's content dependency. Web-push regression (fires only while a tab is open) accepted. Birthdays/tasks/chores/events all move client-side. |
| **Search / sort / filter / pagination** | **Client-side over the decrypted local replica** (decision 7, agreed) | Server returns ciphertext by household + coarse metadata; clients hold a decrypted replica and query it. No blind-search index in v1. Calendar range-filtering happens after downloading the household's (now date-encrypted) events. |
| **Weather** | **Client-side** (D2 = encrypt location) | Each client geocodes/fetches weather from decrypted coords; drop the shared `WeatherRecord` server cache. If D2 = plaintext location, server weather can stay. |
| **Google Places / geocoding** | **Ephemeral-consent** | Client sends the query string per request (autocomplete/geocode), unstored. Same consent surface as AI. |
| **Trip FX** | **Ephemeral-consent or client-direct** | FX rates aren't user-private; client can fetch rates directly or via a stateless proxy. No stored plaintext needed. |
| **Onboarding seed** (categories, self Person) | **Client-side post key-enrollment** | Server can't create plaintext content; move `seedDefaultCategories`/`ensureSelf` into the client after keys exist. |

---

## 8. Three-client parity

- **Shared crypto in `shared/crypto/`** (§3.1) imported by all three; only the libsodium adapter differs per platform.
- **Mobile (Expo):** `react-native-libsodium`, keys in Secure Enclave/Keystore via `expo-secure-store` (already used for the JWT), passkeys via `react-native-passkeys` (PRF where available), local replica in `expo-sqlite`, local notifications via Expo. Richest client.
- **Web (client):** `libsodium-wrappers`, WebAuthn/passkeys with PRF, wrapped keys + local replica in **IndexedDB** (not `localStorage` — too small/insecure for a replica). Web-push regression accepted.
- **Admin:** implements only *login* crypto (enough to authenticate an admin). Post-E2EE the admin app sees **metadata + billing only, never household content** (decision 11, agreed). "Households & plans" needs: household name, joinCode, plan, usage counters — **all metadata, no content** → confirmed it keeps working. **No break-glass**, no content decryption path exists server-side.

---

## 9. Migration (decision 10, agreed — whole-household, all-or-nothing)

1. **Readiness gate:** E2EE cannot be enabled for a household until **every** member has enrolled keys and is on a compatible app version. Show a household-wide readiness checklist.
2. **Re-encrypt client-side:** one member (owner) drives the migration — reads plaintext records, encrypts under the new HDK, writes `enc` blobs (dual-write phase: plaintext + `enc` coexist).
3. **Verify:** manifest compare (like §6.2) confirms every record has a valid `enc` blob decryptable by every member's envelope.
4. **Drop server plaintext:** only after verification, null out plaintext content fields and drop plaintext indexes.
5. **Rollback safety:** until the drop step, plaintext remains authoritative; a failure rolls back to plaintext with no data loss. The drop is the point of no return and is gated behind explicit confirmation + verification.

### 9.1 Prerequisite stack (dependency-ordered — the real path to the drop) — decided 2026-07-06

The drop can't run while the server still reads plaintext content in live code paths (they'd silently break at null-out). Traced readers: `services/calendarData.js` (recurrence expansion of `startDate/endDate/title`), `jobs/scheduler.js` cron (`task.title`, `chore.title`, `person.name/birthday`, `event.title/startDate`), the AI routes (`calendarChat/maintenanceChat/vacationChat/recipes/manuals`), `routes/weather.js` (`Household` location), and `Person.ensureSelf` (creates a plaintext self-Person). There's also a field-coverage gap: calendar `startDate` and `Person.birthday` are deliberately kept plaintext *because* the server needs them.

- **P1 — onboarding self-Person seed → client-side + neutralize `ensureSelf`.** ✅ **DONE** (build/test-verified; dormant). `Household.e2eeActive` flag (default false, flips true only at the drop). `Person.ensureSelf` skips plaintext creation when `e2eeActive` (covers all 6 call sites); `routes/settings.js` self-sync guarded the same way; `GET /household` exposes `e2eeActive`. New idempotent `POST /people/self` stamps `accountId`/`type` server-side and stores the client's encrypted blob. Web (`PeopleView`) + mobile (`PeopleScreen`) seed an **encrypted** self-Person on roster load when `e2eeActive && HDK held && no self` — dormant until the flag flips, so zero behavior change today. *Decided: default Categories stay server-seeded plaintext (low-sensitivity; `Category` isn't in the dual-write set) — revisit under P6.* *Honest note: the client-seed path can't be end-to-end-run until the drop sets `e2eeActive`; the server safety-net neutralization is the substantive, reviewable part. Not unit-tested (the server suite has no DB harness).*
- **P2 — client-side recurrence + range engine (Phase 3b).** ✅ **DONE** (build/test-verified). New pure, dependency-free `shared/calendar` engine (`computeNextDueDate`, `expandRecurring*`, `birthdayOccurrences`, `assembleCalendarData`; 9 `node:test`). Server refactored onto it: `recurrence.js` re-exports the shared `computeNextDueDate` (one impl for tasks/chores/manuals/maintenanceChat), `calendarData.js` is now a thin fetch+populate over the shared assemble (behavior-preserving for `GET /calendar` + the assistant). New `GET /calendar/raw` returns unexpanded source records (+ enc blobs); web (`CalendarView`/`CalendarDayView`/`EventsView`) + mobile (`CalendarScreen`/`CalendarDayScreen`/`CalendarSearchScreen`/`EventsScreen`) now expand client-side via the shared engine over the decrypted replica (offline-first). *Honest remainders: the server-expanded `GET /calendar` + the Calendar Assistant (`calendarChat`) still run the engine server-side (retired at the drop; assistant → P4); the mobile reminder scheduler (`notifications.ts`) still uses `GET /calendar` (→ P3); populated item/category/recipe names still come from server populate during dual-write (post-drop they join from the decrypted replica → P6).*
- **P3 — retire/gate the reminder cron.** ✅ **DONE** (build/test-verified). `scheduler.js` skips `e2eeActive` households in both cron paths (`runDailyCheckForHousehold` daily tasks/chores/birthdays + `fanOutEventReminder` event reminders) — dormant pre-drop, +1 test (server suite 23). Mobile `notifications.ts` now computes reminders from the shared client engine (`loadCalendarData` over the decrypted replica) instead of `GET /calendar`. The per-user `localReminders` guard (5a) still handles pre-drop dual-write dedup; the `e2eeActive` skip is the post-drop retirement (web-push regression accepted per §1.5).
- **P4 — AI routes → ephemeral-consent** for the remaining surfaces (calendar/maintenance/vacation chat, recipe/receipt scan, manual-extract).
- **P5 — location encryption + client weather** (D2 as-built). ✅ *Decided 2026-07-06: encrypt `Household` location + move weather client-side.*
- **P6 — close dual-write field/collection gaps** (full-field coverage on the 9 collections; deferred thin collections; `Household` location; possibly `Category`).
- **P7 — replica at-rest = ciphertext** (store `enc`, decrypt-in-memory; D5 expo-sqlite).

*Still-open blocked items (resurface at P6/4c): cross-household trip attachments (outside the single-household HDK model) and mobile-full attachments (needs `expo-file-system` + dev-client rebuild).*

---

## 10. Metadata leakage — what the server still learns

Enumerated and (proposed) accepted:
- **Per record:** existence, owning `userId`, `householdId`, `collection` type, `createdAt`/`updatedAt`, `keyVersion`, ciphertext **size**. → reveals *activity volume and rough record types/timing*, not content.
- **Household graph:** who is in which household, when members join/leave, household **name** + **joinCode** (D3), owner.
- **Billing:** plan, RevenueCat id (= householdId), usage **counts** per action type (chat/scan/gen/manual) — reveals *how much* AI is used, not what.
- **Files:** count, size, contentType (if kept), timing.
- **Timing/IP** from requests (as any server).

**Not learned:** any record content, titles, dates, addresses, notes, people, images, AI prompts (ephemeral, unstored), passwords/keys (only ciphertext).

Sensitive-ish leaks to explicitly accept: **household name**, **record-type + volume + timing**, **AI usage volume**. Recommend documenting these in a short "what we can and can't see" user-facing note.

---

## 11. Phasing (shippable, with rough effort + top risks)

Effort is relative T-shirt sizing for a solo dev; "risk" = biggest thing that can sink the phase.

**Phase 0 — Foundations & shared crypto package** · *M* · ✅ **DONE**
`shared/crypto/` + libsodium adapters (web + RN), record/file ciphertext helpers, unit tests. No product surface yet.
*Delivered:* platform-agnostic core (`core.ts`) over an injected `Sodium` interface; `adapters/web.ts` (`libsodium-wrappers-sumo`) + `adapters/native.ts` (`react-native-libsodium`); identity keypair, per-factor private-key wrapping (Argon2id / PRF / recovery), HDK sealed-box envelopes, AAD-bound record AEAD, and chunked file encryption; 14 passing `node:test` tests. See `shared/crypto/README.md`.
*Remaining risk carried forward:* `react-native-libsodium` JSI integration must still be validated in an actual Expo dev-client build (the native adapter compiles but hasn't run on-device).

**Phase 1 — Key management + factors (identity keypair, password-KEK, recovery code)** · *L* · ✅ **DONE + ON-DEVICE VERIFIED** (iOS simulator)
`User` key fields + wrapped-private-key envelopes; enroll on register/login; recovery-code generation UI; login-vs-data-recovery separation copy (decision 4). Passkey-PRF enrollment added here **where available** (progressive — 1.1).
*Delivered + verified:*
- **Server:** `User` key fields + per-factor envelope subschema (`models/User.js`); blind-store `/api/keys` routes — `GET /me`, `POST /enroll` (idempotent), `PUT /factors` (add/rotate), `DELETE /factors/:factor` (with last-factor guard), `GET /public/:userId` (household-scoped); pure shape-validators (`services/keyEnvelope.js`) with **10 unit tests**. Wired into `index.js`. Full server suite green (16 tests).
- **Shared:** `createEnrollment` orchestration in `@household/crypto` (enroll / unlock-by-password / unlock-by-recovery / rewrap / regenerate), **6 unit tests** incl. end-to-end unlock→HDK→decrypt. Crypto suite green (20 tests).
- **Web:** `keysApi`; `services/e2ee.js` session (in-memory keypair, never persisted); enroll/unlock wired into the Pinia auth store on login/register + `lock()` on logout; one-time `RecoveryCodeDialog.vue` with login-vs-data-recovery copy. **`vite build` passes** with the linked TS crypto package (libsodium aliased to its CJS entry to dodge the broken ESM build).
- **Mobile:** `keysApi`; `lib/e2ee.ts` session mirroring web (subscriber store for the one-time code); wired into the auth context; `RecoveryCodeModal.tsx`; `metro.config.js` for the linked package.
*Mobile verification done (short of a physical device):*
- Installed `react-native-libsodium@^1.7.0` + the linked `@household/crypto`.
- **Verification caught two real cross-platform bugs** — react-native-libsodium omits `from_string`/`to_string` AND the entire `crypto_secretstream` family. Fixed by making the core depend only on primitives common to both bindings: UTF-8 via `TextEncoder`/`TextDecoder`, and **file encryption rewritten as chunked AEAD** (each chunk `nonce||ct` with index+count bound as AAD → drop/add/reorder all fail). Also: react-native-libsodium gates Argon2 behind `loadSumoVersion()` on its web path — the native adapter now calls it defensively.
- **The shared core runs correctly against the real react-native-libsodium exported surface** (record AEAD + AAD binding, sealed-box HDK envelopes, generichash-KEK factors, chunked files + reorder rejection, recovery codes) — every primitive **except Argon2**, which is compiled into the native JSI build only and isn't reachable from a Node harness.
- **Mobile TypeScript typechecks clean (0 errors)** and **Metro bundles the full iOS app to Hermes bytecode** with the E2EE integration + linked package (`allowImportingTsExtensions` + an ambient module decl were needed for consumer tsc).
*On-device verification (iPhone 17 Pro simulator, dev-client build) — PASSED.* A dev-client was built (`expo run:ios`, CocoaPods installed via Homebrew, `react-native-libsodium` autolinked) and a temporary startup self-test ran the full path on the JSI native module: **native Argon2id enroll + unlock, sealed-box HDK envelope, and record AEAD roundtrip all succeeded** (`E2EE_SELFTEST PASSED`). Self-test since removed.

*Three more native-binding incompatibilities the on-device run caught (all fixed in the shared core, all clients still green):*
1. `react-native-libsodium` omits `from_string`/`to_string` and `crypto_secretstream` → UTF-8 via `TextEncoder`/`TextDecoder`; file encryption via chunked AEAD (found during static parity check).
2. Native exposes only the `*_INTERACTIVE` Argon2 limits, not `*_MODERATE` → work factors (opslimit 3 / memlimit 256 MiB) set explicitly in the core and stored per-envelope.
3. Native AEAD **requires a string `additionalData`** (throws on `Uint8Array`/`null`), unlike libsodium-wrappers → AAD passed as a string (both bindings UTF-8-encode it identically, so cross-platform ciphertext stays compatible).

*Web:* build-verified; enroll/unlock not yet run against a live server+Mongo. Passkey/WebAuthn-PRF still needs a real browser/authenticator.
*Remaining sub-items — now done (web build-verified):*
- **Rewrap-on-password-change:** both `AccountSection.vue` and mobile `AccountScreen.tsx` re-wrap the key under the new password after `updatePassword` (best-effort; a locked session keeps the old factor).
- **Passkey / WebAuthn-PRF (web):** `enrollPasskey` / `unlockWithPasskey` in `services/e2ee.js` (PRF-extension KEK, capability-gated), with an "Add passkey" action in the Account screen. Progressive per D1.
- **Recovery-code unlock ("locked" case):** `UnlockDialog.vue` (passkey or recovery code) driven by a new `auth.e2eeLocked` flag; mounted globally.
- **Regenerate recovery code:** Account-screen action on both clients (web routes the new code to `RecoveryCodeDialog`; mobile surfaces it via the modal's subscriber store).
*Still deferred (needs verified-mobile / real devices):* **mobile passkey** (react-native-passkeys — another native module) and a **mobile unlock modal** for the locked case; these land when the mobile toolchain is verified. Reload-time unlock (re-prompt for password after app restart) is a known Phase-1 limitation — harmless until records are encrypted (Phase 3+).
*Risk:* factor UX + "at least one factor must survive" safety (server-guarded ✅); react-native-libsodium JSI + WebAuthn-PRF both need real-device verification.

**Phase 2 — HDK + household envelopes + approve-to-join** · *L* · ✅ **DONE** (build/test-verified; on-device deferred)
`HouseholdKeyEnvelope`, `Household.currentKeyVersion`, `JoinRequest`, approve-on-device flow replacing instant join, public-key fingerprint verification, async pending state.
*HDK-minting decision (resolved):* **owner mints lazily on first unlock, self-healing.** Every household is founded solo, so the founder mints HDK v1 and self-wraps it. An idempotent `ensureHouseholdKey()` runs after each unlock: unwrap my envelope if present; else if I own a keyless household (`currentKeyVersion === 0`) mint v1 and self-wrap; else stay keyless (pending approval). The mint claims v1 via an atomic `findOneAndUpdate({currentKeyVersion: 0})` so a race can't produce two v1s.
*Delivered:*
- **Shared:** `publicKeyFingerprint(pubB64)` (generichash → six Crockford-base32 groups) for out-of-band verification; +1 test (crypto suite **22**). No new native primitive — `crypto_generichash` was already on-device in Phase 1.
- **Server:** models `HouseholdKeyEnvelope` `{householdId,userId,keyVersion,wrappedHDK,wrappedByUserId}` (unique per member+version), `JoinRequest` `{householdId,requesterUserId,requesterPublicKey,status,resolvedByUserId}`, `AuditLog` (writes `hdk_minted` + `member_approved` now; purge-lifecycle events deferred to Phase 6); `Household.currentKeyVersion`. Shape-validator `services/householdKey.js` (+**4** tests → server suite **20**). `routes/household.js` reworked: `POST /household/join` now opens a pending `JoinRequest` (no membership change); `GET/DELETE /household/join-requests/mine`, `GET /household/join-requests`, `POST /household/join-requests/:id/approve|reject`, `GET/POST /household/key`. Approve writes the envelope, moves the requester's `householdId`, runs the existing category-dedupe merge + `handleDeparture`, and re-checks the requester's live key still matches the pinned `requesterPublicKey` (rejects mid-flight key change).
- **Web + Mobile:** `ensureHouseholdKey` / `getHDK` / `wrapHDKForJoiner` / `publicKeyFingerprint` in `e2ee.js` / `lib/e2ee.ts`; auth store/context calls `ensureHouseholdKey()` after unlock (best-effort, never blocks login); `householdApi` extended; `HouseholdView.vue` / `HouseholdScreen.tsx` replace instant join with request → "waiting for approval" (5s polling) and an approver card that shows each requester's fingerprint + Approve/Reject.
*Verified:* `shared/crypto` 22 + `server` 20 tests green; `client` build clean; `mobile tsc --noEmit` clean; `expo export --platform ios` bundles to Hermes.
*Honest scope note:* records are still plaintext until Phase 3, so an approved joiner reads household data exactly as before — the HDK/envelope path is built and exercised but is **not yet a live security boundary**. A cross-household *merge* (a joiner who already had their own data) currently just moves membership + grants the HDK; re-encrypting that pre-existing data under the new HDK is a Phase 3/migration concern.
*Deferred:* on-device dev-client run (the sealed-box + generichash primitives already passed on-device in Phase 1; no new native surface); real-time approver notification (Phase 2 uses polling); member removal / HDK rotation stays Phase 7.
*Risk (carried):* offline-approver UX; correctness of sealed-box wrapping to joiner.

**Phase 3 — One encrypted vertical slice on all three clients (Calendar)** · *L*
End-to-end encrypt CalendarEvent only: client encrypt/decrypt, client-side recurrence + range filtering, dual-write migration for this one collection, admin confirmed content-blind. Proves the whole stack including web+mobile+admin parity.
*Risk:* moving `calendarData.js` recurrence expansion client-side without regressions; the local replica plumbing debuts here.

**Phase 3a — dual-write crypto slice for CalendarEvent** · ✅ **DONE** (build/test-verified; on-device deferred)
*Decision (2026-07-03):* split Phase 3 into **3a (dual-write, plaintext authoritative)** now and **3b (client-side recurrence/range + plaintext drop + local replica)** later, coupled to Phase 5. Rationale: `CalendarEvent` content is read server-side in **three** places — the calendar range query + recurrence expansion (`calendarData.js`), the AI assistant (`calendarChat.js`), and the reminder cron (`scheduler.js`) — and neither client expands recurring events today (the server does it entirely). Dropping plaintext therefore *requires* the Phase 5 AI (ephemeral-consent) + reminder (on-device) reconciliations to already exist, and building a brand-new shared event-expansion engine. 3a retires the crypto-integration risk cheaply without any of that; 3b's risk is inseparable from Phase 5.
*Delivered (dual-write — `enc` written alongside plaintext; plaintext stays authoritative so AI/reminders/range-queries keep working):*
- **Shared:** `randomBytes(n)` added to the core (both bindings expose `randombytes_buf`) for client-minted record ids; `encryptRecord`/`decryptRecord` already existed. Crypto suite still **22**.
- **Server:** `CalendarEvent` gains `keyVersion` + `enc {alg,nonce,ct}` (plaintext fields untouched). `routes/calendar.js` accepts a client-minted `_id` (24-hex, so the AAD can bind before the round-trip) + `enc` + `keyVersion` on create/update, validated by `validateRecordEnvelope` (`services/householdKey.js`, +**2** tests → server suite **22**). `GET /household/key` now also returns `householdId` so the session can bind the AAD authoritatively. `calendarData.js`/collect unchanged — server still expands from plaintext.
- **Web + Mobile:** `e2ee` sessions track `hdkVersion` + `hdkHouseholdId` (captured in `ensureHouseholdKey`); new `newObjectId` / `encryptRecord` / `decryptRecord` helpers (mobile `newObjectId` is async via the sodium CSPRNG — no `getRandomValues` polyfill present). Event form **encrypts on create/update** (mints `_id` on create) and **decrypt is load-bearing on edit** — the form populates from the decrypted `enc` when the HDK is held, falling back to server plaintext otherwise. All no-ops without an HDK, so nothing blocks saving.
- **Admin:** never reads `CalendarEvent` → content-blind for this collection is trivially already true.
*Verified:* `shared/crypto` 22 + `server` 22 tests green; `client` build clean; `mobile tsc --noEmit` clean; `expo export --platform ios` bundles to Hermes. *On-device deferred* (Metro dev server is up; a create→edit round-trip on the simulator would exercise native encrypt+decrypt end-to-end — same primitives already validated in Phase 1).
*Honest scope note:* records are **not yet plaintext-free** — this is dual-write, so the server (and anyone with DB access) still sees event content until the 3b verified drop. The security boundary isn't live yet; 3a proves the crypto plumbing works end-to-end on a real collection through server + web + mobile.
*Deferred to 3b (with Phase 5):* shared client-side event recurrence + range engine, the §9 verified plaintext drop, and the local replica.

**Phase 4 — Roll out to all collections + client-side query + local replica store** · *XL*
Encrypt every content model; build the local decrypted replica (expo-sqlite / IndexedDB) + client-side search/sort/filter/pagination; encrypt file attachments + upload/download changes.
*Risk:* the biggest phase — building a real offline datastore that today doesn't exist; attachment streaming crypto.

**Phase 4a — dual-write rollout to core content collections** · ✅ **DONE** (build/test-verified; on-device deferred)
*Decision (2026-07-03):* of Phase 4's three independent workstreams (more collections / local replica / attachments), do the **collection rollout** first — mechanical, always-green, and it makes ciphertext exist app-wide. The local replica + client-side query and attachment crypto stay as separate later slices (4b/4c).
*Reusable pattern (built once, applied everywhere):*
- **Server:** `models/encFields.js` (shared `{ keyVersion, enc{alg,nonce,ct} }` schema fragment) spread into each content model; `services/householdKey.js` gains `isObjectId` + `pickRecordEnc` (validates the ciphertext shape, now with a record-sized ct cap — the 4096-char key-envelope cap would have wrongly rejected long recipes/notes). Routes that mass-assign `req.body` (tasks/chores/recipes) accept `_id`/`enc` for free under strict-mode; routes that destructure/whitelist (people/trips) call `pickRecordEnc` explicitly. `calendar.js` refactored onto the shared helpers.
- **Clients:** `e2ee` gains `sealNew` / `sealUpdate` / `openRecord` one-liners (with an optional **content-subset** arg — foreign keys, server-scheduled dates, and routing enums stay plaintext so decrypt-on-load can merge safely without clobbering populated refs). Calendar refactored onto them.
*Collections covered (model + route + web form + mobile form, encrypt-on-save + decrypt-on-load): **CalendarEvent, Person, MaintenanceTask, Chore, Recipe, Trip.*** Decrypt is load-bearing in each edit path (and in the People rosters). All paths no-op without an HDK, so nothing blocks saving.
*Verified:* `shared/crypto` 22 + `server` 22 tests green; `client` build clean; `mobile tsc --noEmit` clean; `expo export --platform ios` bundles to Hermes.
*Honest scope note:* still dual-write — plaintext remains authoritative and server-visible for every collection; the boundary goes live only at the §9 verified drop (needs Phase 5 reconciliations first). Encryption covers a **content subset** per record, not yet every field.
*Remaining for a later 4a pass (same mechanical pattern):* Item, FoodInventory, TripItem, RecipeSchedule, Category, OdometerLog, and template-created tasks/chores (no create form). Then 4b (local replica + client query) and 4c (attachment/blob crypto).

*Second 4a pass (2026-07-03) — DONE:* extended the same pattern to **Item, FoodInventory, TripItem** (model `...encFields` + route `pickRecordEnc`/`_id` + web form + mobile form, encrypt-subset-on-save + decrypt-on-load; inventory + people rosters decrypt their lists). **Nine collections now dual-write:** CalendarEvent, Person, MaintenanceTask, Chore, Recipe, Trip, Item, FoodInventory, TripItem. TripItem uses a deliberately narrow subset (`title/location/url/phone/notes/details`) that avoids its cost/sharing/confirmation logic. Verified: `server` 22 green, `client` build clean, `mobile tsc` clean, `expo export ios` bundles (5.7 MB).
*Intentionally deferred (thin metadata / low value):* RecipeSchedule (recipeId + date), Category (name/icon/color; also has server-side dedupe), OdometerLog (number + date), and template-created tasks/chores (server-minted — they gain `enc` on first client edit). These carry little private content and can wait for the plaintext-drop phase.

**Phase 4b — local replica + client-side query (foundation)** · ✅ **FOUNDATION DONE** (build/test-verified)
*Key design realization:* during **dual-write the server still returns full plaintext records**, so the replica's job right now is an **offline cache of full records + client-side query** — the D5 "store ciphertext, decrypt-in-memory" model only becomes necessary at the plaintext drop (when `enc` covers every field). Same `ReplicaStore` interface serves both.
*Delivered:*
- **Web:** `client/src/services/replica.js` — IndexedDB store (one `records` store keyed by `_id`, indexed by collection): `upsert` (LWW on `updatedAt`), `getAll`, `query({filter,sort})`, `remove`, `clear`.
- **Mobile:** `mobile/src/lib/replica.ts` — same interface over **AsyncStorage** (interim backend, runs on the current dev client with **no native rebuild**). **D5 = expo-sqlite** remains the target store; swap it in behind this interface after an `expo install expo-sqlite` + dev-client rebuild.
- **Reusable helper:** `replica.syncedList(collection, fetcher)` — fetch + sync + offline-fallback in one line, so a list screen is a two-line change.
- **Wired offline-first (list screens):** People (web + mobile), **Recipes** (web `RecipesView` + mobile `RecipesPane`), **Items** (mobile `ItemsListScreen`), **Trips** (web `VacationsView` + mobile `VacationsScreen`), **Chores** (web `ChoresDashboardView` + mobile `ChoresScreen`), **FoodInventory** (web `InventoryView` active list + mobile `InventoryPane`). Each syncs the replica on fetch, falls back to the cached copy when the network is down, and decrypts content via `openRecord` — so the read+decrypt+query path is load-bearing across the primary lists of every dual-write collection. *(Status-bucketed dashboards — maintenance Tasks by overdue/due-soon/etc. — stay server-only for now; they issue several filtered queries and are a poorer fit for a single cached list.)*
*Verified:* `server` 22 tests green; `client` build clean; `mobile tsc` clean; `expo export ios` bundles.
*Foundation — remaining for full 4b:* swap the mobile backend to **expo-sqlite** (D5); **at-rest encryption** of replica rows (store `enc`, decrypt into memory) — lands with the plaintext drop; use the client-side `query({filter,sort})` to actually *replace* server-side list queries (currently additive — the server list still drives, replica is a cache/offline fallback); the calendar range-filter relocation; pagination.
**Phase 4c — attachment/blob encryption** · ⏳ **MANUALS SLICE DONE (web full; mobile graceful); other surfaces + mobile-full remain**
The crypto was already complete; the **two-party attachment flow is locked by a `shared/crypto` test** (uploader encrypts+wraps, another member unwraps+decrypts, AAD-bound to the owning record; crypto suite **23**). Attachment encryption is **all-or-nothing per surface, gated by an `encrypted` flag** so plaintext files keep working.
*Delivered (Manuals):*
- **Shared client helpers:** `encryptAttachment(collection,id,bytes)` / `decryptAttachment(...)` in web `e2ee.js` (chunked `encryptFile` + HDK-wrapped file key, serialized for upload).
- **Server:** `Manual` gains `{ encrypted, wrappedFileKey, keyVersion }`; upload accepts the ciphertext + wrapped key + a client-minted `_id` (AAD binding); download serves `application/octet-stream` when encrypted; `extract-tasks` **refuses** encrypted manuals (server can't read them → Phase 5 ephemeral-consent).
- **Web (full):** `ItemDetailView` encrypts the file client-side before upload (when unlocked) and, on view/download, fetches the ciphertext with auth, decrypts, and opens it via a **blob URL**; a lock icon marks encrypted manuals.
- **Mobile (graceful, no breakage):** detects `encrypted` manuals — shows a 🔒 + "open on web" alert instead of opening ciphertext; **mobile uploads stay plaintext** for now (encrypting/decrypting file bytes needs `expo-file-system`, i.e. a native dep + dev-client rebuild).
*Verified:* `shared/crypto` 23 + `server` 22 green; `client` build clean; `mobile tsc` clean; `expo export ios` bundles. *(PDF blob-URL rendering itself still wants an app-run check.)*
*Remaining 4c:* **mobile full support** (add `expo-file-system`, read picked-file bytes → encrypt → upload, and download → decrypt → temp file → open); apply the same pattern to **item photos, receipt images, and TripItem attachments**; client-side thumbnails pre-encryption.

**Phase 5 — Reconcile AI / push / weather / places / FX** · *L*
Ephemeral-consent plumbing + per-feature indicators; on-device local notifications with rolling window; client-side weather; onboarding seed moves client-side.
*Risk:* iOS 64-notification cap + background-refresh reliability; AI feature parity when context assembly moves client-side.

**Phase 5b — AI consent enforcement + transparency (mobile FormAssist)** · ✅ **DONE** (build-verified)
Found a real gap: the mobile `privacyPrefs` toggles (`aiEnabled` / `aiUsePersonalInfo`) were **stored but not enforced** in `FormAssist` (the shared "fill with AI" panel used across most add/edit screens). Now: with **AI off the panel doesn't render** (nothing is ever sent), personal/contact context is only attached when `aiUsePersonalInfo` is on, and a per-panel **"…is sent to Anthropic to fill the form"** indicator (naming contacts when included) makes the data flow explicit. Web has no AI form-fill/toggle, so this is correctly mobile-scoped. *Verified: `mobile tsc` clean; `expo export ios` bundles.* *Remaining AI work:* extend the same enforce-toggle + indicator to the other AI surfaces (chat assistants, recipe/receipt scans, manual extract); post-drop, assemble AI context from the decrypted replica instead of server plaintext.

*Scope findings (2026-07-06):* **Places/FX are already effectively ephemeral** — the places proxy stores no user content (only a `TravelLeg` cache keyed by placeIds); D8 is essentially satisfied. **AI consent toggles already exist** as mobile `privacyPrefs` (`aiEnabled` / `aiUsePersonalInfo`) — the remaining AI work is a per-feature "sends data to Anthropic" indicator + (post-drop) client-side context assembly. **Client-side weather is blocked** until home location gets the dual-write/encrypt treatment (it's still plaintext on `Household`). **Onboarding seed** (`seedDefaultCategories` + `Person.ensureSelf` on register) still needs to move client-side — a prerequisite for the drop.

**Phase 5a — on-device local notifications** · ✅ **DONE** (build-verified; runnable on the simulator)
Reconciles push reminders → **Expo local notifications computed on-device** (`expo-notifications`, already installed).
*Delivered (mobile):*
- `lib/notifications.ts` — `rescheduleReminders()` fetches the calendar range (today…+21d), computes reminder instants for **events** (`startDate − reminderMinutes` / `alert2Minutes`), **tasks & chores** (`nextDueDate − reminderDaysBefore` / `alert2DaysBefore` at local 7am, mirroring `scheduler.js`), and **birthdays** (7am on the day), then cancels the old batch and schedules the **soonest 60 within the window** (headroom under the iOS ~64 pending cap). Permission is prompted on first schedule; offline/denied → 0 scheduled, no throw.
- `hooks/useReminderScheduler.ts` — reschedules while signed in and on every app **foreground** (the rolling-window refresh); cancels on sign-out. Wired in `RootNavigator`.
*Verified:* `mobile tsc` clean; `expo export ios` bundles. Local notifications fire on the iOS simulator (unlike push tokens), so this is testable on the running sim.
*Server cron guarded (no duplicates):* a per-user `User.localReminders` flag — the mobile app sets it (`POST /notifications/local-reminders`) once it's actively scheduling with permission, and both cron paths (`runDailyCheckForHousehold` daily alerts + `fanOutEventReminder` event reminders) **skip flagged users**, so a physical device won't get a server push *and* a local notification. The client change-guards the API call (only on state change) and clears it on sign-out so a different user on the same device re-syncs. (Trade-off: the flag is per-user, so a user who relies on web-push for reminders but also runs the mobile app would have server reminders suppressed — acceptable given web-push only fires with an open tab.)
*Honest notes / remaining:* computes from the **calendar range endpoint** (server plaintext) for now — post-drop the same `computeReminders` runs over the decrypted **local replica**. Background-refresh (tighter than foreground-only) + a user-facing on/off toggle + Android channel polish are follow-ups.

**Phase 6 — Storage-mode toggle + download-first + 7-day purge** · *M*
Wire `dataStorage` to real behavior; download-first verify; server `cloudDeletion*` fields + purge cron in `scheduler.js`; countdown banner; confirmation/purge emails; `AuditLog`. Enforce member-can't-go-local, solo-only-local, local→household + household→solo transitions.
*Risk:* the "never delete an unverified copy" guarantee + undo-window correctness.

**Phase 7 — Member removal / HDK rotation + whole-household migration + optional encrypted export** · *M*
Lazy/versioned rotation + re-wrap on removal/leave; readiness-gated all-or-nothing migration with rollback; solo local-only encrypted export (Files/iCloud/Drive).
*Risk:* rotation when approvers are offline; migration point-of-no-return safety.

**Rough critical path:** 0 → 1 → 2 → 3 prove the architecture; Phase 4 is the bulk of the work; 5–7 are independent-ish and can reorder. Phases 3 and 4 carry the most technical risk (client replica + recurrence relocation); Phase 1 carries the most *user-harm* risk (lost-factor = lost data).

---

## 12. Summary of what I need from you

Approve/adjust the 8 open decisions in §2 (esp. **D1 passkey-vs-password baseline**, **D2 location/weather**, **D3 household name**), confirm the added scope (**attachment encryption**, **client replica is net-new work**), and confirm the phasing. On sign-off I'll start at Phase 0.
