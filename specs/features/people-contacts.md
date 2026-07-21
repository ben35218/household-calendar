---
title: People & contacts
status: current
last-verified: e38ef9d (2026-07-21)
code:
  - mobile/src/screens/profile/PeopleScreen.tsx
  - mobile/src/screens/profile/PersonDetailScreen.tsx
  - mobile/src/screens/profile/PersonFormScreen.tsx
  - mobile/src/screens/profile/ContactImportScreen.tsx
  - server/src/routes/people.js
  - server/src/models/Person.js
---

# People & contacts

## Purpose

The household's people directory — family, friends, contacts, service pros —
plus the shared self "You" card. Birthdays surface on the calendar. Contacts can
be imported directly from the device or with AI assistance.

## Behavior (normative)

### People

- A `Person` has a name, relationship, `birthday`, interests, notes, address,
  and (for businesses/pros) `businessName`, `phone`, `email`. A person may link
  to a device contact (`deviceContactId`) and, for members, to an `accountId`.
- The self "You" card is a household-shared `Person` representing the account
  holder (`User.personId`), edited from the People page — there is no separate
  "About you" screen. It is identified by its sealed `accountId` matching the
  signed-in user.
- **Self-Person seeding (mandatory E2EE):** the server can no longer create
  readable content, so `Person.ensureSelf` no-ops once the household is
  `e2eeActive` and the **client** seeds the encrypted "You" record (the P1
  ensureSelf pattern). Seeding runs **at app boot**, and again the moment the key
  unlocks — not only when the People page is opened — so every person-assignment
  UI (chores, event invitees, …) always has at least "You" to pick. It no-ops
  while locked, on a not-yet-`e2eeActive` household, or once a self-record
  already exists. Because the opaque store keeps no content columns, the seed
  MUST seal both `type` (`'family'`) and `accountId` into `enc` via the shared
  `PERSON_ENC` subset; a partial subset that drops them leaves the card
  unrecognizable as "You" and ungrouped in the roster.
- People are content records (CRUD via the opaque `/records` store); the
  `people` router is **import/AI only**.

### Birthdays

- A person's `birthday` drives read-only birthday events on the calendar; those
  always alert everyone on the day. See [calendar.md](calendar.md).

### Contact import

- **Direct import:** pick device contacts and create People
  (`ContactImportScreen`).
- **AI-assisted:** `POST /people/classify` categorizes contacts. The model sees
  each contact's **name and company only**; phone/email/birthday merge back
  server-side from the request, unseen by the model. **Web-search enrichment of
  businesses/pros is opt-in per import** (`enrich: true` + the "Look up
  professionals on the web" toggle, default off). `POST /people/import` handles
  the bulk create. AI paths are consent-gated — see
  [ai-assistant.md](ai-assistant.md). Because classification necessarily ships
  contact names/companies to the model, `ContactImportScreen` offers the
  **AI-assisted** method only when **both** `aiEnabled` **and**
  `aiUsePersonalInfo` are on; with either off it hides that option, explains why,
  and falls back to Direct import (server-side, `/classify` also 403s via
  `requireAiEnabled`).

## Data & API surface

- **Model:** `Person` (content record, sealed in the opaque store; `birthday`
  encrypted, with calendar date-filtering relocated client-side).
- **Endpoints:** `people.js` (`POST /import`, `POST /classify`); CRUD via `/records`.
- **Client:** `screens/profile/{People,PersonDetail,PersonForm,ContactImport}Screen`;
  self-Person seeding in `lib/selfPerson.ts` (`ensureSelfPerson`), driven at boot
  by `hooks/useSelfPersonSeed` (mounted in `RootNavigator`) with `PeopleScreen` as
  a fallback caller.

## Encryption boundary

Person details (including birthdays and addresses) are sealed content records.

> **Known gap:** the automatic bulk import path has historically been
> plaintext-only — confirm whether it now seals like the interactive path, and
> pin the answer here + in [platform/data-model.md](../platform/data-model.md).

## Open questions

- The bulk-import encryption follow-up above.
- Document the 3-tab contacts roster (which tabs, what each does).
