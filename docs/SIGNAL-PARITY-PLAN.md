# Signal-Parity Privacy Plan

> **This is a historical roadmap + ops runbook, not a spec.** The buildable plan
> is **COMPLETE** (only E3, a third-party audit, remains — an ops/comms task, not
> code). For **what the system does today**, read `specs/` — the shipped behavior
> from this plan is folded into: `specs/platform/{crypto-e2ee,data-model,api-reference}.md`
> (C1–C5 opaque store, padding, author-hiding), `specs/features/households-sharing.md`
> (A1/A2/B1–B3 alerts, safety numbers, rotation/retirement; C2 sealed household
> name), `specs/features/auth-identity.md` (A3/A4 screen-lock, F1–F4 auth
> hardening + QR linking), `specs/features/ai-assistant.md` (G1/G4 minimization +
> query-scoping), and `specs/features/{calendar,trips}.md` (D1–D3 resource keys +
> sealed invitations). This file is kept for the decision history and the prod
> re-seal/re-drop **ops runbook** (bottom of file).

Status: **IN PROGRESS — phases A, B, F (minus F4/F6), G (minus G4) + C1/C2/C3/C4/C5, D1–D5, E1/E2/E4/E5 built 2026-07-17…20 (see §0.1, ten execution passes); pass 3 closed the steady-state write rule + shipped the re-seal/re-drop backfill; pass 4 shipped D1 (per-resource CalendarKeys for outside-shared calendars); pass 5 shipped D2 (per-resource TripKeys for shared trips + trip attachments); pass 6 shipped D3 (event invitations sealed to known accounts); pass 7 shipped C4 (hide record authorship — householdId attribution + sealed author); pass 8 froze the C3 opaque record envelope (the one-time `alg`/version bump) + built the additive unified `Record` store; pass 9 shipped C3b (the destructive store cutover — the ~9 content collections' data + reads + writes + AI feeds + every mobile screen moved onto the unified opaque `Record` store, closing the last metadata leak: the server can no longer learn a row's collection); pass 10 closed the C3b cleanup loose ends (deleted the vestigial `/calendar` aggregate + `/calendar/events` CRUD routes + `services/calendarData.js`, re-pointed the D1 reconcile onto the `/records` resource lane, added the orphaned-EventAttachment reaper) and shipped E5 (the build-verifiability spike, documented in `docs/TRANSPARENCY.md`); pass 11 shipped F4 (QR device linking — a blind server relay ferries the identity keypair sealed to a new device's ephemeral key) + F6 (the transport-hardening spike, documented in E1); pass 12 shipped G4 (query-scoped AI context — the calendar assistant now sends only a conversation-derived date window of decrypted sources, recurrence-safe). Only E3 (third-party audit) remains, and it is an ops/comms engagement, not code — the buildable plan is COMPLETE.** Track per-item checkboxes below; move items to the status snapshot as they land.
Author: design pass 2026-07-16, derived from a gap analysis of the current E2EE architecture (`docs/E2EE-SYNC-PLAN.md`, the source of truth for everything already built) against Signal's privacy model.

---

## 0. Scope contract (user-set constraints)

Do **everything** from the gap analysis **except** where it would block a user feature. Two named constraints:

1. **Email invites stay.** Household, trip, calendar, and event invitations remain email-addressed. Consequence: the invitation *discovery* channel stays email, but key material never rides in it (already true — D7). The one lane email interop genuinely forces is the **event-invitation plaintext snapshot for recipients without accounts** (§9.4 of the E2EE plan) — that stays, minimized (D3 below).
2. **Existing AI features stay.** Ephemeral-consent cloud AI (Anthropic) remains; on-device inference is out of scope. Consequence: consented prompt content is visible to Anthropic per-request, unstored — this is a **documented accepted gap** (E1), not a work item.

Everything else — including admin/support UX degradations (encrypted household name, lost per-collection counters) — is fair game: those are internal costs, not user features.

## 0.1 CURRENT STATUS SNAPSHOT

*(update this section as items land, E2EE-plan style)*

> **2026-07-17 — execution pass 1 (build/test-verified: server suite 200 incl. 9 new
> integration tests, `shared/crypto` 25, mobile jest aiPayload 4, mobile tsc 0):**
> **Phases A, B, F (minus F4/F6), and G (minus G4) are BUILT.**
> - **A1** securityAlerts fan-out on factor add/remove, passkey sign-in credential add,
>   HDK rotate, member approve/remove (+ new AuditLog events). **A2** `lib/safetyNumbers.ts`
>   + HouseholdScreen member badges/verify sheet, local verified state resets on key
>   change. **A3** `expo-screen-capture` (graceful until the next dev-client build) +
>   `PrivacyShield` app-switcher cover + Privacy toggle (`screenSecurity`, default on).
>   **A4** `useAppLock` background relock (Never/0/1/5 min chips in Sign-in & Security).
> - **F2** `User.sessions[]` + JWT `sid` + revocation check in `requireAuth` (legacy
>   tokens upgraded at sliding refresh) + Devices card with revoke; device-name headers
>   from the mobile client. **F1** `/auth/reset` hold window (`resetHoldUntil`,
>   `RESET_COOLDOWN_HOURS` default 24) for protected accounts on unknown devices, with
>   known-device bypass (valid session token), `/auth/reset/cancel`, in-app banner +
>   cancel, ForgotPassword 202 handling. **F3** new-device push+email
>   (`sendNewDeviceAlert`) on unfamiliar-device sign-in.
> - **G1** `mobile/src/lib/aiPayload.ts` alias context (strip metadata keys, alias every
>   ObjectId-shaped string, resolve aliases in tool results via `useChat.transformResult`)
>   wired into calendar/maintenance/trip assistants; `PATCH /calls/:id/link` +
>   client link-back keeps the confirmed-cancel flow working with aliased ids.
>   **G2** `aiPayload.test.ts` pins the no-ObjectIds/no-metadata property. **G5** verified:
>   Vapi prompt already minimal, transcripts never persisted; PhoneCall row documented as
>   a deliberate hand-off (E1). **G3** documented in `docs/TRANSPARENCY.md` with the ops
>   action flagged (request ZDR from Anthropic — Ben).
> - **B1** `GET /household/e2ee/old-versions` + client `reencryptOldVersions`/
>   `maintainKeyHygiene` (runs post-unlock and after removal rotation). **B2**
>   `Household.lastKeyRotationAt` + daily cron flags stale keys
>   (`KEY_ROTATION_INTERVAL_DAYS`, default 90). **B3** `POST /household/key/retire`
>   deletes drained old envelopes; refuses (409) while any record or attachment file key
>   still needs an old version.
> - **C1** ciphertext padding in `shared/crypto` (256 B–4 KiB power-of-two buckets, then
>   4 KiB steps; trailing-space padding = no envelope version bump, old/new clients
>   mutually compatible). **C5** scheduler logs now ids-only; EmailLog subjects mask digit
>   runs (found + fixed: reset codes were persisting in stored subjects); no request-body
>   logging anywhere; retention policy written. **E1** `docs/TRANSPARENCY.md` + in-app
>   "What we can and can't see" card in Privacy & data.
> - **Needs user action:** EAS dev-client rebuild (A3 screen-capture + existing native
>   deps); G3 ZDR request to Anthropic; on-device walk-through of A2/A4/F1/F2 UI.
> - **E2** `docs/CRYPTO-SPEC.md` written from the implementation (publish = ops action).
> - **E4** legal-requests policy + transparency-report commitment added to `docs/TRANSPARENCY.md`.
> - **Not started (each needs its own pass — designs above are current):** D1–D3, C3,
>   C4 (structural: per-resource keys, opaque envelopes/authorship), E3 (audit —
>   schedule after C-phase), E5 (spike), F4 (QR linking — camera dep), F6 (pinning
>   spike), G4 (quality-gated), plus the two pass-2 inserts below (steady-state
>   write rule; re-seal + re-drop backfill).

> **2026-07-17 — execution pass 2 (build/test-verified: server 201, `shared/calendar`
> 28 incl. 5 new km/anchor tests, mobile jest 118, tsc 0, expo export ✓):**
> **D4 + D5 (one pass) and C2 are BUILT** — see the per-item notes above for what
> landed where. Highlights / discoveries:
> - The km-scheduling engine (`avgKmPerDay`/`estimateDateFromKm`/`computeNextDueKm`)
>   plus `anchorRecurrence`/`seedDueDate` moved into `shared/calendar`; the server's
>   `services/recurrence.js` is now a pure re-export. Client enc subsets are
>   centralized in `mobile/src/lib/encSubsets.ts` (they had already drifted between
>   screens — the form sealed fewer task fields than the assistant; now one source,
>   mirroring `DROP_FIELDS`, with edits merging the decrypted record under the update
>   so partial re-seals can't drop fields).
> - Deleting the server template/manual instantiation routes closed a real
>   **write-guard bypass** (they minted plaintext records with no `enc`).
> - The server grocery-list aggregation read sealed `Recipe.ingredients` — it could
>   never work post-drop; it's now client-side (`lib/groceryList.ts`) and the route
>   is gone.
> - `POST /tasks/:id/complete` previously ran `task.save()`, which would have thrown
>   full-document validation on any post-drop task (required `title` nulled) — the
>   content-blind rewrite also fixes that latent bug.
> - C2's household blob seal is now part of the client straggler pass
>   (`dropMigration.sealHouseholdBlob`) — mandatory, since every household has a
>   name and the drop refuses to commit while it's unsealed. (Found + fixed along
>   the way: `Household.enc` is a mongoose nested path, truthy even when unset —
>   the drop script now tests `enc.ct`.)
> - **Flagged (pre-existing, NOT fixed in this pass): the steady-state write rule.**
>   Post-drop creates/updates still persist client-sent plaintext content — the
>   dual-write clients keep sending plaintext columns and every route stores them,
>   so an e2eeActive household's *new/edited* records regain plaintext on the server
>   (verified in `calendar.js` create/update and the drop test's post-drop create).
>   Needs its own pass: strip content columns server-side on writes to e2eeActive
>   households (or stop sending them client-side). Until then the drop's guarantee
>   only fully holds for records untouched since the drop.
> - **Ops follow-up (needs a small pass + a script): re-drop for already-active
>   households.** Households dropped BEFORE this pass (incl. prod) keep plaintext
>   `nextDueDate`, odometer readings/notes, meal notes, category names, and the
>   household name — the drop is one-time and won't re-null. Safe sequence: a
>   client re-seal-all pass (decrypt-merge + re-seal puts the new fields into enc)
>   then a script that nulls the new DROP_FIELDS columns where enc exists. Do not
>   null before re-sealing — old enc blobs don't contain the new fields.
> - **Needs user action:** unchanged from pass 1 (EAS dev-client rebuild for A3,
>   Anthropic ZDR request, on-device walkthrough) — no NEW native deps this pass;
>   add the D4/D5/C2 surfaces (task complete, odometer log, templates, grocery
>   list, household rename) to the walkthrough list.

> **2026-07-17 — execution pass 3 (build/test-verified: server 205 incl. 4 new
> integration tests, `shared/crypto` 25, `shared/calendar` 28, `shared/weather` 8,
> mobile jest 118, tsc 0, expo export ✓): the two pass-2 inserts, as ONE pass —
> the steady-state WRITE RULE and the re-seal + re-drop BACKFILL are BUILT.**
> - **Steady-state write rule (closes the pass-2 flag).** New
>   `services/e2eePolicy.stripSealedContent`/`stripSealedDoc` (+ `sealedContentFields`):
>   once `Household.e2eeActive`, a create/update that carries ciphertext (`enc`)
>   no longer persists the plaintext DROP_FIELDS columns. Wired into EVERY content
>   route's create AND update: tasks (incl. `/complete`), chores, calendar events,
>   items, people (self + roster), recipes, categories, odometer, recipe-schedule,
>   trips (+ items), household rename (`PUT /household`), settings (`homeAddress`
>   + derived `lat/lon`). Two deliberate no-ops keep the drop's own lanes working:
>   (a) before the drop (dual-write window still needs plaintext), (b) writes with
>   NO enc (the §9.3 shared-trip / §9.5 outside-shared-calendar plaintext lanes —
>   they write ciphertext-free so collaborators can read them).
> - **Discovery — required content fields.** `MaintenanceTask/Chore.title`,
>   `CalendarEvent.title/startDate`, `Person.name`, `Recipe.title`, `Item.name`,
>   `Trip.name`, `TripItem.title` are `required`, so stripping them tripped
>   full-document validation on `.create()`/`.save()`. Fixed at the schema with a
>   shared `encFields.requiredUntilSealed` predicate (`required: !this.enc?.ct`):
>   a sealed record legitimately has no plaintext content, so it's a VALID
>   document — this also retires the latent "post-drop `.save()` throws validation"
>   bug the pass-2 note called out. People PUT switched to `findOneAndUpdate`.
> - **Re-seal + re-drop backfill.** Households dropped BEFORE pass 2 (incl. prod)
>   keep `nextDueDate`, odometer reading/notes, meal notes, category names, and the
>   household name in plaintext, and their old `enc` predates those fields. New
>   `Household.dropFieldsVersion` (+ `DROP_FIELDS_VERSION = 2`) records the field
>   set a household's plaintext was last nulled at (a committed drop now stamps it).
>   Client `dropMigration.reencryptForReDrop` (`GET /household/e2ee/reseal-all`
>   → decrypt-merge-reseal → `POST /e2ee/seal`, then `POST /e2ee/reseal-complete`
>   on ZERO failures) folds the new fields into `enc`; it runs automatically from
>   `maintainKeyHygiene` gated on the household's new `resealNeeded` flag. Server
>   `scripts/reDropPlaintext.js` then nulls the newer columns where `enc` exists —
>   and REFUSES to commit until `dropFieldsVersion` is current (the machine
>   interlock: never null before re-sealing). `plaintext_redropped` audit event.
> - **Flagged, NOT changed (out of this pass's scope):** `POST /recipes/from-ai`
>   persists a plaintext Recipe with no `enc` (a write-guard bypass), but it is
>   unreachable from the mobile client (which uses `/recipes/generate` → seal
>   client-side → `POST /recipes`). Close it in a later pass (return the draft for
>   the client to seal, like `/from-url` / `/from-photo`).
> - **Needs user action (ops):** run the prod re-drop — see the ops steps at the
>   end of this file. Otherwise unchanged (EAS dev-client rebuild for A3, Anthropic
>   ZDR, on-device walkthrough).

> **2026-07-17 — execution pass 4 (build/test-verified: `shared/crypto` 29 incl. 4
> new D1 tests, `shared/calendar` 28, `shared/weather` 8, server 212 incl. a new
> 7-test `calendarKeys` integration suite, mobile jest 118, tsc 0, expo export ✓):
> D1 (per-resource CalendarKeys for outside-shared calendars) is BUILT** — the
> §9.5 outside-shared-calendar plaintext feed is closed. See the D1 decision doc
> under the checkbox for the envelope/crypto design (forward-compatible with
> C4→C3). Highlights:
> - **Crypto (`shared/crypto`).** `RecordEnvelope` gains `ks?: 'cal'` (self-
>   describing key-scope discriminator) and `RecordLocation` gains
>   `scope?: { kind:'calendar', resource, version }`; `buildAad` binds a cal-scoped
>   ciphertext to `cal:${resource} ${version}` (the globally-unique calendar key +
>   CalendarKey version) instead of householdId + HDK version, so a cross-household
>   collaborator reconstructs the AAD without the owner's householdId. New
>   `generateResourceKey` / `wrapResourceKeyForHousehold`+`…FromHousehold`
>   (AEAD-under-HDK) / `wrapResourceKeyForMember`+`unwrapResourceKeyForMember`
>   (sealed box). Existing HDK records are byte-for-byte unchanged (no version bump).
> - **Server.** New generalized `ResourceKeyEnvelope` collection (household-recipient
>   row wrapped under the HDK + one member-recipient row per accepted collaborator).
>   `CustomCalendar` gains `calKeyVersion` + `calKeyRotationPending`. New calendar
>   routes: `GET/POST /calendars/:key/keys` (fetch usable envelopes / owner mints or
>   rotates with compare-and-set on version), `POST /calendars/:key/keys/members`
>   (owner wraps to a newly-accepted collaborator — the async approve-on-device
>   step; seats only actual collaborators), `GET /calendars/keys/pending` (the
>   owner's wrap/rotate work list). The `outsideShareBlocked` 409 `decrypt_required`
>   lane is RETIRED (sharing outside is allowed again on e2ee households). Removing
>   an outside party flags `calKeyRotationPending`. `enc.ks` is preserved through
>   `pickRecordEnc` + the `encFields` schema.
> - **Steady-state write rule.** `sealedContentFields` strips plaintext
>   UNCONDITIONALLY for `enc.ks === 'cal'` (a CalendarKey-sealed record is private
>   by construction, independent of the writer's household `e2eeActive`) — closing
>   the ongoing-plaintext-feed leak. `requiredUntilSealed` already keys off
>   `enc.ct`, so a sealed cal event is a valid document.
> - **HDK-lifecycle guards.** `/e2ee/old-versions` + `/key/retire` now exclude
>   `enc.ks === 'cal'` (a CalendarKey version is not an HDK version), and the drop /
>   re-drop NULL steps no longer exempt outside-shared calendar events — a
>   CalendarKey-sealed event carries `enc`, so `enc exists` nulls its plaintext
>   correctly while an un-migrated plaintext-lane event (no `enc`) is skipped. The
>   straggler check still shields plaintext-lane events so they never block a drop.
>   `calendarData`'s range queries return dateless cal-sealed events regardless of
>   window (the client date-filters after decrypting).
> - **Client (mobile).** `lib/e2ee.ts` caches CalendarKeys (resource→version→key),
>   unwraps household/member envelopes, and exposes `sealForCalendar` /
>   `decryptCalendarRecord` (+ `openRecord` auto-routes `enc.ks==='cal'` events to
>   the CalendarKey, lazily loading the key on first read). New `lib/calendarKeys.ts`
>   `reconcileCalendarKeys` (owner device): mint v1 + re-seal existing events at
>   first-share, wrap to accepted collaborators, and rotate + re-seal on revoke —
>   wired into `maintainKeyHygiene` (runs post-unlock). `EventFormScreen` seals an
>   event under the CalendarKey when its calendar is outside-shared and a key is
>   held, else HDK dual-write.
> - **Deviation from "retire the exemptions" (documented):** `excludeOutsideCalendar
>   Filter`/`outsideSharedCalendarKeys` are KEPT in the HDK straggler + reseal-all +
>   old-versions passes (they must never HDK-seal a shared-calendar event, plaintext-
>   lane or CalendarKey-sealed); full retirement waits until a household has zero
>   plaintext-lane shared-cal events. They were removed only from the drop/re-drop
>   NULL steps (where `enc exists` is the correct gate).
> - **Deferred UX (non-blocking):** an explicit "waiting for the owner to grant
>   access" banner on a collaborator's not-yet-wrapped shared calendar. The flow is
>   functionally complete — a collaborator's next event read lazily loads the key
>   once the owner's device has wrapped it (on the owner's next unlock); until then
>   the sealed events are simply absent rather than broken.
> - **Needs user action (ops):** unchanged (prod re-drop, EAS dev-client rebuild for
>   A3, Anthropic ZDR, on-device walkthrough). No NEW native deps this pass. Add to
>   the walkthrough: share a calendar with an outside email → accept on a second
>   account → confirm events decrypt after the owner's device reconciles → un-share
>   → confirm the removed account loses access after the rotation.

> **2026-07-17 — execution pass 5 (build/test-verified: `shared/crypto` 33 incl. 4
> new D2 tests, `shared/calendar` 28, `shared/weather` 8, server 218 incl. a new
> 7-test `tripKeys` integration suite + rewritten `tripShare`/`tripAttachments`
> suites, mobile jest 118, tsc 0, expo export ✓): D2 (per-resource TripKeys for
> shared trips) is BUILT** — the §9.3 shared-trip decrypt-on-share plaintext lane
> is closed and trip attachments are unblocked. See the D2 decision doc under the
> checkbox (generalizes D1's `ks:'cal'` to `'trip'`; forward-compatible with
> C4→C3). Highlights:
> - **Crypto (`shared/crypto`).** `RecordEnvelope.ks` → `'cal' | 'trip'`,
>   `RecordLocation.scope.kind` → `'calendar' | 'trip'`; `buildAad` maps kind→prefix
>   (cal/trip) so a trip-scoped ciphertext binds `trip:${tripId} ${version}` and a
>   TripKey can't open a CalendarKey record even at a colliding id. The D1
>   resource-key wrap surface is reused verbatim (it was already generic over
>   `resource`). Existing HDK + CalendarKey records are byte-for-byte unchanged.
> - **Server.** `ResourceKeyEnvelope.resourceType` += `'trip'` (resourceKey = the
>   Trip `_id`); `Trip` gains `tripKeyVersion` + `tripKeyRotationPending`. New trip
>   routes mirror D1: `GET/POST /trips/:id/keys`, `POST /trips/:id/keys/members`,
>   `GET /trips/keys/pending` — but TripKey management is **household-scoped** (any
>   member of the owning household, not just the creator). The `isTripShared`
>   enc-strip in the trip/item create+update routes is DELETED (shared records now
>   seal under the TripKey); the mandate is enforced only on unshared trips
>   (graceful degrade). `sealedContentFields` strips plaintext for **any** `enc.ks`;
>   `pickRecordEnc`/`encFields` preserve `ks:'trip'`. The `409 decrypt_required`
>   share flow is RETIRED — sharing keeps the trip sealed and passes a plaintext
>   `{ tripName, destination }` snapshot for the invitation display rows only.
>   Removing a party flags `tripKeyRotationPending`; deleting the trip drops its
>   envelopes.
> - **Trip attachments (the D2 win).** The per-file `Kf` wraps by the readers' key:
>   the HDK for a private/per-family booking (only that family downloads it), the
>   TripKey for a `shared_shared` booking's one shared receipt (`ks:'trip'` on the
>   wrap). The retired 409 (which refused encrypted uploads on shared bookings) is
>   gone; the server stores the opaque `wrappedFileKey` and the client routes
>   decryption by its `ks`. No rewrap/migration pass is needed (encryption on shared
>   bookings was previously refused, so there's nothing to migrate).
> - **HDK-lifecycle guards.** `/e2ee/old-versions` + `/key/retire` exclude
>   `enc.ks ∈ {cal,trip}`; the drop / re-drop NULL steps no longer exempt shared
>   trips (a TripKey-sealed record carries `enc`, so `enc exists` nulls its
>   plaintext, while an un-migrated plaintext-lane trip has no `enc` and is skipped).
> - **Client (mobile).** `lib/e2ee.ts` generalizes the D1 CalendarKey cache into a
>   resource-key cache (`sealForResource`/`decryptResourceRecord`/`loadResourceKeys`
>   /`mintResourceKey`/`wrapResourceKeyForCollaborator`, keyed by the globally-
>   unique resource id — the D1 calendar-named exports are thin wrappers, untouched
>   callers). `openRecord` routes `enc.ks==='trip'` events to the TripKey (resource
>   = the record's `tripId`, or its `_id` for the Trip itself). New
>   `encryptAttachmentForResource` + a `ks`-routing `decryptAttachment`. New
>   `lib/tripKeys.ts` `reconcileTripKeys` (mint v1 + re-seal at first-share, wrap to
>   accepted collaborators, rotate + re-seal on revoke) wired into
>   `maintainKeyHygiene`. `TripFormScreen`/`TripItemFormScreen`/`TripDetailScreen`
>   seal under the TripKey when the trip is shared + a key is held (else HDK dual-
>   write); the share flow passes the snapshot instead of the retired decrypt-on-share.
> - **Deviation from "retire the exemptions" (mirrors D1, documented):**
>   `excludeSharedFilter` is KEPT in the HDK straggler + reseal-all + old-versions
>   passes (never HDK-seal a shared-trip record); full retirement waits until a
>   household has zero plaintext-lane shared trips. Removed only from the drop /
>   re-drop NULL steps (where `enc exists` is the correct gate).
> - **Deferred UX (non-blocking):** the same "waiting for the owner to grant access"
>   collaborator banner D1 deferred (a collaborator's next read lazily loads the key
>   once the owner's device wraps it; until then the sealed records are absent, not
>   broken).
> - **Needs user action (ops):** unchanged (prod re-drop, EAS dev-client rebuild for
>   A3, Anthropic ZDR, on-device walkthrough). **No NEW native deps this pass** —
>   trip attachments already use `expo-file-system`, added by an earlier phase. Add
>   to the walkthrough: share a trip with an outside email → accept on a second
>   account → confirm the itinerary decrypts after the owner's device reconciles →
>   add a `shared_shared` booking with an encrypted receipt → confirm the guest
>   opens it → un-share → confirm the removed account loses access after the rotation.

> **2026-07-17 — execution pass 6 (build/test-verified: `shared/crypto` 35 incl. 2
> new D3 tests, `shared/calendar` 28, `shared/weather` 8, server 223 incl. 5 new
> `invitations` D3 tests, mobile jest 118, tsc 0, expo export ✓): D3 (event
> invitations sealed to known accounts) is BUILT** — §9.4's plaintext snapshot
> shrinks to non-account email/SMS recipients only. See the D3 decision doc under
> the checkbox (a raw sealed box on the invitation row, OUTSIDE the RecordEnvelope
> surface — orthogonal to D1/D2's `ks` and to C4→C3). Highlights:
> - **Crypto (`shared/crypto`).** New `sealJsonToMember`/`openJsonFromMember` —
>   an anonymous sealed box over a C1-padded JSON payload (the same
>   `crypto_box_seal` primitive as D1/D2's member-wrap, but one-shot: no versioned
>   key, no rotation, no envelope). Existing records byte-for-byte unchanged.
> - **Server.** `EventInvitation` gains `sealedEvent` (opaque b64); `event.title`/
>   `.startDate` drop `required`, and a `pre('validate')` requires one lane or the
>   other. The server does NO crypto (mirrors D1/D2). New `GET /invitations/lookup`
>   resolves an invited email → `{ userExists, identityPublicKey }` (withheld for
>   the caller's own household). `POST /` takes `sealedEvent` (known-account lane —
>   no plaintext stored, notice-only email, no `.ics`) or `event` (plaintext lane,
>   unchanged for non-account/SMS). `POST /:id/seal` is the lazily-claimed upgrade
>   (recipient re-seals to itself; server drops the plaintext). `POST /:id/accept`
>   takes the recipient's decrypted snapshot for a sealed invite. Both `.ics`
>   routes 404 for sealed invites. Revoke (`DELETE /:id`) hard-deletes either lane.
> - **Mailer.** `sendEventInvitation` renders a notice-only email (no title/when,
>   no `.ics`) when `event` is absent — the sealed lane.
> - **Client (mobile).** `lib/e2ee` adds `sealInvitationSnapshot`/
>   `openInvitationSnapshot`/`myIdentityPublicKey`. `lib/invitees.sendInvitations`
>   looks up each email invitee; a resolved key → seal on-device + send
>   `sealedEvent`, else the plaintext lane. `InvitationsScreen` decrypts sealed
>   snapshots for display (locked-vault placeholder if it can't), passes the
>   decrypted snapshot on accept, and runs the lazy upgrade (re-seal any plaintext
>   invite in my inbox to my own key). The organizer's `EventInviteesScreen` is
>   untouched — it already renders from the route-param snapshot, never `inv.event`.
> - **Needs user action (ops):** unchanged. **No NEW native deps this pass.**
>   Add to the walkthrough: invite a second (key-enrolled) account by email →
>   confirm the invite email is the notice-only variant and the DB row has
>   `sealedEvent` + no plaintext `event` → confirm the recipient's inbox decrypts
>   and accept adds the copy → invite a not-yet-registered address, register it,
>   open the inbox, and confirm the plaintext row upgrades to `sealedEvent`.

> **2026-07-19 — execution pass 7 (build/test-verified: `shared/crypto` 35,
> `shared/calendar` 28, `shared/weather` 8, server 228 incl. a new 5-test
> `authorHiding` integration suite, mobile jest 118, tsc 0, expo export ✓): C4
> (hide record authorship) is BUILT** — the server no longer sees which family
> member wrote a private record. See the C4 decision doc under the checkbox. **No
> crypto/envelope change** (the author moves inside the already-sealed record JSON;
> the AAD already binds `householdId`), so the `alg`/version still bumps exactly
> once at C3. Highlights:
> - **Attribution → `householdId`.** The shared `encFields` fragment gains a
>   plaintext `householdId` (indexed); the steady-state write rule
>   (`e2eePolicy.stampHousehold`, folded into `stripSealedContent`/`Doc`) stamps it
>   AUTHORITATIVELY on every content write (so a client can't spoof it via a
>   `...req.body` create). New `services/scope.scopeClause(scopeIds, householdId)`
>   = `{ $or: [{ householdId }, { userId: { $in: scopeIds } }] }` — a strict
>   superset-safe equivalent of the old member filter that ALSO finds sealed
>   (author-nulled) records, needing no data backfill. Attached as
>   `req.scopeFilter` in `requireAuth`; the AI tool executors take a
>   `householdId` and call `scopeClause` directly.
> - **Author sealed, plaintext nulled.** `e2eePolicy.stripsAuthor` nulls the
>   plaintext `userId` on an HDK-sealed record of the author-hidden collections
>   (`CalendarEvent, Person, MaintenanceTask, Chore, Recipe, Item, OdometerLog,
>   RecipeSchedule, Category`) once the household is `e2eeActive`; the client seals
>   the author inside `enc` (`e2ee.setSealAuthor` + `withAuthor` in
>   `sealNew`/`sealUpdate`). Content models' `userId` → `requiredUntilSealed` (a
>   sealed record legitimately has no plaintext author). `DROP_FIELDS_VERSION` → 3:
>   the drop + re-drop null `userId` (after stamping `householdId`, never before),
>   and `/e2ee/reseal-all` lists author-still-plaintext HDK records so the backfill
>   folds the author into `enc` first.
> - **Route/service sweep.** `userId: { $in: req.scopeIds }` → `req.scopeFilter`
>   (or `scopeClause`) on every read/write of an author-hidden collection: the CRUD
>   routes (tasks/chores/items/people/recipes/categories/odometer/recipeSchedule/
>   manuals/receipts/eventAttachments), `calendar.js` (+ `eventAuthz` `inScope` now
>   household-based) and `calendarData.js` (the `/` + `/raw` feeds), the B1/B3
>   machinery (`/e2ee/seal`, `/e2ee/old-versions`, `/key/retire` — else author-
>   nulled old-version records would be missed and their HDK wrongly retired), the
>   AI tool executors (calendar/maintenance/chores/maintenance-plan/form-assist),
>   `calls.js`/`invitations.js`/`phoneCalls.js` event lookups. Non-author-hidden
>   collections (CustomCalendar, PhoneCall, Trip/TripItem, Property, Manual,
>   Receipt) keep `userId` scoping — their author isn't hidden.
> - **Deviation (mirrors D1/D2's "keep the exemptions").** Trip/TripItem and any
>   resource-scoped (`enc.ks` cal/trip) record KEEP their plaintext `userId` — a
>   cross-household routing artifact for the shared lane, not private authorship;
>   `stripsAuthor` excludes them. Full author-hiding on shared records waits until
>   the shared-lane read paths key off `householdId`/key-possession alone.
> - **Question answers:** (a) CONFIRMED no per-user conflict logic — sync is a
>   `?since=<updatedAt>` LWW cursor, nothing reads authorship for merge; (b) authz
>   moved household-level (no client-side move needed) — `eventAuthz`'s `inScope`
>   is now `householdId`, custom-calendar access already keyed off the calendar's
>   share list, the invited-copy guard off `invitationId`; (c) done via
>   `scopeClause`. Mobile shows no record authorship UI, so hiding it has no UI
>   cost (`alertAudience: 'owner'` renders as "you only"; the server scheduler is
>   dormant when `e2eeActive`).
> - **Needs user action (ops):** the prod re-drop now also nulls the author — it's
>   a `DROP_FIELDS_VERSION` bump (2→3), so an already-active household re-runs the
>   re-seal-all pass (author → `enc`) then the re-drop script (see the ops runbook;
>   dropFieldsVersion interlock unchanged). **No NEW native deps this pass.** Add to
>   the walkthrough: on an e2eeActive household confirm a new task/person DB row has
>   `householdId` + no plaintext `userId`, and that both members still read it.

> **2026-07-19 — execution pass 8 (build/test-verified: `shared/crypto` 38 incl. 3
> new C3 tests, `shared/calendar` 28, `shared/weather` 8, server 236 incl. a new
> 8-test `records` integration suite, mobile jest 122 incl. a new 4-test `records`
> suite, tsc 0, expo export ✓): the
> C3 opaque-envelope FREEZE + the additive unified `Record` store are BUILT; the
> destructive store cutover is split out as C3b (tracked).** C3 was deliberately
> the one-and-only `RecordEnvelope` `alg`/version bump (D1/D2/C4 were built additive
> so it happens once), so this pass gets the format right and frozen and defers the
> mechanical, crypto-free data-layer rewrite. See the C3 decision doc under the
> checkbox. Highlights:
> - **Envelope freeze (`shared/crypto`).** New record `alg`
>   `xchacha20poly1305-ietf-v2`: `encryptRecord` seals `{ c: collection, r: record }`
>   (the type moves INSIDE the ciphertext) and `buildAad(loc, opaque)` drops the
>   plaintext `collection`, binding a generic `record` tag instead. Safe because
>   record ids are globally-unique ObjectIds — `id` alone pins the slot, so removing
>   the type weakens no move/replay binding. `decryptRecord` accepts BOTH forms; new
>   `decryptRecordTagged` returns `{ collection, record }` so a collection-less `loc`
>   recovers the type (the unified reader). `ks` + the D1/D2 scoped-AAD survive the
>   bump (pinned). Key/file-key WRAPS keep the v1 primitive
>   (`encryptBytes`/`decryptBytes`) byte-for-byte so every D1/D2 wrap + attachment
>   still decrypts.
> - **Server accepts both algs.** `validateRecordEnvelope` allows v1 + v2. The mobile
>   client adopts v2 transparently (no client change — `crypto.encryptRecord` emits
>   v2, `decryptRecord` dual-accepts), so the existing dual-write flow through the
>   per-collection routes keeps working end-to-end.
> - **Additive unified store (server + client).** Server: `models/Record.js` (one
>   opaque collection: `enc` {alg,nonce,ct,ks} + plaintext routing ONLY —
>   `householdId`/`userId`/`scope`/`keyVersion`/timestamps/`deleted`, no type field)
>   + `routes/records.js` (`GET /records/sync?since=` LWW pull scoped by householdId
>   ∪ userId ∪ the D1/D2 resource lane, tombstones included; opaque-only
>   `POST`/`PUT`/`DELETE`), wired to `e2eePolicy.stampHousehold` + the `scope` lanes;
>   `records.integration.test.js` (8). Client: `crypto.decryptRecordTagged` →
>   `e2ee.openOpaqueRecord` (routes by `enc.ks`, returns `{collection,record}`) →
>   `lib/records.syncRecords` (DI'd: pull → decrypt → bucket into the per-collection
>   replica → tombstones via the new `replica.remove` → advance the cursor) +
>   `recordsApi`; `lib/__tests__/records.test.ts` (4). **Additive only — nothing
>   reads/writes `Record` in the render/route path yet**, so it changes no behaviour
>   and closes no leak on its own; it's the destination + machinery C3b flips onto.
> - **NOT done (C3b, the big-bang — see the decision doc):** migrating the ~9
>   content collections' data + reads + AI tool executors + every mobile screen +
>   the bulk of the 236 server tests onto `Record`, then deleting the per-collection
>   storage that still leaks the type via its Mongo table/route path. Until C3b, the
>   server still learns a row's collection — **the C3 metadata leak is not yet
>   closed.** A B1-style re-seal (`DROP_FIELDS_VERSION` → 4) converts the v1 backlog
>   as the final C3b step; NOT bumped yet (dual-accept means nothing requires v2, so
>   a premature bump would trigger a no-op reseal cycle).
> - **Needs user action (ops):** unchanged (prod re-drop — still v3; EAS dev-client
>   rebuild for A3; Anthropic ZDR; on-device walkthrough). **No NEW native deps this
>   pass.**

> **2026-07-19 — execution pass 9 (build/test-verified: `shared/crypto` 38,
> `shared/calendar` 28, `shared/weather` 8, server suite 235 [7 integration suites
> rewritten onto `/records`], mobile jest 122, tsc 0, `CI=1 npx expo export
> --platform ios` ✓): C3b (the store cutover) is BUILT — the last structural item.
> The ~9 author-hidden content collections' data + every read + every write + the
> AI feeds now flow through the unified opaque `Record` store; the server can no
> longer learn a row's collection. The C3 metadata leak is CLOSED.** Highlights:
> - **The sealed-field contract widened to the FULL field set.** Because `Record`
>   keeps no content/routing column (only `householdId`/`userId`/`keyVersion`/`enc`/
>   `scope`/timestamps/`deleted`), every field a screen needs now rides inside
>   `enc`. `mobile/src/lib/encSubsets.ts` + `services/dropReadiness.DROP_FIELDS`
>   expanded to each collection's full non-routing set (calendarType, recurrence,
>   foreign keys, reminder config, active, priority, dates, …); `DROP_FIELDS_VERSION`
>   → 4 (drives the v1→v2 + fold-in re-seal). Server-scheduler-only state
>   (reminderAt/…SentAt) is not sealed — the scheduler is dormant post-drop.
> - **Client chokepoint (`lib/recordStore.ts`).** The per-collection api groups
>   (tasks/chores/items/people/recipes/categories/recipe-schedule/odometer/calendar
>   events) route their CRUD through `/records` + the replica — the screens already
>   sealed via `sealNew`/`sealUpdate`, so **most of the 73 screens are untouched**.
>   `calendarData.loadCalendarSources` reads the replica (populated by
>   `syncRecords`); grocery config from `/settings`, `selfId` from `currentUserId()`.
>   pause/resume + category reassign re-seal client-side. The one high-leverage fix:
>   `recordStore.get` returns `{ data: T }` (404-rejects on miss), restoring the
>   pre-C3b contract — that alone cleared all 228 mid-flip tsc errors (a null was
>   cascading through `openRecord`'s inference across every detail screen).
> - **Server is content-blind end-to-end.** The per-collection content routes are
>   retired (tasks/chores/categories/items/people/recipes — non-content handlers
>   kept); `/tasks/:id/complete` records the ledger + applies the re-sealed enc to
>   `Record`; **all 5 AI executors** (calendar/maintenance/chores/plan/form-assist)
>   dropped their DB content-read fallback in favour of the client's decrypted
>   context, verify access via `Record.exists`, and return client-seal payloads for
>   creates (the server can't mint readable content); `calls.js`/`eventAttachments`/
>   `invitations` event lookups → `Record`; `invitations` accept stores the
>   recipient's client-sealed copy as a `Record` (guestListVisible moved onto the
>   invitation — it's a sealed event field now); `phoneCalls` confirmed-cancel marks
>   the event client-side; `history.js` drops the populate. `/recipes/from-ai`
>   returns a draft (closes the pass-3 write-guard bypass).
> - **B1/B3 + backfill onto `Record`.** `/e2ee/seal` routes to `Record` (the 9) vs
>   in-place (Trip/TripItem); `/e2ee/old-versions` scans `Record` (opaque pseudo-
>   collection, client re-seals via `decryptRecordTagged`) + Trip/TripItem;
>   `/key/retire` counts `Record`. **Two real bugs found + fixed by the tests:**
>   (a) `records.js` POST wasn't applying C4 author-hiding (now nulls plaintext
>   `userId` on an e2eeActive HDK record — keeps it for solo / resource-scoped /
>   pre-active); (b) the straggler/reseal-all queries spread `req.scopeFilter` (an
>   `$or`) alongside another `$or`, clobbering the scoping → a cross-household leak;
>   now `$and`-combined.
> - **Server no longer seeds plaintext content.** Register + `PUT /settings` stopped
>   creating a plaintext self-Person / default categories (those tables are gone) —
>   the client seeds them encrypted, so a born-encrypted household has zero content
>   stragglers.
> - **Migration + drop scripts.** `scripts/migrateToRecords.js` (copy the 9
>   collections → `Record`, `enc.ks`→`scope`, idempotent) and
>   `scripts/dropContentCollections.js` (the final drop, gated on the v4 re-seal +
>   migration interlocks). Ops order: cutover → migrate → app re-seal (v4) → drop.
> - **NOT changed (documented deviations honored):** Trip/TripItem + resource-scoped
>   (`enc.ks` cal/trip) records keep plaintext `userId`; `excludeSharedFilter`/
>   `excludeOutsideCalendarFilter` kept in the HDK straggler/reseal/old-versions
>   passes. **Deferred non-blocking:** an orphaned-`EventAttachment` reaper on event
>   tombstone (the cascade was server-side; event delete is now a `/records`
>   tombstone). The vestigial `/calendar` aggregate + `/calendar/events` routes are
>   left mounted (unused by the client, empty post-drop) rather than deleted.
> - **Needs user action (ops):** the prod re-drop is now a `DROP_FIELDS_VERSION`
>   4 catch-up — app session (re-seal-all folds the newly-sealed routing columns
>   into enc) → `migrateToRecords.js --commit` → dry-run → `reDropPlaintext.js
>   --commit`, THEN `dropContentCollections.js --commit` per the runbook. **No NEW
>   native deps this pass.** EAS dev-client rebuild (A3) / Anthropic ZDR /
>   on-device walkthrough unchanged.

> **2026-07-20 — execution pass 10 (build/test-verified: `shared/crypto` 38,
> `shared/calendar` 28, `shared/weather` 8, server suite 232 [−4 obsolete route
> tests, +1 reaper test], mobile jest 122, tsc 0, `CI=1 npx expo export
> --platform ios` ✓): the C3b cleanup loose ends are CLOSED and E5 is shipped.**
> Highlights:
> - **Deleted the vestigial `/calendar` surface.** `routes/calendar.js` (the
>   `/calendar` aggregate + `/calendar/raw` + `/calendar/events` GET/POST/PUT/
>   DELETE CRUD + `eventAuthz`) and `services/calendarData.js`
>   (`collectCalendarRecords`/`fetchCalendarSources`) are gone; unmounted from
>   `app.js`. `eventAttachmentRoutes` still mounts at `/api/calendar` for the
>   attachment paths. Event CRUD already flowed through the opaque `/records`
>   store (pass 9), so no client render/route path regressed; `calendarApi.get`/
>   `getRaw` + the `CalendarRaw` type were removed from the mobile api.
> - **The D1 reconcile moved onto the `/records` resource lane.** `lib/calendarKeys.
>   ts:reconcileCalendarKeys` fed off `/calendar/raw` (which post-drop reads the
>   emptied `CalendarEvent` collection → returned nothing → the revoke/rotation
>   re-seal was silently broken). It now preloads each pending calendar's key,
>   forces a full `resetRecordCursor()` + `syncRecords()`, and reads the decrypted
>   events from the replica (so a rotation re-seals events currently under the OLD
>   CalendarKey version). **Fixed a latent bug in the re-seal:** `sealForCalendar`
>   returns no `calendarType`, so the `updateEvent` payload didn't carry the D1
>   `scope` — a re-sealed cal event would have landed in the wrong (HDK) lane and
>   become unreadable; the update now passes `calendarType` so `withCalScope`
>   stamps the resource scope.
> - **Orphaned-EventAttachment reaper.** New `services/eventAttachmentReaper.js`;
>   `DELETE /records/:id` now reaps any `EventAttachment` rows + on-disk files
>   keyed to the deleted record (a no-op for non-event records — the server stays
>   content-blind, it just cleans up files dangling off the tombstoned id). This
>   replaces the cascade the deleted per-event DELETE route used to run.
> - **Server-side per-event access enforcement retired (documented).** The old
>   `eventAuthz` enforced view-vs-full and feed/holiday read-only on writes. The
>   content-blind `/records` store can't see an event's `calendarType`, so
>   `recordScope` enforces only resource-lane membership (you hold a member key
>   envelope for the resource); view-vs-full is now CalendarKey-possession + the
>   client. The `customCalendars.integration` event-authz tests were trimmed to
>   their still-valid calendar-level surface (`/api/calendars` sharing tiers +
>   `access`/`mine` flags + invitation lifecycle); the obsolete
>   `calendarMultiDay` server test was deleted (the multi-day-window regression is
>   covered client-side in `shared/calendar`); `tripShare`'s calendar-aggregate
>   assertions moved to `/api/trips`.
> - **E5 (build verifiability) — done, documented in `docs/TRANSPARENCY.md`.**
>   Outcome: reproducible byte-for-byte builds are out of reach on EAS-managed +
>   Apple-re-signed + FairPlay-encrypted iOS, but the **source→build chain IS
>   attestable** (pinned lockfiles w/ integrity hashes incl. the crypto surface,
>   EAS builds tied to a git commit + retained logs, published `CRYPTO-SPEC.md` +
>   the test bar). The named gap: no *public* CI recipe yet (`.github/workflows`
>   is empty) — a pipeline that builds from a tag and publishes the EAS build
>   receipt is the concrete next step; Android is a stronger future target.
> - **Chose E5 over G4.** G4 (query-scoped AI context) is explicitly gated behind
>   an on-device assistant-quality comparison that can't be run here; E5 is
>   self-contained, doc-only, adds no native deps, and can't regress the bar.
> - **NOT done (still deferred, non-blocking):** the D1/D2 "waiting for the owner
>   to grant access" collaborator banner on a not-yet-wrapped shared resource.
>   **No new native deps this pass** (EAS dev-client rebuild status unchanged).
>   The prod v4 C3b catch-up / ZDR request / on-device walkthrough remain user
>   ops actions.

> **2026-07-20 — execution pass 11 (build/test-verified: `shared/crypto` 41,
> `shared/calendar` 28, `shared/weather` 8, server suite 237, mobile jest 122,
> tsc 0, `CI=1 npx expo export --platform ios` ✓): F4 (QR device linking) and F6
> (transport-hardening spike) shipped — only E3 (ops/comms) + G4 (quality-gated)
> remain in-plan.** Highlights:
> - **F4 — QR device linking.** A second device gets the account's E2EE keys by
>   scanning a QR instead of typing the recovery code. The NEW (locked) device
>   mints a one-shot ephemeral X25519 keypair and shows `{linkId, ephemeralPub}`
>   in a QR; an existing UNLOCKED device scans it, confirms a shared fingerprint,
>   and seals the identity keypair to the ephemeral pub; the new device polls,
>   opens it locally, and imports the keypair (then unwraps the HDK itself). The
>   **server is a blind relay** — `DeviceLink` slot + `POST /keys/link/start`
>   (new device opens a slot), `POST /keys/link/complete` (existing device posts
>   the opaque `sealedPayload`), `GET /keys/link/:id` (new device polls, single-use
>   burn on delivery); 5-min TTL, every endpoint scoped to `req.user._id`, a
>   `device_linked` audit + all-devices alert on completion.
> - **Handshake = the D3 sealed box, reused.** `shared/crypto` adds only intent
>   aliases — `generateLinkKeyPair`/`sealLinkPayload`/`openLinkPayload` =
>   `generateIdentityKeyPair`/`sealJsonToMember`/`openJsonFromMember` — so there's
>   NO new crypto (as D3's decision doc predicted). The ephemeral key travels
>   out-of-band in the QR (never via the server) → a malicious server can't MITM;
>   `publicKeyFingerprint` is shown on both screens to confirm. Tests:
>   `shared/crypto/src/deviceLink.test.ts` (3, incl. wrong-key + public-key-only
>   negatives), `server/.../deviceLink.integration.test.js` (5, incl. cross-account
>   isolation + expiry + single-use).
> - **Client.** `lib/deviceLink.ts` (both roles), `importLinkedKeyPair` in e2ee
>   (sets the keypair + **arms the biometric cache** so the linked device needs no
>   password/recovery code on relaunch + unwraps the HDK), `LinkDeviceScreen`
>   (show/scan modes) with `LinkQr`/`QrScanner` components, reached from
>   AccountScreen (locked "Set this one up from another device"; unlocked Devices
>   "Link another device"). **New native deps** (`expo-camera`, `react-native-svg`,
>   `react-native-qrcode-svg`) installed — JS bundles so `expo export` stays green
>   — but gated gracefully (lazy require + "update the app" fallback) until the EAS
>   dev-client rebuild links them (mirrors A3's screen-capture pattern).
> - **F6 — transport hardening (spike, documented in E1).** Leaf/SPKI pinning is
>   NOT operable on Render-managed auto-rotating certs (fresh key each rotation →
>   pinned clients brick); CA pinning is fragile (Render has switched issuers) and
>   weak. Operable posture + recommendation: DNS CAA (lock issuance) + HSTS +
>   Certificate-Transparency monitoring (detection); `Expect-CT` is obsolete. The
>   E2EE invariant already caps a TLS-MITM to ciphertext + routing metadata, so
>   pinning is defense-in-depth here, not the primary control. Real pinning would
>   need bring-your-own-cert with a long-lived app-controlled key + backup pin.
> - **Needs user action (ops):** the EAS dev-client rebuild now ALSO links
>   `expo-camera` + `react-native-svg` + `react-native-qrcode-svg` (F4) on top of
>   A3's `expo-screen-capture`; the on-device walkthrough adds the F4 link flow
>   (locked device shows QR → unlocked device scans + confirms fingerprint → keys
>   transfer → new device unlocked, biometric-armed, no recovery code). The prod v4
>   C3b catch-up / Anthropic ZDR remain unchanged.

> **2026-07-20 — execution pass 12 (build/test-verified: `shared/crypto` 41,
> `shared/calendar` 28, `shared/weather` 8, server suite 237, mobile jest 134,
> tsc 0, `CI=1 npx expo export --platform ios` ✓): G4 (query-scoped AI context)
> shipped — every buildable plan item is now done; only E3 (external audit)
> remains.** Highlights:
> - **The leak.** The calendar assistant shipped the ENTIRE decrypted calendar
>   (every event/task/chore/trip the household ever had, aliased but whole) to the
>   AI route on EVERY turn — `loadCalendarSources` reads the full replica and the
>   old window params never filtered the payload (the server expands recurrence
>   over the full set). By far the biggest remaining thing leaving the device.
> - **`lib/aiWindow.ts` (pure, unit-tested).** `deriveAiWindow(texts, now,
>   focusDate?)` turns the turn's conversation into a `[from,to]` window with cheap
>   heuristics — relative terms, month names, explicit `20xx` years, `N weeks/
>   months/years` durations, history intent (`ago`/`last`/`since`), and the
>   focusEvent date — defaulting to −45d…+183d around now, clamped to [−2y,+3y].
>   `scopeCalendarSources(sources, window)` filters to it but **always keeps
>   recurring events/tasks/chores** (their occurrences fall anywhere — dropping by
>   base date would break recurrence and regress quality) and keeps the roster +
>   recipe schedules whole (birthdays span the year; roster is small + consent-
>   gated).
> - **Wired per-turn.** `CalendarAssistantScreen` now keeps the decrypted sources
>   RAW in a ref and `buildBody` recomputes the window each turn → scopes →
>   aliases (G1) → sends. **Widening is conversation-driven**: a follow-up naming a
>   later date/duration expands the next payload, and recurring items are never
>   gated, so recurrence queries work at any range — the plan's "tool round-trip to
>   widen" realized WITHOUT a new round-trip protocol (the server's `list_events`
>   still expands over exactly the scoped set the client sent).
> - **Quality-safe by construction.** Server unchanged — it builds the system
>   prompt from the full roster (birthdays/ages intact) and reads events only via
>   `list_events`/`call_business` over `ctx.calendarSources`; recurrence + the
>   focusEvent (Ask-Calen-from-event) path are preserved. Tunable via the baseline/
>   cap constants if field use wants more or less breadth. Pinned by
>   `aiWindow.test.ts` (12). **No new deps; server + shared suites untouched.**
> - **Plan status:** A/B/C/D/E1-E2-E4-E5/F(1-4,6)/G all built. **E3 (third-party
>   audit) is the sole remaining item and is an ops/comms engagement, not code.**
>   F5 stays tracked in the passwordless plan. User ops actions unchanged (prod v4
>   C3b catch-up; EAS dev-client rebuild incl. F4's camera/QR + A3's screen-capture;
>   Anthropic ZDR; on-device walkthrough).

Remaining execution order: **E3 (third-party audit — ops/comms, the only remaining in-plan item; not code)** (G4 query-scoped AI context shipped in pass 12; F4 QR device linking + F6 transport-hardening spike shipped in pass 11; E5 shipped in pass 10; C3b store cutover + its cleanup loose ends closed in passes 9–10, the last structural item; C3 envelope-freeze + unified store in pass 8; C4 in pass 7; D1 in pass 4, D2 in pass 5, D3 in pass 6; the two pass-2 inserts — the **steady-state write rule** and the **re-seal + re-drop backfill** — landed in pass 3; F5 tracked in the passwordless plan; the `/recipes/from-ai` write-guard bypass was closed in pass 9). **Every buildable item is done; only E3 (an external audit engagement) remains.**

**Verification bar (keep green; all green as of 2026-07-20 pass 12):** `shared/crypto` 41 · `shared/calendar` 28 · `shared/weather` 8 · server suite 237 · mobile jest 134 · `mobile npx tsc --noEmit` 0 · `CI=1 npx expo export --platform ios`.

---

## Phase A — Verification & device-trust UX (cheap, highest felt value)

Signal's *felt* privacy comes mostly from safety numbers and key-change alerts, not the crypto. We verify a public-key fingerprint once at join approval and never again.

- [x] **A1 — Key-change alerts.** Notify every household member (push via `services/notify` + in-app) when: a member enrolls/removes an unlock factor or re-enrolls an identity key, a new device claims envelopes, or the HDK rotates. The events already exist in `AuditLog` (`key_enrolled`, `hdk_rotated`, member approve/remove) — this is a fan-out + UI surface, not new crypto. Add missing audit events where a factor change isn't currently logged.
- [x] **A2 — Continuous safety numbers.** Per-member verification state: a Security screen showing each member's `identityPublicKey` fingerprint (word/number form for out-of-band compare) with a "verified" badge stored locally; the badge **resets automatically when that member's public key changes**, with an alert ("Sam's safety number changed — verify again"). Join-approval fingerprint check becomes the first entry in this system rather than a one-off.
- [x] **A3 — Screen security.** `expo-screen-capture` (`preventScreenCaptureAsync`) on by default with a Privacy toggle, + blank/blur overlay on `AppState` background so the iOS app-switcher snapshot never shows decrypted content. Native dep → dev-client rebuild.
- [x] **A4 — App lock (relock policy).** Setting: require Face ID / passkey unlock after N minutes backgrounded (options: immediately / 1m / 5m / never). Builds on the existing `useE2eeLocked` + automatic Face ID unlock on relaunch — add a lock-on-background timer that drops the in-memory HDK/private key. Ensure the reminder scheduler and replica reads degrade gracefully while locked.

## Phase B — Key hygiene (forward secrecy & post-compromise security)

Signal's Double Ratchet doesn't map onto a shared datastore, but the current "one long-lived HDK, lazy rotation, removal protects future data only" model can get much closer: bounded exposure windows + rotations that actually retire old ciphertext.

- [x] **B1 — Eager re-encryption after rotation.** Post-rotation background client pass that re-seals all records with `keyVersion < current` under the current HDK. Reuse the straggler machinery: a `keyVersion`-filtered variant of `GET /household/e2ee/stragglers` + the content-blind `POST /household/e2ee/seal`. Progress indicator on the Security screen; resumable; attachments included (re-wrap `Kf` per §3.3, don't re-encrypt file bytes). **This upgrades member removal from "protects future data" to "protects everything once the pass completes"** — update the removal UI copy when it lands.
- [x] **B2 — Periodic scheduled rotation.** Server sets `keyRotationPending` on a cadence (e.g. every 90 days, env-tunable) in addition to on-removal; the existing client self-heal (`ensureHouseholdKey` → `rotateHouseholdKey`, `mobile/src/lib/e2ee.ts`) picks it up unchanged. With B1, a compromised key exposes at most one rotation window of ciphertext.
- [x] **B3 — Old-envelope retirement.** After B1 verifies zero old-version records (server count by `keyVersion`), delete historical `HouseholdKeyEnvelope` rows for retired versions and prune the client's version→HDK map. Keeps the compromise surface = current version only. Guard: never retire a version that still has records (including drop-exempt shared plaintext that later re-seals).

## Phase C — Metadata minimization

§10 of the E2EE plan enumerates accepted leaks. Signal's posture is that metadata *is* the product of surveillance — close every leak that doesn't break sync.

- [x] **C1 — Ciphertext padding.** Pad the serialized record JSON to size buckets (e.g. next power of two, min 256 B) inside `encryptRecord` (`shared/crypto/src/core.ts`) before AEAD; self-describing padding so `decryptRecord` strips it. Bump an `alg`/version field in the envelope; decrypt accepts both forms. Also bucket attachment ciphertext sizes (chunked framing already helps). Cheap, ship early.
- [x] **C2 — Encrypt the household name (reverses D3).** Built 2026-07-17: `name` rides in the sealed household-settings blob (P5a `Household.enc`, subset `HOUSEHOLD_ENC = { name, homeAddress }` in `mobile/src/lib/encSubsets.ts`); `DROP_FIELDS.Household` += name; the drop nulls it; the client straggler pass seals the blob via `PUT /settings` (`dropMigration.sealHouseholdBlob` — required, since every household has a name). Rename seals (`PUT /household` accepts enc); `GET /household` serves the blob and the app decrypts for display. Invitation emails + inbox + join-pending copy use sender-name framing when the name is sealed. **Support runbook:** the household name is invisible to admin post-drop — look accounts up by **household ID**, shown at the bottom of the app's Household screen (selectable); admin views fall back to the id where the name is null.
- [x] **C3 — Opaque record envelopes (hide `collection`).** Move the collection type inside `enc`; server stores uniform "records" and serves them via a unified sync endpoint (household + updatedAt cursor). **DONE across two passes:** pass 8 (2026-07-19) froze the envelope (the one-time `alg`/version bump — collection moved out of the AAD into the sealed payload — + the additive `Record` store/`/records` API + client `decryptRecordTagged`/`openOpaqueRecord`/`syncRecords`); **pass 9 (2026-07-19) shipped C3b, the store cutover** — the ~9 author-hidden content collections' data + every read + every write + the AI feeds now flow through the unified opaque `Record` store, the per-collection content routes are retired, and the metadata leak is CLOSED (the server can no longer learn a row's collection from its Mongo table). The sealed-field contract widened to each collection's FULL non-routing field set (`Record` keeps no content column), `DROP_FIELDS_VERSION` → 4 drives the v1→v2 + fold-in re-seal, and `migrateToRecords.js` → app re-seal → `dropContentCollections.js` is the ops migration order. Admin per-type counters die (billing usage counters are AI-action counts — unaffected). C3b inherited C4's `scopeClause`/`householdId` scoping unchanged and closed the `/recipes/from-ai` write-guard bypass along the way. See the C3 decision doc below + the pass-8/pass-9 §0.1 entries.

  ### C3 decision doc — opaque envelope freeze (BUILT, pass 8) + the C3b store cutover (tracked)

  Written and partially built 2026-07-19 (execution pass 8). C3 is the one deliberate `RecordEnvelope` `alg`/version bump the plan sequences — D1/D2/C4 were built additive precisely so it happens exactly once. It splits cleanly into a crypto **freeze** (which is expensive to change later, so it's done and frozen NOW) and a server/client **cutover** (a mechanical, crypto-free data-layer rewrite that can follow):

  **Part 1 — the opaque envelope freeze (BUILT + green: `shared/crypto` 38 incl. 3 new C3 tests; server validator + suite 236 incl. a new 8-test `records` integration suite).**
  1. **New `alg` `xchacha20poly1305-ietf-v2`.** `encryptRecord` now seals `{ c: collection, r: record }` — the collection type moves INSIDE the ciphertext — and `buildAad(loc, opaque=true)` drops the plaintext `collection`, binding a generic `record` tag in its place (`record ${id} ${householdId} ${keyVersion}` for HDK, `record ${id} ${prefix}:${resource} ${version}` for a D1/D2 scope). **Why dropping `collection` from the AAD is safe:** record ids are globally-unique ObjectIds, so `id` alone already pins the ciphertext to its exact slot — removing the type weakens no move/replay binding, it only stops the AAD from revealing the type. **`decryptRecord` accepts BOTH** — v2 reads the type from inside; v1 (the pre-bump form) still binds/echoes the caller's `loc.collection`. New `decryptRecordTagged` returns `{ collection, record }` so the unified reader recovers the type from a collection-less `loc`. `ks` + the D1/D2 scoped-AAD forms are untouched (their resource records survive the bump — pinned).
  2. **Key/file-key WRAPS stay v1.** `encryptBytes`/`decryptBytes` (ResourceKeyEnvelope wraps + per-file `Kf` wraps) keep the v1 alg and AAD — they wrap keys, not stored content rows whose type leaks, and every existing D1/D2 wrap + attachment must decrypt byte-for-byte. Their `collection` AAD slot (`ResourceKey`/`Manual`/`TripItemAttachment`) is a fixed internal tag, not a leaked type.
  3. **Server accepts both algs.** `validateRecordEnvelope` (`services/householdKey.js`) allows `xchacha20poly1305-ietf` and `…-v2`. The mobile client adopts v2 transparently — `crypto.encryptRecord` now emits v2, `decryptRecord` dual-accepts — so the existing dual-write flow through the per-collection routes keeps working end-to-end with no client change (mobile jest 118, tsc 0, expo export ✓).

  **Part 1b — the additive unified store, server + client (BUILT + green, does not yet close the leak).** *Server:* a single `Record` Mongo collection (`models/Record.js`) holds opaque rows: `enc {alg,nonce,ct,ks}` + plaintext routing ONLY (`householdId` [C4 attribution + primary scope], `userId` [solo/shared-lane routing], `scope {kind,resource,version}` [D1/D2 lane], `keyVersion`, `updatedAt`/`createdAt`, `deleted` [tombstone]) — no type field exists. `routes/records.js`: `GET /records/sync?since=` (the LWW pull, scoped by `householdId` ∪ `userId∈scopeIds` ∪ the D1/D2 resource lane [`scope.resource ∈ my member key envelopes]`, tombstones included), `POST /records` (opaque-only — stamps `householdId` authoritatively per C4), `PUT /records/:id`, `DELETE /records/:id` (tombstone). Pinned by `records.integration.test.js` (8). *Client:* the counterpart brick — `crypto.decryptRecordTagged` (recovers the collection from the v2 ciphertext) → `e2ee.openOpaqueRecord(row)` (routes by `enc.ks` to HDK/CalendarKey/TripKey, returns `{ collection, record }`) → `lib/records.syncRecords()` (dependency-injected: pull `/records/sync`, decrypt + bucket each row into its per-collection replica, apply tombstones via the new `replica.remove`, advance the `updatedAt` cursor) + `recordsApi` (sync/create/update/delete). Pinned by `lib/__tests__/records.test.ts` (4). **This is additive** — nothing reads or writes `Record` in the render/route path yet, so it changes no behaviour and closes no leak on its own; it's the destination + machinery the cutover flips onto.

  **Part 2 — C3b, the store cutover (TRACKED, not built — the multi-week big-bang).** To actually hide the collection the ~9 content collections' data + access paths must MOVE onto `Record` and the per-collection storage must be deleted. Scope:
  - **Models/data.** Migrate `CalendarEvent, Person, MaintenanceTask, Chore, Recipe, Item, OdometerLog, RecipeSchedule, Category` (the author-hidden set; extend to the rest of the content models) into `Record`. One-time data migration copies each row's `enc`+routing into a `Record` (mapping `calendarType`/`tripId` → `scope`), then drops the old collections. Non-content models (CustomCalendar, Trip/TripItem [routing], PhoneCall, Property, Manual, Receipt, EventInvitation, key envelopes) stay as-is.
  - **Server reads.** `services/calendarData.js` (`fetchCalendarSources`), the AI tool executors (calendar/maintenance/chores/plan/form-assist), `history.js`, and every per-collection `GET` collapse into `Record.find(scope)` + in-memory assembly over the (still content-blind) rows. The server can no longer filter by type or by any sealed field — it returns the scoped record set and the CLIENT filters by the decrypted collection (the post-drop architecture already does this for dates/status). Preserve C4 `scopeClause`, the D1/D2 resource lanes, and the steady-state write rule (now trivial — `Record` is opaque-only, so there's never plaintext content to strip; the author is already inside `enc`).
  - **Client.** A unified `lib/records.ts` read/write layer over `GET /records/sync` + the replica (the replica is already keyed by collection — populate it by decrypting each opaque row via `decryptRecordTagged` and bucketing by the recovered type). Every screen's list/detail fetch + every mutation (`POST/PUT/DELETE /records`) moves off the per-collection API paths (the paths themselves leak the type via the request line). D1/D2 `sealForResource` + `openRecord` already route by `enc.ks`; they keep working.
  - **AI tools + admin.** AI executors take the unified store; admin per-type counters die (billing usage counters are AI-action counts — unaffected).
  - **Migration order.** New writes are ALREADY opaque (v2) and reads dual-accept, so: (1) cut writes+reads over to `Record` behind the unified API; (2) run the data migration to move the backlog; (3) a B1-style re-seal pass (reuse `/e2ee/reseal-all` → seal → `reseal-complete` + the `DROP_FIELDS_VERSION` interlock, **bump to 4**) converts any lingering v1 records to v2 so no old-format ciphertext (whose AAD still binds `collection`) remains; (4) drop the per-collection Mongo collections. Keep the D1/D2 HDK-lifecycle exclusions (`excludeOutsideCalendarFilter`/`excludeSharedFilter`) and Trip/TripItem + `ks` plaintext-`userId` deviations from D1/D2/C4. Do NOT bump `DROP_FIELDS_VERSION` to 4 until the reseal is wired — dual-accept means nothing REQUIRES v2 yet, so a premature bump would trigger a no-op reseal cycle.
  - **Tests.** The bulk of the 236 server integration tests POST/GET the per-collection routes; they rewrite onto `/records`. Pin C3b: server sees no plaintext type on any content row; the calendar/AI feeds still assemble from the unified store; the data migration is lossless; the reseal converts the backlog.
- [x] **C4 — Hide record authorship (sealed-sender analog). Design pass first.** Built 2026-07-19 (execution pass 7). Records now attributed to a plaintext `householdId` (stamped by the write rule; `req.scopeFilter`/`scopeClause` scope by it); the member-granular author is nulled on HDK-sealed records of the author-hidden collections and sealed inside `enc` as `author`. No envelope/crypto change (the author rides inside the already-sealed record JSON; AAD already binds `householdId`), so `alg`/version bumps once at C3. Trip/TripItem + resource-scoped (`ks`) records keep their plaintext `userId` (a cross-household routing artifact — documented deviation, mirrors D1/D2). See the C4 decision doc below. Original design-pass question set: (a) LWW currently keys on server `updatedAt` only — confirm no per-user conflict logic depends on `userId`; (b) `eventAuthz` / trip ownership / invited-copy read-only guards use plaintext ownership — outside-shared records are the plaintext lane anyway, but private-record edit rules must move client-side or become household-level; (c) `req.scopeIds` query filters swap to `householdId` scoping (already equivalent in effect). Output of the design pass = a decision doc section here; then build.

  ### C4 decision doc — householdId attribution + sealed author (NO envelope change; forward-compatible with C3)

  Written before building (mirrors D1/D2/D3). C4 hides the **member-granular author** from the server: today every content record carries a plaintext `userId` (the writer), so the server sees which family member wrote/edited what and when. Target: the server attributes a record only to its **household**, and the author rides inside the already-encrypted blob. Crucially, **C4 touches no envelope bytes** — the author moves *inside the record JSON that is already AEAD-sealed*, and the AAD is unchanged. So the `alg`/version bumps exactly once, at C3, as sequenced.

  **Resolving the three open questions.**

  (a) **LWW keys on server `updatedAt` only — CONFIRMED, no per-user conflict logic.** Sync is a per-collection `?since=<updatedAt>` cursor; conflict resolution is last-write-wins on the server's `updatedAt`. No route or service compares record `userId` for a merge/conflict decision (there is no LWW/conflict code path that reads authorship). So the author is pure attribution metadata — moving it inside `enc` cannot affect sync correctness.

  (b) **Authz reads plaintext ownership only as a household-membership pointer → it becomes household-level, nothing moves client-side.** Enumerated:
  - The content collections (tasks, chores, items, people, recipes, categories, odometer logs, recipe schedules) authorize by pure household scoping (`userId ∈ req.scopeIds`), never per-author edit rules — swapping to `householdId` scoping is exactly equivalent.
  - `eventAuthz` (calendar.js): its `inScope` test is "the event's author ∈ my household"; it becomes `event.householdId === req.user.householdId`. Custom-calendar access (View/Full) already keys off the **calendar's** collaborator/share list, not the event author — untouched. So the built-in-calendar edit rule becomes household-level; the outside-shared lane is already resource-key-governed (D1). No private-record edit rule needs a client-side move.
  - Trip ownership + invited-copy read-only guard: trip admin is already household-scoped (`ownerFilter`; D2 made TripKey management household-scoped), and the invited-copy read-only guard keys off `event.invitationId` (a routing field), not authorship. Both unaffected.

  (c) **`req.scopeIds` filters swap to a household-scoped filter.** New shared helper `scopeFilter(req)` (attached in `requireAuth` as `req.scopeFilter`):
  - household present → `{ $or: [ { householdId: req.household._id }, { userId: { $in: req.scopeIds } } ] }` — a **strict superset-safe** equivalent of today's result set that ALSO finds sealed records (which carry no plaintext `userId`). Exact `householdId` match + the household's own `scopeIds` means no cross-household leak, and **no data backfill is required to stay correct** (a legacy record with only `userId` is still found by the `userId` branch; a new sealed record with only `householdId` by the `householdId` branch).
  - solo user (no household) → `{ userId: { $in: req.scopeIds } }` unchanged (a household-less user's records carry no `householdId`, so scoping stays per-user; their records gain a `householdId` when they join — stamped by the write rule / re-seal pass).

  **Mechanism.**
  1. **Plaintext `householdId` on content records.** The shared `encFields` fragment gains `householdId` (indexed), so every dual-write content model carries it. Every create stamps it from `req.user.householdId`; updates/re-seals stamp it too. This is the record's server-visible attribution going forward — household- not member-granular (a coarser, deliberate leak that the membership-graph line in §"Out of scope" already accepts).
  2. **Author sealed into `enc`, plaintext `userId` nulled (HDK records only).** Content models' `userId` changes from `required: true` to `requiredUntilSealed` (a sealed record legitimately has no plaintext author — the same predicate the content fields already use). The steady-state write rule strips plaintext `userId` for an **HDK-sealed** record on an `e2eeActive` household; the client seals the author as an `author` field inside the record JSON (`sealNew`/`sealUpdate` inject the current user id). `userId` joins the drop's author-null step (→ `DROP_FIELDS_VERSION` 3) so already-active households (incl. prod) re-seal-then-null it via the existing re-seal + re-drop backfill machinery — never null before the author is sealed and `householdId` is stamped.
  3. **NO envelope/crypto change.** The author rides inside the already-encrypted record JSON; the AAD stays `${collection} ${id} ${householdId} ${keyVersion}`. The AAD *already* binds `householdId`, so a record was always household-bound — C4 only drops the now-redundant member-granular plaintext `userId` column. `shared/crypto` is unchanged; `alg`/version does not bump (it bumps once at C3).

  **Deviation — resource-scoped (`ks`) records keep their plaintext `userId` (mirrors the D1/D2 "keep the exemptions" deviations).** A `cal`/`trip`-sealed record's `userId` is the (possibly cross-household) collaborator who wrote it — a **routing artifact** for the shared lane's read/authz paths, not private authorship (D1/D2 already established the author on these can move inside the sealed blob with no envelope concern, but the plaintext routing is load-bearing for cross-household collaborator access). So C4 nulls plaintext `userId` only on **HDK-sealed** records (the private, same-household case `householdId` scoping cleanly replaces). Shared records are the inherently multi-party lane where participation is already known to the seated collaborators; hiding the member-granular author there waits until the shared-lane read paths key off `householdId`/key-possession alone (a later cleanup, exactly like the "retire the exemptions" D1/D2 deferrals).

  **Forward-compatible with C3.** C3 will move `collection` inside `enc` under a new `alg`/version and collapse the per-collection routes into a unified `household + updatedAt` sync path. C4 adds only a plaintext `householdId` column, nulls a plaintext column, and seals one extra JSON field — no envelope bytes change, and `householdId` is exactly the scoping key C3's unified sync cursor needs. So C3 inherits C4's `scopeFilter`/`householdId` unchanged and bumps the envelope version once.
- [x] **C5 — Log & retention minimization.** Define and implement: no request-body logging anywhere, IP addresses only in the auth rate-limiter's in-memory window (never persisted), `AuditLog` carries no IP/UA, Render log retention set to the ops minimum, structured server logs scrubbed to ids-only. Write the retention policy down (feeds E1/E4).

**Accepted (not work items):** `createdAt`/`updatedAt` precision (LWW sync needs it), record existence/counts, request timing/IP at the transport level (as any server).

## Phase D — Close the plaintext exceptions

Signal has no "plaintext when shared" lane — sharing pulls the recipient into the E2EE system. This is the big structural phase; it removes the §9.3/§9.5 exceptions while keeping email as the invitation channel (discovery only, never key transport — key wrap happens **after** the recipient has an account + enrolled keys, exactly like household join approval).

- [x] **D1 — Per-resource content keys: shared calendars (replaces §9.5 plaintext feed).** Built 2026-07-17 (execution pass 4). New `CalendarKey` (random 256-bit, versioned) per outside-shared calendar: events on it sealed under the CalendarKey instead of the HDK (envelope gains a key-scope discriminator). Wrapped to (a) the owning household via HDK and (b) each **accepted** collaborator's `identityPublicKey` (sealed box — the `HouseholdKeyEnvelope` pattern generalized to a `ResourceKeyEnvelope` collection). Email invitation flow unchanged; on accept, the owner's next unlocked session wraps the key (async approve-on-device UX — "waiting for the owner to grant access"). Un-share/revoke = rotate the CalendarKey + re-seal (B1 machinery). Collaborator removal = same. View-only vs full-access: server keeps enforcing writes via the plaintext scope fields; reads are governed by key possession. Retire `excludeOutsideCalendarFilter` drop exemptions once migrated.

  ### D1 decision doc — envelope + resource-key crypto surface (forward-compatible with C3/C4)

  Written before building so the envelope changes here don't collide with the C4→C3 opaque-envelope/authorship refactor. The three additions are **orthogonal and additive** (no envelope version bump; existing HDK-sealed records are byte-for-byte unchanged), so C3/C4 can bump the version exactly once later without reconciling D1:

  1. **Envelope key-scope discriminator (`enc.ks`).** `RecordEnvelope` gains an optional `ks?: 'cal'`. Absent (the default for every existing record) = sealed under the household HDK; `'cal'` = sealed under the resource's CalendarKey. Self-describing, in the C1 spirit — a reader picks the key without consulting membership tables. `ks` is NOT bound in AAD (it's a client hint; a flipped value simply decrypts under the wrong key → auth failure). C3 will move `collection` *into* `enc` and change the AAD recipe under a new `alg`; `ks` lives alongside and is untouched.
  2. **Scoped AAD.** `RecordLocation` gains an optional `scope?: { kind: 'calendar'; resource: string; version: number }`. `buildAad` stays `${collection} ${id} ${householdId} ${keyVersion}` when unscoped, and becomes `${collection} ${id} cal:${resource} ${version}` for a calendar scope — binding the ciphertext to the calendar (`resource` = the globally-unique `custom-<slug>` key) and the CalendarKey version instead of household + HDK version. A collaborator in another household never learns/needs the owner's `householdId`, so it isn't bound.
  3. **Resource-key wrap/unwrap.** New crypto: `generateResourceKey()` (256-bit, = an HDK by shape), `wrapResourceKeyForHousehold(hdk, key, loc)` / `unwrapResourceKeyFromHousehold` (AEAD-under-HDK, reusing `encryptBytes`/`decryptBytes` with a `ResourceKey` location that binds resourceKey + CalendarKey version + householdId + hdkVersion), and `wrapResourceKeyForMember(key, pub)` / `unwrapResourceKeyForMember(wrapped, keyPair)` (anonymous sealed box, = the HDK member-wrap). The server stores these as opaque strings in a generalized `ResourceKeyEnvelope` collection (household-recipient row + one member-recipient row per accepted collaborator) — it can no more read a CalendarKey than an HDK.

  **Write rule.** `enc.ks === 'cal'` strips plaintext content *unconditionally* (a CalendarKey-sealed record is private by construction — readable only via the CalendarKey — regardless of the writer's household `e2eeActive`, since collaborator writers may be in a not-yet-active household). Old clients that can't provision a CalendarKey keep sending plaintext without `enc`, so outside-share still works for them (graceful degrade, same as the min-app-version gate elsewhere). This retires the `outsideShareBlocked` 409 lane.

  **C4 note.** C4 (hide record authorship) will move `userId` inside `enc`. Shared-calendar events are already the multi-writer case where server-side `userId` is only a routing/scoping artifact (authz is by calendar key + membership, not authorship), so D1's events are forward-compatible: their author can move inside the CalendarKey-sealed blob with no new envelope concern.
- [x] **D2 — Per-resource content keys: shared trips (replaces §9.3 decrypt-on-share).** Built 2026-07-17 (execution pass 5). Same `ResourceKeyEnvelope` mechanism for `Trip` + its `TripItem`s + trip attachments (per-file `Kf` wraps under the TripKey). Removes the `isTripShared` plaintext write-guard and the shared-trip drop exemptions; unblocks the long-open **trip attachments** item (E2EE plan §9.2 blocked list) since attachments no longer need a plaintext lane. `409 decrypt_required` flow retires.

  ### D2 decision doc — TripKey envelope + resource-key surface (generalizes D1's `ks:'cal'`)

  Written before building so the D2 additions stay orthogonal/additive with D1 and forward-compatible with the C4→C3 opaque-envelope/authorship refactor (no envelope version bump; existing HDK- and CalendarKey-sealed records are byte-for-byte unchanged):

  1. **`ks` discriminator — add `'trip'` (parallel to `'cal'`, not a rename).** `RecordEnvelope.ks` becomes `'cal' | 'trip'`. Absent = HDK (every existing record). `'cal'` = CalendarKey (D1). `'trip'` = TripKey. A distinct value (not a generic `'res'`) keeps D1 records byte-identical and lets a reader route to the right key store without a membership lookup — the C1 self-describing spirit. Everything that special-cased `enc.ks === 'cal'` now treats **any** truthy `ks` as "resource-scoped, not HDK-sealed" (`sealedContentFields` strips unconditionally for any `ks`; the HDK old-version/retire accounting excludes `ks ∈ {cal,trip}`).
  2. **`scope.kind` — add `'trip'`; AAD gains a per-kind prefix.** `RecordLocation.scope.kind` becomes `'calendar' | 'trip'`. `buildAad` maps kind→prefix (`calendar→cal`, `trip→trip`), so a trip-scoped ciphertext binds to `${collection} ${id} trip:${resource} ${version}`. Binding the kind (not just the resource id) means a TripKey can never open a CalendarKey record even if resource ids ever collided (they don't today — calendar resources are `custom-<slug>`, trip resources are the Trip `_id` hex). **Resource = `String(trip._id)`** — already a plaintext routing field (`Trip._id`, and `TripItem.tripId` foreign key), so no new identifier leaks, and one TripKey seals the Trip + every one of its TripItems under the same `trip:${tripId}` binding.
  3. **Resource-key crypto is reused as-is.** `generateResourceKey` / `wrapResourceKeyForHousehold`+`…FromHousehold` / `wrapResourceKeyForMember`+`unwrapResourceKeyForMember` were already generic in D1 (they take a `resource` string, not "calendar"). D2 adds no new crypto primitive — only `buildAad`/`encryptBytes` generalize over `scope.kind`.

  **Trip attachments (the win D1 didn't have) fall out cleanly along the booking's sharing tier — no rewrap/migration pass.** The per-file `Kf` is wrapped by whichever key the file's *readers* hold: a `private` booking or a per-family `shared_separate`/`shared_one_separate` booking keeps its attachment `Kf` wrapped under the uploader's **HDK** (only that family may download it — `canSeeAttachment` gates the bytes server-side, and that family holds the HDK), while a `shared_shared` booking (one receipt every participant sees) wraps `Kf` under the **TripKey** (`ks:'trip'` on the wrap envelope). The ciphertext bytes on disk are the same random-`Kf` chunked AEAD either way; only the wrap differs, and the client routes decryption by the parsed `wrappedFileKey.ks`. Because encryption on shared bookings was previously *refused* (the retired 409), there is no pre-existing encrypted shared attachment to migrate — the `Kf`-wrap key is chosen at upload from the booking's current tier. This is why D2 needs **no** attachment rewrap endpoint even though it retires the plaintext attachment lane.

  **Write rule.** Mirrors D1: `sealedContentFields` strips the plaintext content columns UNCONDITIONALLY for any `enc.ks` (a resource-sealed record is private by construction — a cross-household collaborator's household may not be `e2eeActive`). The `isTripShared` enc-strip in the trip/item create+update routes is deleted; the trip mandate (`plaintextCreateBlocked`) is enforced only on **unshared** trips/items, so a shared trip degrades gracefully to a plaintext write when a client can't yet provision the TripKey (same graceful-degrade + min-app-version gate as D1's calendars). `Trip.startDate/endDate` and `TripItem.start/end/cost/currency/shares/householdData` stay plaintext (routing + server-computed budget/settlement) — only `DROP_FIELDS` content (`Trip: name/destination/notes`, `TripItem: title/location/url/phone/notes/details`) seals under the TripKey, so trips need **no** dateless-read special-case (unlike D1's calendars, whose event dates are sealed).

  **Invitation snapshot.** `Trip.name`/`destination` are sealed content, so the `TripInvitation` display snapshot (which a non-member invitee must see before they accept — the email-invite contract) can't read them off the sealed Trip. The share request carries an explicit plaintext `tripName`/`destination` snapshot from the owner's decrypted trip, used ONLY for the invitation row (never written back to the Trip). This is the same bounded disclosure the invite email already makes to the person being granted access — it does not reintroduce a Trip plaintext lane.

  **Ownership = household (not just the creator).** Unlike D1 (calendar key managed by `cal.userId` only), the TripKey is managed by any member of the owning household (`req.scopeIds` ∋ `trip.userId`) — trips are household-scoped (`ownerFilter`), every member holds the HDK, and the compare-and-set on `Trip.tripKeyVersion` makes concurrent mints safe. So the reconcile runs on whichever household member unlocks next, not a single designated device.

  **Drop deviation (identical to D1's).** The HDK straggler / reseal-all / old-versions passes KEEP `excludeSharedFilter` (never HDK-seal a shared-trip record, plaintext-lane or TripKey-sealed); full filter retirement waits until zero plaintext-lane shared trips remain. `excludeSharedFilter` is removed only from the drop + re-drop NULL steps (where `enc exists` is the correct gate: a TripKey-sealed record carries `enc` so its plaintext is nulled — collaborators read it via the TripKey — while an un-migrated plaintext-lane shared trip carries no `enc` and is shielded).
- [x] **D3 — Event invitations: encrypt when the recipient is known (minimizes §9.4, keeps email interop).** Built 2026-07-17 (execution pass 6). Keep the plaintext-snapshot contract for **non-account** email/SMS recipients (constraint #1 — the `.ics` email and public capability URL require it). Enhancement: when the invited address matches an account with enrolled keys, seal the snapshot to the recipient's `identityPublicKey` instead of storing it plaintext (lazily-claimed invitations upgrade on claim); the email then carries only a "you've been invited — open the app" notice. Revoke hard-deletes the snapshot either way.

  ### D3 decision doc — sealed-snapshot invitation (a raw sealed box, OUTSIDE the RecordEnvelope surface)

  Written before building. D3's crypto is a one-shot per-invitee wrap, NOT a resource key: no versioned key, no rotation, no `ResourceKeyEnvelope` collection. It is orthogonal to D1/D2 and to the C4→C3 refactor.

  1. **Crypto primitive — an anonymous sealed box over JSON.** New `sealJsonToMember(payload, memberPub)` / `openJsonFromMember(sealed, keyPair)` in `shared/crypto` — `crypto_box_seal`/`_open` over `padJson(JSON.stringify(payload))` (reuses C1 padding so the ciphertext length doesn't leak the snapshot size). This is the *same* sealed-box primitive as D1/D2's `wrapResourceKeyForMember`, but the sealed blob lives directly on the `EventInvitation` row (`sealedEvent`), addressed to exactly ONE recipient. Because it is NOT a `RecordEnvelope` (no `alg`/`ks`/scoped-AAD, no `collection`), it is entirely orthogonal to the C3/C4 opaque-envelope/authorship refactor — that bumps the RecordEnvelope version; D3's blob is untouched. **Invariant:** `sealedEvent`, when present, is a sealed box openable only by the invitation's recipient (sealed to that user's `identityPublicKey` either by the organizer at invite time or by the recipient itself on the lazy upgrade).

  2. **Server stays content-blind and does NO crypto.** All sealing/opening is client-side (mirroring D1/D2 — the server holds no sealed-box secret and adds no libsodium dep). The organizer's device seals at invite time; the recipient's device opens for display and passes the decrypted snapshot on accept. The server stores/serves `sealedEvent` as an opaque string.

  3. **Known-account path (the D3 win).** The organizer's device resolves the invitee via `GET /invitations/lookup?email=` → `{ userExists, identityPublicKey }` (auth'd; the pubkey is inherently public — it's the safety-number material; POST already leaked `userExists`). If the address is an account with an enrolled identity key, the client seals the decrypted snapshot to that key and POSTs `{ eventId, email, sealedEvent }` — **no plaintext `event` reaches the server at rest.** The email is a notice-only "you've been invited — open the app" (no title/when, no `.ics`; the app renders the decrypted card). For a non-account address (or one without enrolled keys) and for **all phone/SMS** invites, the client POSTs plaintext `{ event }` exactly as today — scope contract #1.

  4. **Lazily-claimed upgrade.** An invite sent to an address before it had an account is stored plaintext (unavoidable — it had to reach a keyless recipient). When that user registers and their inbox lists it (`GET /` claim sets `toUserId`), the recipient's unlocked device seals the still-plaintext snapshot to its OWN identity key and calls `POST /invitations/:id/seal { sealedEvent }`; the server stores the blob and **hard-deletes the plaintext `event`.** The recipient is the data subject sealing to itself — no organizer round-trip, and the server already possessed that plaintext, so nothing new is exposed; the at-rest plaintext is removed going forward.

  5. **Accept.** The recipient's client sends the decrypted snapshot on accept; the server builds the recipient's independent copy from `invitation.event` (plaintext lane) OR the client-supplied snapshot (sealed lane — where `invitation.event` is null). The recipient authoring their own copy is not a trust concern (it lands in their own household's E2EE domain, sealed by the lazy pass like any dual-write).

  6. **Revoke / leave / decline.** Revoke (`DELETE /:id`) hard-deletes the invitation row → drops the sealed OR plaintext snapshot either way (already true — nothing to add). Leave/decline are unchanged.

  7. **`.ics` routes degrade for sealed invites.** `GET /:id/ics` and `GET /public/:id/ics` require a plaintext `invitation.event`; a sealed invite has none, so they 404 — sealed invites are email-to-account (no SMS public link), and the recipient's app can build an `.ics` client-side from the decrypted snapshot if wanted.

  **Model.** `EventInvitation.event.title`/`.startDate` drop `required`; a `pre('validate')` enforces "either a plaintext `event` (with title+startDate) or a `sealedEvent`." New `sealedEvent: String`.

  No native deps; no envelope version bump; forward-compatible with C4→C3.
- [x] **D4 — `nextDueDate` → client-side lifecycle (full P6b move).** Built 2026-07-17 (one pass with D5). Client computes `nextDueDate` on create (`TaskFormScreen`/`ChoreFormScreen`), on complete (`TaskDetailScreen` — shared `computeNextDueDate` + the km rollover), and on template/manual instantiation (`lib/taskTemplates.ts` — `anchorRecurrence`/`seedDueDate` moved into `shared/calendar`; the server `/from-template` + `/manuals/:id/create-tasks` routes are DELETED — they were also a write-guard bypass, minting plaintext records with no enc). `POST /tasks/:id/complete` is content-blind: it records the completion and applies the client-sent `nextDueDate`/`nextDueKm`/`lastServiceKm` + re-sealed enc verbatim. Server `?status=` filters removed; the Maintenance dashboard buckets overdue/due-soon over the decrypted replica (`reminderLeadDays` window preserved). `nextDueDate` is in the task/chore enc subsets + `DROP_FIELDS`; populated item/category refs now carry their enc so sealed names decrypt in lists.
- [x] **D5 — Thin collections (full P6c move).** Built 2026-07-17. `avgKmPerDay`/`estimateDateFromKm`/`computeNextDueKm` moved into `shared/calendar`; `mobile/src/lib/odometer.ts` owns the exceeds-prior-reading validation, currentKm/kmPerDay, remaining-km/estimated-date enrichment, the mileage-task estimate refresh, and the item's odometer custom-field sync (all over decrypted logs — `GET /vehicles/:id/odometer` now returns raw rows only, `POST` is guarded + content-blind). `OdometerLog.reading`+`notes`, `RecipeSchedule.notes`, and `Category.name` are encrypted (enc subsets in `lib/encSubsets.ts`, models + `DROP_FIELDS` + `CONTENT_MODELS` + drop script extended; creates guarded). The grocery list moved client-side (`lib/groceryList.ts` — the server aggregation read sealed `Recipe.ingredients` and could never work post-drop; the AI organize endpoint still receives only client-sent item names). Default categories: single source `shared/seed/defaultCategories.json` (`@household/seed`); register-time server seed stays (sealed by the straggler pass, P1-style) + client-side encrypted seeder `lib/categories.ensureDefaultCategories` for E2EE-active households with none. Server-side category dedupe skips sealed (nameless) rows — it can no longer merge a joiner's duplicates into an encrypted set (client-side dedupe = follow-up).

## Phase E — Verifiable trust (docs, source, audit)

Half of Signal's credibility is that its claims are *inspectable*. Mostly ops/comms work, cheap to start.

- [x] **E1 — "What we can and can't see" transparency note.** The §10 recommendation, finally written: user-facing page (in-app Privacy screen + site) enumerating exactly what the server stores (ciphertext, household graph, sizes/timing, AI usage counts), what it can never read, and the **named accepted gaps** — consented AI prompts go to Anthropic ephemerally, non-account event invites are plaintext snapshots, membership graph is visible (see below). Update it as C/D items land. *Signal's lesson: stating exact boundaries is itself the trust feature.*
- [x] **E2 — Open-source `shared/crypto`.** Publish the crypto package (separate public repo or public folder) with a short spec: envelope format, AAD recipe, factor-KEK derivation, HDK/resource-key wrapping, padding scheme (post-C1). All-libsodium design audits well.
- [ ] **E3 — Third-party audit.** Scope: `shared/crypto`, the key-management flows (enrollment, join approval, rotation, resource keys), and the server's inability to reach content. Schedule after C1/B-phase land so the audited surface is the final one.
- [x] **E4 — Transparency-report + law-enforcement-response page.** Policy doc: what a subpoena can yield (the E1 list), commitment to publish request statistics. Pairs with C5's retention policy.
- [x] **E5 — Build verifiability (investigate).** DONE 2026-07-20 (pass 10). Reproducible byte-for-byte builds confirmed out of reach on EAS-managed + Apple-re-signed + FairPlay iOS; the attestable **source→build chain** (pinned lockfiles w/ integrity hashes incl. the crypto surface, EAS builds tied to a commit + retained logs, published `CRYPTO-SPEC.md` + the test bar) and the named gap (no *public* CI recipe yet — `.github/workflows` is empty; a build-from-tag pipeline publishing the EAS build receipt is the next step; Android a stronger future target) are documented in `docs/TRANSPARENCY.md` (E1) under "Build verifiability (E5)".

## Phase F — Auth alignment (Signal's account-takeover defenses)

Companion to `docs/PASSWORDLESS-E2EE-PLAN.md` — **read its 2026-07-16 correction first**: the email-OTP login that plan described was never committed. The **actual current auth** (verified in code 2026-07-16): passkey-first *registration* (on-device random secret as the envelope password, `passwordless: true`/`hasPassword: false`, account rolled back if passkey enrollment fails) with classic password signup as the alternative; login = email+password (primary UI) or a single passkey assertion (auth + PRF unlock); forgot-password = emailed code → set a **new** password → signed in (flips `hasPassword: true` even on passwordless accounts, `e2eePasswordStale` steers unlock to passkey/recovery); recovery-code mandate + `useRecoveryHealth` live. So the app is *born-passwordless on passkey devices, password-optional elsewhere* — the auth-never-decrypts invariant holds, and the recovery code remains strictly stronger than Signal's PIN+SVR (no enclave trust). Phase F adds Signal's account-takeover defenses on the auth axis (E2EE already guarantees email compromise ≠ data compromise).

- [x] **F1 — Registration-lock analog: harden the reset flow (today's takeover vector).** Signal's flagship auth defense: possessing the identifier (their phone number, our email) is not enough to take over the account. Our exposed path is **`/auth/forgot` + `/auth/reset`**: email compromise → emailed code → attacker sets a new password → signed in (and a formerly passwordless account silently becomes a password account). Rule: a reset completing on an **unrecognized device** (server-tracked, see F2) requires a second proof — passkey assertion, recovery code, or approval from an existing signed-in device (push → approve, the join-approval UX on the auth axis). Fallback so no one is stranded: an account with no passkey and an unavailable recovery code keeps the plain email reset but gets a Signal-style cool-down (completion delayed N hours, notification to the account email + all devices — takeover becomes noisy and slow instead of silent). Also: a reset on a `hasPassword: false` account should offer passkey re-enrollment first and only set a password as the explicit last resort, so passwordless accounts stop drifting back to passwords. `recoverySetupAt` tells us which lane an account is in. *(If email-OTP login is ever actually built, it inherits this same known-device rule — the original D-OTP-3 answer.)*
- [x] **F2 — Device & session registry with revocation.** Server-side session records (device name/platform, createdAt, lastSeen, id) replacing pure-stateless JWT trust — token carries a session id checked on request (or a per-user token-version bump for cheap mass revoke). Security screen lists devices; "Sign out device" revokes its session. Honest limitation (same as Signal's unlink): revocation cuts server access immediately, but data already in that device's local replica/device-key cache stays until the app clears it — say so in the UI. Prerequisite for F1's known-device check.
- [x] **F3 — New-device sign-in alerts.** Notify all other devices + the account email whenever a new device session is created (the auth-axis sibling of A1's key-change alerts; same `services/notify` fan-out). Include device name/platform and a "wasn't you? → revoke + rotate" pointer into F2/B2.
- [x] **F4 — QR device linking (local provisioning, Signal's linked-devices flow).** Built 2026-07-20 (pass 11). New (locked) device shows a QR carrying a one-shot ephemeral X25519 public key; an existing **unlocked** device scans it and seals the identity keypair (the account secret — the new device then unwraps the HDK itself via `ensureHouseholdKey`) to that ephemeral key; the server is a blind relay (`DeviceLink` slot + `POST /keys/link/start|complete` + `GET /keys/link/:id`, single-use, 5-min TTL, scoped to the account's own devices) that only ferries opaque ciphertext. **The handshake reuses the D3 anonymous-sealed-box primitive** (`generateLinkKeyPair`/`sealLinkPayload`/`openLinkPayload` = aliases of `generateIdentityKeyPair`/`sealJsonToMember`/`openJsonFromMember`) — no new crypto, so it inherits the audited surface; the ephemeral key travels out-of-band in the QR (not via the server) so a malicious server can't MITM, and a shared `publicKeyFingerprint` is confirmed on both screens. Client: `lib/deviceLink.ts` (both roles) + `importLinkedKeyPair` (arms the biometric cache → no password/recovery code needed on the new device) + `LinkDeviceScreen` (show/scan modes) reached from AccountScreen (locked "Set this one up from another device"; unlocked Devices "Link another device"). Fires a `device_linked` audit + all-devices security alert. Native deps added (`expo-camera`, `react-native-svg`, `react-native-qrcode-svg`) — installed (JS bundles, export green) but gated gracefully (lazy require, "update the app" fallback) until the EAS dev-client rebuild links them. Tests: `shared/crypto` deviceLink (3), server `deviceLink.integration` (5).
- [ ] **F5 — Finish the passwordless story (pointer).** The remaining gaps named in the passwordless plan's 2026-07-16 correction: passwordless-*first* login UI (today's `LoginScreen` leads with the password fields), a recovery path for passwordless accounts that doesn't convert them to password accounts (F1's reset change), and the eventual password retirement (that plan's 5b/5c) — **tracked there, not here.** F1 should land before any retirement so the reset path is hardened while it's becoming the only non-passkey door.
- [x] **F6 — Transport hardening (investigate, time-boxed).** DONE 2026-07-20 (pass 11). Outcome documented in `docs/TRANSPARENCY.md` (E1) under "Transport security & certificate pinning (F6)": leaf/SPKI pinning is **not operable** on Render-managed certs (auto-rotating, fresh key each rotation, timing outside our control → pinned clients brick); CA pinning is fragile (Render has switched issuers Let's Encrypt↔Google Trust Services) and weak. The operable, no-brick-risk posture (and the recommendation): a **DNS CAA** record locking issuance + **HSTS** + **Certificate-Transparency monitoring** (detection). `Expect-CT` is obsolete (browsers enforce CT by default). Noted: the stakes are lower than a plaintext service because the E2EE invariant already caps a TLS-MITM's blast radius to ciphertext + routing metadata — transport pinning is defense-in-depth, not the primary confidentiality control. If pinning ever becomes required, the prerequisite is bring-your-own-cert with a long-lived app-controlled key + a published backup pin.

**Accepted (auth axis):** email remains the account identifier and invitation channel (scope contract #1) — Signal's phone-number-privacy/usernames work has no analog here by choice.

## Phase G — AI data minimization (strip metadata from everything sent to AI)

Constraint #2 keeps the AI features, so Anthropic necessarily sees *consented content*. Phase G makes that the **only** thing it sees: no identifiers, no database metadata, no more context than the query needs. Baseline verified 2026-07-16: `chatStream.js` sends **no** user identifier to Anthropic (no `metadata.user_id`; org key + server IP only — the proxy already hides the user's IP), and the `includePersonalInfo` toggle + "what I can see" panel are the existing minimization surfaces. The actual leak: clients send **whole decrypted records** in `buildBody`/`contextBody` (`openRecord` merges content over the raw row), so Mongo `_id`s, `userId`, `householdId`, `keyVersion`, and timestamps ride along to the server AI routes and partly into prompts.

- [x] **G1 — Field-allowlist AI serializer + ephemeral record aliases.** One client-side chokepoint (`lib/aiPayload.ts`) that every assistant `buildBody`/`contextBody` passes records through: a per-collection **allowlist** keeping only the content fields the assistant needs (title/dates/notes/etc.) and dropping `userId`, `householdId`, `keyVersion`, `enc`, `createdAt`/`updatedAt`, and foreign keys not needed by tools. Record `_id`s (needed by `navigateTo`, `call_business`, `get_item_tasks`, focusEvent) are replaced with **per-conversation ephemeral aliases** (`e1`, `p3`, …); the client keeps the alias→id map and translates tool arguments/`navigateTo` results back. Server prompt-builders updated to reference only allowlisted fields. Anthropic (and the transiting server) then sees content + opaque aliases, nothing linkable to the ciphertext store.
- [x] **G2 — Identifier-free-prompt guarantee, as a test.** Audit every AI route's system-prompt construction for embedded ids/emails/household name; then pin it: an integration test that intercepts the outbound Anthropic payload and asserts it contains no ObjectId-shaped strings, no account emails, no `householdId`, and no `metadata` field. Guards the G1 property against regression (the same way `otpLogin.integration.test.js` guards "OTP carries no key material").
- [x] **G3 — Zero-data-retention with Anthropic (ops).** API traffic is already not used for training by default; request a ZDR agreement for the org so prompts aren't retained at all. Outcome (granted or not) goes verbatim into the E1 transparency note — "what Anthropic sees and for how long."
- [x] **G4 — Query-scoped context.** Built 2026-07-20 (pass 12). The calendar assistant shipped the ENTIRE decrypted calendar (every event/task/chore/trip the household ever had) on every turn — the biggest remaining AI payload. New `mobile/src/lib/aiWindow.ts`: `deriveAiWindow(texts, now, focusDate?)` derives a `[from,to]` window from the turn's conversation with cheap heuristics (relative terms, month names, explicit years, durations, history intent, the focusEvent date), defaulting to a modest span around now (−45d…+183d) and clamped to [−2y,+3y]; `scopeCalendarSources(sources, window)` filters to that window but **always keeps recurring items** (a weekly event started long ago still has occurrences inside any window — dropping it by base date would break recurrence and regress quality) and keeps the roster + recipe schedules whole (birthdays span the year; the roster is small + already consent-gated). Wired into `CalendarAssistantScreen.buildBody`, which now recomputes the window PER TURN over the raw (un-windowed) decrypted sources kept in a ref, then scopes → aliases (G1) → sends. **Widening is conversation-driven**: because the window recomputes each turn from the whole chat, a follow-up naming a later date/duration expands the next payload; and recurring items are never gated, so recurrence questions work at any range (this is the plan's "tool round-trip to widen" realized without a new round-trip protocol — the server's `list_events` still expands over exactly the scoped set the client sent). Server unchanged (it builds its prompt from the full roster for birthdays, and reads events only via `list_events`/`call_business` over `ctx.calendarSources`). Quality-safe by construction (recurrence preserved, focusEvent preserved, roster preserved); tunable via the baseline/cap constants. Pinned by `mobile/src/lib/__tests__/aiWindow.test.ts` (12).
- [x] **G5 — Same treatment for Vapi (phone calls) + transcript sealing.** The call assistant's prompt gets the G1 allowlist (event title/time + business number — never household/member ids); review Vapi's recording/retention settings and document them in E1. **Check and close: `PhoneCall` records (captured transcripts) are stored user content — if they're not in the dual-write/E2EE set, seal them under the HDK** (they're conversations about the family's appointments; content-grade, not metadata).

**Accepted (AI axis):** Anthropic sees consented plaintext content per-request (scope contract #2); org-level request volume/timing; the server transits prompt bytes (never persisted — C5 covers logs). Google Places / FX / open-meteo queries are already ephemeral-by-design (D8/D2 of the E2EE plan) — the query string *is* the feature.

---

## Out of scope — deliberate, documented in E1

| Gap | Why it stays |
|---|---|
| **Membership-graph privacy** (Signal private-groups analog: server blind to who's in which household) | Breaks the server's entire scoping/authz model and the email-invitation + approve-on-device flows (user features). Research-grade redesign (anonymous credentials, encrypted group state). Revisit only if the threat model ever demands it. |
| **On-device AI / no cloud AI** | User keeps existing AI features. Mitigations already shipped: ephemeral (unstored) prompts, `aiEnabled`/`aiUsePersonalInfo` gates, "sent to Anthropic" indicators on every surface. Phase G strips all metadata/identifiers from what AI sees — content-only, aliased, ZDR. |
| **Plaintext snapshot for non-account event invitees** | Email/SMS interop is a kept feature; a recipient with no keys can't receive ciphertext. D3 shrinks this to non-account recipients only. |
| **Timestamp precision** | `updatedAt` drives LWW sync (D6 of the E2EE plan). Coarsening breaks conflict resolution. |
| **Anonymous accounts / no email identifier** | Email is the account identity and the invitation channel (constraint #1). |

## Dependencies & sequencing notes

- **A and B are independent** of everything; start immediately. B1 is a prerequisite-in-spirit for B3 and reused by C3's migration and D1/D2's revoke-rotation.
- **C1, C5, E1** are cheap and independent — batch them early. E1 must exist before E4 and gets updated by every later phase.
- **C4 (design pass) before C3** — same envelope/endpoint surface; decide authorship handling before freezing the opaque-envelope format so the envelope version only bumps once.
- **D1 before D2** (calendars are the simpler resource — no attachments), D2 unblocks trip attachments, D3 last in D (smallest win).
- **E3 (audit) after B + C1** so the audited envelope format is final; ideally after C3/C4.
- **F2 before F1** (known-device check needs the session registry); **F3 rides on A1's** notify fan-out — build them together. **F1 before/with passwordless step 5c** (harden OTP before it's the only login). F4 is independent; F6 is a time-boxed spike.
- **G1 before G2** (the test pins G1's property); G3/G5 are independent ops/audit items. G1's alias map must land before C4 finalizes authorship handling if tool round-trips ever reference authors.
- Native deps needing a dev-client rebuild: A3 (`expo-screen-capture`), F4 (camera/QR). Batch with the next EAS build.

## Ops runbook — the prod C3b catch-up (pass-9, DROP_FIELDS_VERSION 4)

Your prod household predates the C3b store cutover, so its content still lives in
the per-collection Mongo tables, and its `enc` blobs predate the widened (full
field set) sealed subset (`DROP_FIELDS_VERSION` is now **4**). Catching it up is
the SAME re-seal + re-drop interlock as before, plus two C3b steps (a data
migration into `Record`, and dropping the old tables at the end). **Never run a
destructive script before the app re-seal session** — each script enforces this
(it refuses until `dropFieldsVersion` is current / the migration ran), but the
order is:

1. **Deploy** the pass-9 server + ship the pass-9 app build (the widened
   subsets + the `/records` API + `recordStore` chokepoint + the client re-seal
   pass must be live first). No new native deps, so no dev-client rebuild for this.
2. **App session (owner, unlocked).** Unlock on the owner device.
   `maintainKeyHygiene` sees the server's `resealNeeded` flag and runs
   `reencryptForReDrop` in the background: it decrypt-merges every record, folds
   the now-sealed routing columns (calendarType/recurrence/foreign keys/…) into a
   fresh v2 `enc`, and on zero failures POSTs `/household/e2ee/reseal-complete`
   (stamping `dropFieldsVersion = 4`). Give it a minute; leave the app foregrounded.
3. **Migrate the backlog into `Record`:**
   `node src/scripts/migrateToRecords.js <householdId> --commit`
   (dry-run first without `--commit`). Copies the 9 content collections' rows
   (`enc` + routing, `enc.ks`→`scope`) into the unified store, keyed by the same
   `_id`. Idempotent (upsert). The old tables stay for now.
4. **Dry run + commit the re-drop** (nulls the plaintext columns on any row that
   already carries `enc`, and the author `userId`, after stamping `householdId`):
   `node src/scripts/reDropPlaintext.js <householdId>` then `… --commit`.
   Refuses until `dropFieldsVersion` is current; idempotent (`already-current`).
5. **Drop the per-collection tables (irreversible, LAST):**
   `node src/scripts/dropContentCollections.js` (dry-run) then `… --commit`.
   Refuses unless every e2eeActive household is at `DROP_FIELDS_VERSION` 4 and the
   migration copied the backlog (Record ≥ each source table).
6. **Verify on-device** that calendar/tasks/people/recipes/items/categories/meal
   plan still display (all decrypt from `Record`). Look the household up by **ID**
   (Household screen, bottom) since the name is nulled server-side.

Households born-encrypted from pass 9 on write straight to `Record` at the current
version, so they never need this — `resealNeeded` stays false and there are no
per-collection rows to migrate or drop.
