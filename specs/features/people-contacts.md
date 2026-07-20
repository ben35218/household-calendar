---
title: People & contacts
status: current
last-verified: dad7c5a (2026-07-20)
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
  "About you" screen.
- People are content records (CRUD via the opaque `/records` store); the
  `people` router is **import/AI only**.

### Birthdays

- A person's `birthday` drives read-only birthday events on the calendar; those
  always alert everyone on the day. See [calendar.md](calendar.md).

### Contact import

- **Direct import:** pick device contacts and create People
  (`ContactImportScreen`).
- **AI-assisted:** `POST /people/classify` categorizes/enriches contacts
  (web-search enrichment for businesses/pros); `POST /people/import` handles the
  bulk create. AI paths are consent-gated — see [ai-assistant.md](ai-assistant.md).

## Data & API surface

- **Model:** `Person` (content record, sealed in the opaque store; `birthday`
  encrypted, with calendar date-filtering relocated client-side).
- **Endpoints:** `people.js` (`POST /import`, `POST /classify`); CRUD via `/records`.
- **Client:** `screens/profile/{People,PersonDetail,PersonForm,ContactImport}Screen`.

## Encryption boundary

Person details (including birthdays and addresses) are sealed content records.

> **Known gap:** the automatic bulk import path has historically been
> plaintext-only — confirm whether it now seals like the interactive path, and
> pin the answer here + in [platform/data-model.md](../platform/data-model.md).

## Open questions

- The bulk-import encryption follow-up above.
- Document the 3-tab contacts roster (which tabs, what each does).
