---
title: Calendar & events
status: current
last-verified: b242e6c (2026-07-20)
code:
  - mobile/src/screens/calendar/
  - mobile/src/lib/calendar.ts
  - mobile/src/lib/calendarData.ts
  - mobile/src/lib/eventRepeat.ts
  - server/src/models/CalendarEvent.js
  - server/src/models/CustomCalendar.js
  - server/src/routes/calendars.js        # custom calendars + calendar keys + invitations
  - server/src/routes/records.js          # the store events are actually persisted in
  - server/src/routes/calendarChat.js     # the calendar assistant
  - shared/calendar/                       # recurrence expansion (shared engine)
---

# Calendar & events

## Purpose

The calendar is Calen's home surface: a household's events across built-in and
user-defined calendars, with recurrence, reminders, travel time, invitees
(including people outside the household), holidays, an optional weather overlay,
and printing. It is also the anchor for the calendar AI assistant.

## Behavior (normative)

### Events

- An event MUST belong to a `calendarType`: a built-in calendar (`activities`,
  `appointments`) or a user-defined calendar (`custom-<slug>`). The mobile "Add
  calendar" flow mints `custom-<slug>` ids on-device.
- An event carries a `title`, optional `description`/`location`/`url`/`phone`, a
  `startDate`, optional `endDate`, and an `allDay` flag (default true).
- **Recurrence** supports `daily` / `weekly` / `monthly` / `yearly` with an
  `interval`, optional `until`, and pattern refinements: weekly `daysOfWeek`,
  monthly `daysOfMonth` or `weekOfMonth`+`weekdayKind` ("on the last Friday"),
  and yearly `months`. Occurrence expansion is done by the shared engine
  (`shared/calendar/`), so mobile and any other consumer agree.
- **Reminders/alerts:** up to two alerts per event (`reminderMinutes`/`At`,
  `alert2Minutes`/`At`), delivered as on-device local notifications. In a shared
  household, `alertAudience` targets `everyone` or just the `owner` (creator).
  See [notifications.md](notifications.md).
- **Travel time** (`travelMinutes`, `travelDistanceKm`) may be attached so an
  event's reminder accounts for getting there.
- **Cancellation via AI call:** when Calen's cancellation call gets a business to
  confirm, the event is marked `cancelled` and stays on the calendar. See
  [ai-assistant.md](ai-assistant.md).

### Custom calendars

- A household may create custom calendars (colour + name); these are managed
  through `server/src/routes/calendars.js` (`/api/calendars`) and the mobile
  Calendars / Add-Calendar / Calendar-Colors screens.
- Custom calendars can be **subscribed** (external ICS feeds) and **holiday**
  calendars added; see the Subscribe/Holiday screens.

### Invitees & sharing

- An event may invite **people inside the household** and **people outside it**.
  Outside invitations go through `server/src/routes/invitations.js`; the invitee
  receives an emailed snapshot + calendar attachment (see Encryption boundary).
- `guestListVisible` controls whether cross-household invitees can see who else
  is invited.
- Accepting a cross-household invitation creates a **copy** event on the
  accepter's calendar with `invitationId` set; on that copy the client's delete
  action becomes **"Leave event"** (which also retires the invitation).
- A **calendar** (not a single event) can be shared by email as well; calendar
  invitations are accepted/declined via `/api/calendars/invitations/*`.

### Overlays & output

- The calendar screen can overlay **weather** for the visible range (fetched
  client-side from the decrypted home location; see `shared/weather`).
- **Holidays** and **birthdays** (from People) surface as read-only events.
- Events/agenda can be **printed** (`mobile/src/lib/printCalendar.ts`, Print
  screen).

## Data & API surface

- **Model:** `CalendarEvent` (`server/src/models/CalendarEvent.js`). Custom
  calendars: `CustomCalendar`. Cross-household invites: `EventInvitation`;
  emailed non-account invites also touch `CalendarInvitation`.
- **Persistence:** events are **not** stored via a `/events` route. They are
  content records in the **unified opaque record store** — created/updated/
  deleted through `POST/PUT/DELETE /api/records` and pulled with the incremental
  last-writer-wins sync `GET /api/records/sync`. The `CalendarEvent` schema
  defines the *decrypted* shape and the plaintext scope fields; the server
  stores the sealed blob. See [platform/data-model.md](platform/data-model.md).
- **Custom calendars / keys / invitations:** `server/src/routes/calendars.js`
  (`/api/calendars`, including per-calendar key envelopes under `/:key/keys`).
- **Assistant:** `server/src/routes/calendarChat.js` (`/api/calendar/chat`).
- **Client:** `mobile/src/screens/calendar/*` (Calendar, Day, Agenda, Search,
  event form + its sub-screens for location/repeat/invitees/travel, Calendars,
  Add/Subscribe/Holiday, Weather, Print, Invitations) plus `lib/calendar.ts`,
  `calendarData.ts`, `eventRepeat.ts`, `calendarKeys.ts`, `holidays.ts`.

## Encryption boundary

- **Everything is sealed.** In the live opaque record store a calendar event is a
  `Record` whose entire content — `title`, `description`, `location`, dates,
  `calendarType`, `alertAudience`, `cancelled`, recurrence, and even the fact
  that it *is* a calendar event — rides inside the encrypted `enc` blob. The
  server sees only the record's routing metadata (`householdId`, key version,
  ciphertext, optional shared-resource `scope`, tombstone, timestamps). See
  [platform/data-model.md](../platform/data-model.md).
  - The `CalendarEvent` schema's per-field "plaintext scope field" comments
    describe the earlier dual-write era; they are **not** server-visible for new
    records. Reminder *timing* is handled on-device (local notifications), not by
    a server-visible schedule field.
- **Outside sharing is a minimized plaintext exception.** Event invitations to
  people who **have accounts** are **sealed** to the recipient (Signal-parity
  D3) — no plaintext snapshot. Only an invitation to someone **without an
  account** carries a *readable snapshot* of that one event (that's what makes
  the email + `.ics` attachment work); revoking the invitation deletes the
  snapshot. A calendar shared outside the household uses a per-resource
  CalendarKey (D1) so the collaborator decrypts it without the HDK. See
  [platform/crypto-e2ee.md](../platform/crypto-e2ee.md) and `docs/TRANSPARENCY.md`.

## Out of scope

- Recurrence *math* lives in `shared/calendar/` (its own tested engine), not
  here.
- Reminder *delivery* is specified in [notifications.md](notifications.md).
- The calendar assistant's data-minimization/consent rules are in
  [ai-assistant.md](ai-assistant.md).
- Cross-household key/membership mechanics are in
  [households-sharing.md](households-sharing.md).

## Open questions

- Document the ICS subscription refresh cadence and failure behavior.

*(Resolved 2026-07-20: event reminder scheduling is fully on-device; no
server-visible schedule field remains — see [notifications.md](notifications.md).)*
