---
title: AI assistant (Calen)
status: current
last-verified: 797df57 (2026-07-21)
code:
  - mobile/src/screens/chat/
  - server/src/routes/{calendarChat,choresChat,maintenanceChat,maintenancePlanChat,tripsChat}.js
  - server/src/routes/{calls,formAssist}.js
  - server/src/services/{chatStream,aiUsage,phoneCalls}.js
  - server/src/middleware/aiConsent.js
  - server/src/models/PhoneCall.js
  - mobile/src/lib/aiPayload.ts
---

# AI assistant (Calen)

## Purpose

"Calen" is the in-app assistant, surfaced per area (calendar, chores,
maintenance-plan, trips). It answers questions, drafts records, and can place
**outbound phone calls** (e.g. cancel/reschedule an appointment) via Vapi. It
runs on Anthropic Claude (default to the latest models — see `docs/` claude-api
reference).

## Behavior (normative)

### Chat surfaces

- Each area exposes a chat router at `/api/<area>/chat` with a common shape:
  `GET`/`POST /context` (the records the assistant may reason over) and
  `POST /` (the streamed turn, SSE via `services/chatStream.js`). The shared
  mobile `ChatScreen` drives all of them.
- Because content is E2EE, the server can't read records to build context. The
  device decrypts only the consented records and sends them with the request
  (the `POST /context` variant accepts client-supplied decrypted records);
  responses are not stored.
- Follow-up chips come from the `suggest_followups` tool inside the same
  streamed turn (`services/chatStream.js`); `POST /form-assist` powers one-shot
  "fill this form from a photo/text" flows.

### Consent & data minimization (normative)

- AI is **consent-gated**: the `aiEnabled` / `aiUsePersonalInfo` prefs hard-gate
  every surface — with AI off, the assistant is unusable and scans/extracts are
  blocked. Every AI surface shows a "sent to Anthropic" indicator.
  `aiEnabled` is **also enforced server-side**: the pref syncs to
  `User.aiEnabled` and `middleware/aiConsent.js` returns 403 on every AI route
  when it is off, so a client that bypasses the app UI cannot spend AI actions.
  `aiUsePersonalInfo` gates the surfaces that put contact/personal detail in a
  prompt: the calendar assistant omits the people roster, form-assist omits its
  contacts context, and **AI-assisted contact import** (which classifies contact
  names/companies) is hidden in favor of Direct import — turning that surface off
  requires this pref on as well as `aiEnabled`.
- Payloads are **minimized** (`mobile/src/lib/aiPayload.ts`): database
  identifiers are stripped and replaced with per-conversation aliases before
  anything leaves the device. No account identifiers are sent; requests egress
  from the server, not the user's IP. See
  [operations/transparency.md](../operations/transparency.md).
- Payloads are also **query-scoped** (Signal-parity G4): the calendar assistant
  sends only a conversation-derived **date window** of decrypted sources
  (recurrence-safe), not the whole calendar — so a single question never ships
  the full history.
- **Friends & family are name-only.** For people of type `family`/`friend`, no
  field other than the name (plus a family/friend grouping and an is-you marker)
  may appear in any AI payload — no birthdays, ages, addresses, relationships,
  interests, or notes. Consequences accepted by design: the assistant cannot see
  the birthdays calendar, and form-assist cannot fill a friend's address.
  **Professionals (`service` contacts) share the business details the user saved
  them for** — service (their `relationship`, e.g. "plumber"), business name, and
  address. Phone and email stay "on file" (see references-not-values below): the
  calendar assistant sees only `phoneOnFile`/`emailOnFile` presence flags, never
  the values. (Form-assist, whose contacts context is professionals-only, sends
  professional phone as a value for form-filling; the calendar chat does not.)
- **Rosters and record bodies are fetched on demand, not front-loaded.** The
  calendar system prompt contains no people; the model calls
  `get_household_members` when a conversation needs them — returning household &
  friends by name only, plus any saved professionals with their business details
  (phone/email as "on file" flags). `list_events` returns titles/dates/recurrence
  only; `get_event_details` returns one event's description/location on request.
- **References, not values.** Phone numbers and booking confirmation codes never
  enter model context — the model sees `"on file"` presence flags; the real
  values stay on the server/client for dialing and display. Call transcripts
  don't exist at all (not retained at Vapi — see Phone calls below);
  `check_call_status` returns the outcome summary only.
- **History is capped**: the streamed turn sends at most the last 20 chat
  messages to the model.
- **Follow-up chips come from the same conversation** (a `suggest_followups`
  tool the model calls at the end of its turn) — no separate model call
  re-sending the transcript.
- **Web-search enrichment is opt-in.** Contact import's professional lookup
  (which sends business name/address/phone into live web searches) runs only
  when the user enables it for that import; classification itself sends each
  contact's **name and company only** (phone/email/birthday merge back on the
  server from the original request, unseen by the model).

### Phone calls

- `POST /calls/cancel-event` and `POST /calls/event-action` place a Vapi call for
  an event; outcomes are captured lazily (no webhook) into `PhoneCall`
  (`GET /calls`, `GET /calls/:id`); `POST /calls/:id/ack`, `PATCH /calls/:id/link`.
- **Call outcomes never surface on the Calen assistant view** — no "recent calls"
  list and no unseen-result badge on the Calen icon. The user resolves each
  outcome on the event view (and the calendar dimming below); the assistant stays
  a pure chat surface.
- A call is a **deliberate plaintext exception**: the event title/date and the
  business number necessarily leave encryption to make the call, and the outcome
  summary is stored for the household. See
  [platform/crypto-e2ee.md](../platform/crypto-e2ee.md).
- **No call artifacts are retained anywhere.** The Vapi `artifactPlan` disables
  audio recording AND transcript storage — live transcription still powers the
  conversation and the post-call analysis, but nothing survives the call except
  the outcome summary. Consequently there is no transcript in the app either:
  the Interaction view shows status/outcome/summary only, and `GET /calls/:id`
  returns the record without transcript/recording fields.
- **The summary is PII-constrained.** Because the summary is the only surviving
  record (stored plaintext, household-visible, and re-entering model context via
  `check_call_status`), its `summaryPlan` prompt restricts it to outcome facts —
  confirmed or not, the agreed new time, any fee, next steps — and bars identity
  details spoken by either party (no names, phone numbers, emails, addresses,
  birthdates, or account/reference/confirmation numbers; parties are "the
  business" and "the client").
- **The user's contact details are per-call opt-in.** The caller's name is
  always given; their phone/email (for the business's identity check) ride along
  only when the user enables "Share my contact details if asked" on the Event
  Action screen (`shareContact` on `POST /calls/event-action`) or tells the chat
  assistant to (the `call_business` tool's `shareContactDetails` input). Default
  is off; the legacy `/calls/cancel-event` route never sends them.
- **Resolving the outcome** the user acts on the captured result, they don't just
  dismiss it. The primary place to resolve is **the event view** (the call-status
  card), so no drill-through is needed; the same actions also exist in the call
  detail / Interaction view (reachable via "View call details", and by tapping
  the notice card in Invitations, which has no event context). The Invitations
  notice card carries no inline action of its own — it only shows the outcome
  and opens the Interaction view on tap, where the user resolves/dismisses. After a confirmed **cancellation** the
  event-view card shows the conclusion + **View call details** + **Dismiss**; the
  event stays dimmed/struck on the calendar and is removed via the event's normal
  **Delete** button. **Dismiss acknowledges the call**, which clears the marking
  everywhere (calendar un-dims, the event-view card reverts to the normal Cancel-
  or-Reschedule state) — it does not delete the event. When the user does delete
  the event from the Interaction view, navigation pops **past** the deleted
  event's detail/action/form screens (the cancel-from-event flow) rather than
  returning to the now-dead detail view. A confirmed
  **reschedule** offers **Update event time**
  (opens the event form, as the agreed time isn't applied automatically) or
  **Dismiss**. A call that
  **couldn't confirm** can be retried, and a cancel that couldn't confirm can still
  be marked cancelled by hand. Every path acknowledges (`ack`) the notice. The
  event-view card shows the business called and the call summary in context.

### Usage metering

- Token usage is recorded against a weekly budget: `services/aiUsage.js` patches
  the Anthropic SDK so one-shot calls auto-record; streaming records in
  `chatStream.js`. Limits gate by plan — see
  [billing-plans.md](billing-plans.md).
- **Phone calls are metered on a SEPARATE weekly budget, measured in seconds of
  connected call time** (`tiers.<plan>.weeklyCallSecondsLimit`) — not the token
  budget, because Vapi bills calls per-minute and the LLM tokens are negligible.
  When a call ends, `phoneCalls.js` charges its `durationSeconds` against the
  household/user call-time counter once (`recordCallSecondsById`;
  `PhoneCall.metered` guards re-counting). Placement is pre-checked
  (`meterCallSeconds` on the direct routes; `callSecondsStatus` inline in the chat
  `call_business` tool) → `402 CALL_SECONDS_EXCEEDED` / a "used all your call time"
  tool error when exhausted. See [billing-plans.md](billing-plans.md).

## Data & API surface

- **Model:** `PhoneCall` (callId, event essentials, status, `summary`, outcome,
  seen/ack timestamps).
- **Config:** `ANTHROPIC_API_KEY`, `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`.
- **Client:** `screens/chat/*` (ChatScreen, AssistantScreen, per-area assistant
  screens), `lib/aiPayload.ts`.

## Open questions

- Enumerate which write-tools the assistant can invoke per surface (create event,
  add task, etc.) and their confirmation UX.
- Document the weekly-budget reset window.
- **ZDR (G3, ops):** request a zero-data-retention arrangement for the Anthropic
  org (console/support request — not a code change). Until granted, API inputs
  are subject to Anthropic's standard API retention (not used for training).
  (Vapi retention is handled in code: the `artifactPlan` disables recording and
  transcript storage per call.)
- **Verify on the next live call** that Vapi's post-call analysis still lands
  with `transcriptPlan` disabled and the custom `summaryPlan` — both the
  PassFail evaluation (the confirmed-cancel → event-cancelled flow depends on
  it) and that the summary reads as outcome-only with no identity details.
