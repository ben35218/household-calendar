# Automated testing in the spec-driven loop — proposal (aggressive revamp)

**Status: ADOPTED & IMPLEMENTED 2026-07-22** (proposed same day). Steps 1–6 of
the adoption order below are done: the `tests:` contract lives in
`specs/_TEMPLATE.md` + `specs/README.md`, the gate enforces it, CI exists
(warn-only), the §2 backfill landed green (aiPrivacy, people, kitchen,
maintenance, notifications server suites + mobile e2ee/guardianRecovery/
safetyNumbers units), and the server coverage floor is set at the backfill
baseline. **Remaining: step 7** — ratchet CI to blocking (Open decision 1,
owner sign-off) and then drop this file (git history keeps the trail).

This is a *plan* doc (see `specs/README.md` → "Specs vs. plans"): its normative
parts have moved into `specs/README.md`, `specs/_TEMPLATE.md`, and the specs.

## Current state (audit, 2026-07-22)

### What's good

The integration harness (`server/src/test/harness.js`) boots the **real**
Express app over in-memory MongoDB (`mongodb-memory-server` + `supertest`),
runs the real register → key-enroll → invite → accept → approve flows, and
**mocks nothing** — route logic, middleware, and mongoose models all execute.
Assertion density is high (e.g. the invitations suite: ~115 assertions in 517
lines). Where tests exist they are real, not theater.

### Where coverage actually is

Coverage is concentrated almost entirely on the **crypto / security / sharing
spine** and absent nearly everywhere else.

| Area | Server-side automated tests |
| --- | --- |
| Auth/identity, E2EE mandate, household keys/invites/join, device link, guardian recovery, records, trips keys/sharing, calendar keys/custom/author-hiding/drop, billing webhook, crypto core | **Strong, real** |
| Kitchen (recipes, recipeSchedule) | **none** |
| Maintenance (chores, tasks, items, odometer, manuals, templates) | **none** (`tasks` only touched incidentally by the e2ee-mandate write-guard test) |
| People / contacts | **none** |
| AI assistant (calendarChat, choresChat, maintenanceChat, maintenancePlanChat, tripsChat, calls, formAssist) | **none** |
| Notifications (routes) | **none** (scheduler job has a unit test) |
| Mobile app | **1 screen test across 78 screens**; lib units decent (recurrence, calendarFeeds, aiPayload, holidays); crypto-boundary libs (`e2ee.ts`, `tripKeys`, `calendarKeys`, `guardianRecovery`, `safetyNumbers`) have **no unit tests** |
| CI | **none** — tests run only when someone remembers |

### The headline gaps

- **AI privacy invariants are unverified on the server.** The AI
  data-minimization rules (friends/family name-only in payloads, "on file"
  references not values, server-side `aiEnabled` gating — see
  `specs/features/ai-assistant.md` and the `ai-data-minimization` memory) have a
  *mobile* `aiPayload` unit test, but the **server-side enforcement has zero
  tests**. The privacy promises are untested exactly where they're enforced.
- **Everyday CRUD is unguarded.** Kitchen, maintenance, and people — the
  features users touch daily — have no server tests at all.
- **The mobile crypto boundary is untested.** The libs that wrap/unwrap keys on
  device are the mobile analogue of the well-tested server crypto, yet have no
  units.

**One-line summary: we test the vault door but not the house.** The revamp
below closes that.

## Problem with the loop itself

The spec loop enforces **step 1 (spec first)** — `code:` frontmatter binds each
spec to its implementation, and `scripts/check-spec-sync.mjs` maps changed code
paths to the owning spec (Stop-hook nudge + PR checklist). But **step 3
(verify) is unenforced:** nothing binds a spec's MUST/SHOULD to a test, there is
no aggregate test command, and there is no CI. A behavior change can ship with an
updated spec and no test proving it, and nothing notices.

## Principle

Give **step 3 the same teeth step 1 has.** A behavior change lands with its spec
**and** the test that proves the spec. Same aesthetic as the rest of the repo:
*point at tests, don't transcribe them*; frontmatter is a contract. Aggressive
means the mechanism has teeth — an untested normative claim is a **defect**, not
an accepted gap.

## Proposal — aggressive revamp

### 1. `tests:` and `## Verification` are mandatory, not optional

**`specs/_TEMPLATE.md` frontmatter** gains a `tests:` field symmetric with
`code:`. **A spec with `tests: []` is a defect** (like a spec with no `code:`),
not a "documented gap." That immediately marks kitchen, maintenance,
people-contacts, ai-assistant, and notifications as failing until backfilled.

```yaml
code:
  - <path/to/implementation>
tests:                    # MUST be non-empty for a `current` spec
  - <path/to/*.test.js>
```

**Body** gains a `## Verification` section mapping each important MUST/SHOULD to
the suite that exercises it. `guardian-recovery.md` already does this in prose;
formalize it everywhere.

### 2. Backfill the missing suites now (the bulk of the work)

The harness makes feature integration tests cheap — register a user, enroll
keys, hit the route, assert. Write, in priority order:

1. **AI-assistant privacy invariants (server-side) — highest priority.** New
   `server/src/test/aiPrivacy.integration.test.js`: assert that chat/call
   endpoints (a) refuse when `aiEnabled` is off server-side, (b) never emit
   friend/family field *values* (only names / "on file" refs) into the model
   payload, (c) respect per-call contact opt-in. This is the privacy promise;
   it must be tested where it's enforced.
2. **People / contacts** — CRUD, self-Person, contact import classify path,
   household-shared visibility.
3. **Kitchen** — recipes + recipeSchedule CRUD, grocery aggregation, E2EE
   born-encrypted writes.
4. **Maintenance** — chores/tasks/items CRUD, recurrence materialization,
   templates.
5. **Notifications** — route CRUD + scheduler → push fan-out (extend the
   existing scheduler unit test into an integration path).
6. **Mobile crypto-boundary units** — `e2ee.ts`, `tripKeys`, `calendarKeys`,
   `guardianRecovery`, `safetyNumbers` round-trip/property tests, mirroring the
   server crypto suite.

Every new suite is registered in its spec's `tests:` frontmatter and
`## Verification` section in the same change.

### 3. The gate gets teeth for feature areas

Extend `scripts/check-spec-sync.mjs`:

- **Rot check.** Every path in a spec's `tests:` frontmatter must exist; missing
  = failure (a renamed/deleted test silently drops coverage).
- **Test-drift as drift, not nudge.** Add a `tests:` glob per `RULES` entry.
  When a feature route changes with no matching test change, that is **drift** —
  reported alongside spec drift. (Locally still advisory via the Stop hook; the
  point is it's now surfaced, and CI reports it — see §5.)
- **Non-empty `tests:` lint.** A `status: current` spec with empty `tests:`
  fails the gate.

### 4. Aggregate runner + coverage floor

**Root `package.json`:**

```json
"scripts": {
  "test": "npm --prefix server test && npm run test:shared && npm --prefix mobile test",
  "test:server": "npm --prefix server test",
  "test:shared": "npm --prefix shared/crypto test && npm --prefix shared/calendar test && npm --prefix shared/weather test",
  "test:mobile": "npm --prefix mobile test"
}
```

(Workspace list confirmed against `shared/*` at adoption.) Once the backfill
lands, add a **coverage floor** to the server suite (e.g. `c8`/`node --test
--experimental-test-coverage`) so new untested routes can't quietly regress it.

### 5. CI

`.github/workflows/ci.yml` — the repo's first workflow. Runs the aggregate tests
and the gate on every PR.

- **Per the earlier decision, warn-only** (`|| true`, no `--strict`): CI reports
  test failures and spec/test drift but does not fail the PR.
- **Tension to resolve (see Open decisions):** "aggressive" and "warn-only"
  pull against each other. A backfill with no enforcement rots within a quarter.
  Recommend flipping CI to **blocking** (`--strict`, drop `|| true`) *after* the
  backfill lands and the tree is green — so we ratchet, never block a red
  baseline.

```yaml
name: ci
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm ci --prefix server && npm ci --prefix mobile
      - run: npm test || true                                  # warn-only for now
      - run: node scripts/check-spec-sync.mjs --base main || true
```

## Decisions so far (review 2026-07-22)

- **Scope:** design only for this pass — this doc is the deliverable.
- **CI strictness:** warn-only initially (see the §5 tension; recommend
  ratcheting to blocking post-backfill).

## Open decisions

1. **Warn-only vs. blocking CI** once the backfill is green — recommend
   ratcheting to blocking. (Reopens the earlier warn-only default deliberately,
   because "aggressive" implies eventual enforcement.)
2. **Coverage-floor number** for the server suite (start where the backfill
   lands us, then only ratchet up).
3. **Mobile depth** — crypto-boundary units are non-negotiable; how far to go on
   screen/interaction tests (Testing Library) beyond that is a scope call.

## Adoption / implementation order (when approved)

1. `specs/_TEMPLATE.md`: `tests:` frontmatter (mandatory) + `## Verification`.
2. Extend `scripts/check-spec-sync.mjs`: rot check, per-rule `tests:` globs,
   non-empty lint.
3. Root `npm test` fan-out + `.github/workflows/ci.yml` (warn-only).
4. **Backfill suites** in the §2 priority order; register each in its spec's
   `tests:` + `## Verification` as it lands.
5. Add the server coverage floor once backfill is green.
6. Update `specs/README.md` ("The change loop" + "How to keep a spec honest")
   and `.github/pull_request_template.md` to reference the `tests:` contract.
7. Ratchet CI to blocking (pending Open decision 1); drop this file.
</content>
