---
title: AI assistant (Calen)
status: current
last-verified: b242e6c (2026-07-20)
code:
  - mobile/src/screens/chat/
  - server/src/routes/{calendarChat,choresChat,maintenanceChat,maintenancePlanChat,tripsChat}.js
  - server/src/routes/{calls,formAssist}.js
  - server/src/services/{chatStream,chatSuggestions,aiUsage,phoneCalls}.js
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
- Suggestions/quick actions come from `services/chatSuggestions.js`;
  `POST /form-assist` powers one-shot "fill this form from a photo/text" flows.

### Consent & data minimization (normative)

- AI is **consent-gated**: the `aiEnabled` / `aiUsePersonalInfo` prefs hard-gate
  every surface — with AI off, the assistant is unusable and scans/extracts are
  blocked. Every AI surface shows a "sent to Anthropic" indicator.
- Payloads are **minimized** (`mobile/src/lib/aiPayload.ts`): database
  identifiers are stripped and replaced with per-conversation aliases before
  anything leaves the device. No account identifiers are sent; requests egress
  from the server, not the user's IP. See
  [operations/transparency.md](../operations/transparency.md).
- Payloads are also **query-scoped** (Signal-parity G4): the calendar assistant
  sends only a conversation-derived **date window** of decrypted sources
  (recurrence-safe), not the whole calendar — so a single question never ships
  the full history.

### Phone calls

- `POST /calls/cancel-event` and `POST /calls/event-action` place a Vapi call for
  an event; outcomes are captured lazily (no webhook) into `PhoneCall`
  (`GET /calls`, `GET /calls/:id`). Call chips + an unseen badge surface on the
  event; `POST /calls/seen`, `POST /calls/:id/ack`, `PATCH /calls/:id/link`.
- A call is a **deliberate plaintext exception**: the event title/date and the
  business number necessarily leave encryption to make the call, and the outcome
  summary is stored for the household. Full transcripts are never stored. See
  [platform/crypto-e2ee.md](../platform/crypto-e2ee.md).

### Usage metering

- Token usage is recorded against a weekly budget: `services/aiUsage.js` patches
  the Anthropic SDK so one-shot calls auto-record; streaming records in
  `chatStream.js`. Limits gate by plan — see
  [billing-plans.md](billing-plans.md).

## Data & API surface

- **Model:** `PhoneCall` (callId, event essentials, status, `summary`, outcome,
  seen/ack timestamps).
- **Config:** `ANTHROPIC_API_KEY`, `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`.
- **Client:** `screens/chat/*` (ChatScreen, AssistantScreen, per-area assistant
  screens), `lib/aiPayload.ts`.

## Open questions

- Enumerate which write-tools the assistant can invoke per surface (create event,
  add task, etc.) and their confirmation UX.
- Document the weekly-budget reset window and the ZDR agreement status (G3).
