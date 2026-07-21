---
title: Maintenance (items, tasks, chores)
status: current
last-verified: 4d68a39 (2026-07-20)
code:
  - mobile/src/screens/maintenance/
  - server/src/routes/{items,tasks,chores,taskTemplates,choreTemplates,odometer,manuals}.js
  - server/src/models/{Item,MaintenanceTask,Chore,TaskCompletion,OdometerLog,Manual}.js
  - server/src/services/recurrence.js
  - shared/seed/taskTemplates.json
---

# Maintenance (items, tasks, chores)

## Purpose

Home **items** (appliances, vehicles, systems) with attached manuals; recurring
**maintenance tasks** and household **chores**; a rural-home template library; and
odometer tracking for mileage-based service.

## Behavior (normative)

### Items & manuals

- An `Item` has name, category, property, optional service-pro link,
  manufacturer/model/serial, location, notes, custom fields, and a photo. It can
  auto-look-up a manual (`autoLookupManual`).
- Manuals are files attached to an item (`Manual` model, `manuals` router):
  uploaded PDFs or fetched-from-URL, **encrypted per-file** (`Manual.encrypted`,
  `wrappedFileKey`, `keyVersion`). `items` router is AI-only (`POST /items/from-photo`).

### Tasks & chores

- A `MaintenanceTask` binds to an item/category and recurs by interval
  (`intervalValue`/`intervalUnit`), calendar/seasonal pattern (`recurrence`), or
  mileage (`intervalKm`/`lastServiceKm`/`nextDueKm`). It tracks
  `lastCompletedAt`, `nextDueDate`, cost/duration estimates, priority, and alert
  config (`reminderDaysBefore`, `alert2DaysBefore`, `alertAudience`,
  `alertUserIds`).
- A `Chore` is the lighter household variant (recurrence, `assignedTo`,
  `nextDueDate`, alerts) without item binding. Tapping "+" on the chores list
  opens an **Add Chore chooser** (`AddChoreScreen`) — mirroring the item form's
  "what would you like to add?" scope step — offering *add a chore by hand*
  (→ `ChoreForm`) or *use a template* (→ `ChoreTemplates`). The chooser
  `replace`s itself so Back returns to the list, not the chooser.
- **"Ask Calen" form-assist** on the task and chore forms fills fields from a
  plain-language description (via the generic `formAssist` route — AI endpoints
  here, incl. item photo scan and manual extract/auto-lookup, are refused
  server-side when the account's AI toggle is off; see
  [ai-assistant.md](ai-assistant.md)). A field the form doesn't advertise can
  never be set by the assistant, so the schema advertises the whole editable
  form: title/instructions(description)/assignee/due-date, the **icon** (a
  `select` over the form's suggested glyph set), the **alert** timings
  (`reminderDaysBefore`, `alert2DaysBefore`; chores also expose `alertAudience`),
  and the **recurrence**. Because the generic route only accepts flat fields, the
  `RepeatRule` is exposed as primitives (`repeatFrequency`, `repeatInterval`,
  `repeatWeekday`, `repeatDayOfMonth`, `repeatMonths`) and reassembled client-side
  (`lib/recurrence.ts` `applyRecurrenceAssistPatch`) — covering daily / every-N /
  weekly-on-a-day / monthly-on-a-date / yearly-in-months; the niche "on the 2nd
  Tuesday" ordinal form stays editable only on the Repeat screen. So a request
  like "make laundry day Saturdays" now updates the repeat rule, not just the
  next due date.
- **Completion** recomputes the next due date via `services/recurrence.js`:
  `POST /tasks/:id/complete` logs a `TaskCompletion` and advances `nextDueDate`
  (or `nextDueKm`). `GET /tasks/completions` is the history log. Chore/task CRUD
  otherwise flows through the opaque `/records` store.
- **Templates:** browse read-only catalogs — `GET /task-templates` (+ `/:id`,
  from `shared/seed/taskTemplates.json`) and `GET /chore-templates` — and add
  them via the review screens. Templates are **reusable**: a household may add
  the same template more than once (nothing blocks re-adding). A template that
  already backs a record shows a non-blocking "In Use" hint but stays tappable;
  the stored `templateId` drives only that hint, not any single-use limit.

### Odometer

- `OdometerLog` (itemId, reading, recordedAt, notes) feeds mileage-based tasks:
  `GET/POST /vehicles/:itemId/odometer`, `DELETE /:logId`.

## Data & API surface

- **Models:** `Item`, `MaintenanceTask`, `Chore`, `OdometerLog` (content records,
  sealed in the opaque store), `TaskCompletion` (history), `Manual` (encrypted
  file + metadata).
- **Endpoints:** `tasks.js` (completions + complete), `odometer.js`, `manuals.js`,
  `items.js` (from-photo), template routers; CRUD via `/records`.
- **Client:** `screens/maintenance/*` (Maintenance, Items, Tasks, Chores, their
  detail/form screens, template + AI-plan screens).

## Encryption boundary

Items, tasks, chores, and odometer logs are sealed content records; manual file
bytes are encrypted per-file. **Scheduling is sealed too** — `nextDueDate`,
`nextDueKm`, `intervalKm`, `lastServiceKm`, and odometer reading/notes are in
`DROP_FIELDS` (Signal-parity D4/D5), and due-date/mileage computation runs
client-side via the `shared/calendar` engine. Reminder timing is on-device — see
[notifications.md](notifications.md) and
[platform/data-model.md](../platform/data-model.md).

## Open questions

- Confirm mileage-based due recomputation path end-to-end (odometer → nextDueKm),
  now that the km engine lives in `shared/calendar`.
