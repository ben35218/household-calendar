---
title: Calendar & events
status: current
last-verified: 797df57 (2026-07-21)
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
  confirm, the user resolves the outcome **from the event view itself** — the
  event stays on the calendar (faded/struck) until they **delete** it. The event
  view surfaces the conclusion in context (the business called + the call
  summary). The Event Action screen's **"Share my contact details if asked"**
  switch (default off) controls whether the AI caller may give the user's
  phone/email for identity checks. See [ai-assistant.md](ai-assistant.md).
- **Resolved events are dimmed on every calendar surface** (month grid, agenda,
  day view): a **confirmed-cancelled** event renders faded with a strike-through
  title; an event with a **confirmed reschedule not yet applied** to its time
  renders faded (no strike) as a "still at the old time, needs updating" cue. Both
  signals are **derived from the household's recent calls** (the server can't set
  a flag under E2EE), not stored on the event, and both **clear when the call
  notice is acknowledged** — Dismiss on the event view or OK in Invitations
  (one shared `acknowledged` flag) — returning the event to a normal appearance.
  A **hand-set** `cancelled` flag (from the "couldn't confirm → mark cancelled"
  path) persists until the event is deleted.

### Views (month display density)

The calendar home is a **single month surface** rendered at one of four
densities, chosen from a view switcher — the left-most of the three floating
buttons in the top-right cluster (search + add are the other two). The switcher
button's glyph reflects the active mode; tapping it opens an **anchored dropdown
popover** (not a bottom sheet — this is the one deliberate exception to the
bottom-sheet picker convention, to mirror Apple Calendar) listing the modes with
a checkmark on the active one and a divider isolating **List**. The choice is
**persisted device-local** (`hc_month_density`, `lib/calendarPrefs` →
`useMonthDensity`); default is **Details**.

- **Compact** — a uniform short row per week; each day shows the day number and a
  row of up to four coloured **dots** (one per source: each spanning span
  covering the day, each single-day event, and one per maintenance/chore/meal
  group). No text, no bars. The whole month fits with room to spare.
- **Stacked** — each single-day item renders as a thin **coloured bar** (no
  text); multi-day events and trips render as the overlaid spanning bars.
  Week-row height grows with the busiest day.
- **Details** — the full month grid: event **chips** (title + start time),
  labelled spanning bars, and the maintenance/chore/meal/grocery icon row. This
  is the pre-switcher behavior.
- **List** — a compact single-month grid (dots per day, like Compact) with the
  **tapped day's events listed below** (as compact cards). Only the visible
  month's days are shown (leading/trailing days of adjacent months are blanked).
  The grid is an **interactive vertical carousel**: dragging scrolls continuously
  into the adjacent month (up reveals the start of the next month, down the end of
  the previous), and on release it **snaps to a full month** — past a distance/
  velocity threshold it commits to the adjacent month, otherwise it springs back.
  Tapping a day fills the list. Entering List **re-centres on today** — the current
  month with today selected and circled in the primary colour — rather than
  resuming the last browsed month. This mode **replaced the former standalone
  "events" agenda view** (a full-screen infinite agenda toggled by a list button),
  which has been removed.

Compact/Stacked/Details share one continuously-scrolling grid layer; List is a
separate layer. The switcher crossfades between the grid family and List; the
shared floating chrome (avatar, switcher/search/add, Today, Calendars/
Invitations/Assistant) never moves. The single **Today** button re-centres
whichever layer is active.

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
