# Calen — Specifications

This directory is the **source of truth for what Calen does today**. Each spec
describes current, intended behavior of one part of the system, mapped to the
code that implements it.

## Specs vs. plans

- **`specs/` (here) = present tense, normative.** "The calendar does X." If a
  spec and the code disagree, that's a bug in one of them — fix it.
- **`docs/` = supporting material** (cryptographic spec, user-facing
  transparency note, release runbook). Design/status *plan* docs are
  deliberately **not** kept here — plans encode "what we intend to do" with
  dated snapshots and rot by construction. When a plan's work ships, its truth
  moves into a spec and the plan is dropped (git history keeps the trail).

## Layout

```
specs/
  README.md            # this file
  _TEMPLATE.md         # copy this to start a new spec
  product-overview.md  # what Calen is, at a glance

  features/            # one spec per user-facing feature area
    calendar.md
    kitchen.md
    maintenance.md
    trips.md
    people-contacts.md
    households-sharing.md
    auth-identity.md
    ai-assistant.md
    billing-plans.md
    notifications.md

  platform/            # cross-cutting technical foundations
    crypto-e2ee.md         # system view; points to docs/CRYPTO-SPEC.md for primitives
    api-reference.md
    data-model.md

  operations/          # ship & disclose
    transparency.md
    release.md
```

## How to keep a spec honest

1. **Frontmatter is a contract.** Every spec starts with `status` and
   `last-verified` (a commit SHA + date the author last checked the spec against
   the code). Stale `last-verified` is the signal to re-verify.
2. **Point at code, don't transcribe it.** Link the real files. Never hard-code
   counts (tests, routes, models) in prose — they drift silently. Say "see
   `server/src/routes/`," not "45 routes."
3. **Behavior is normative** (MUST/SHOULD); everything else is context.

## The change loop (required)

Spec-driven development here means the spec leads and the code follows. Every
change that alters behavior MUST follow this loop:

1. **Spec first.** Before/while implementing, update the relevant spec(s) —
   `features/<area>.md` for a feature change, `platform/*` for API/data-model/
   crypto changes. Write the intended behavior, not a changelog.
2. **Implement** to match the spec.
3. **Verify** (tests + read-back) that the code does what the spec says.
4. **Bump `last-verified`** on every spec you touched to the new commit + date.
5. **Ship them together.** A behavior change and its spec update land in the
   **same commit / PR**. Code that changes an area without touching that area's
   spec is treated as drift — a defect, like a failing test.

**The gate.** [`scripts/check-spec-sync.mjs`](../scripts/check-spec-sync.mjs)
maps changed code paths to their owning spec and flags any area changed without a
spec update. It runs:

- automatically at the end of each Claude Code session (a `Stop` hook, if
  configured in `.claude/settings*.json`);
- manually: `node scripts/check-spec-sync.mjs` (working tree) or
  `node scripts/check-spec-sync.mjs --base main` (branch vs `main`);
- as the checklist in [`.github/pull_request_template.md`](../.github/pull_request_template.md).

A warning is a prompt to either update the spec or, if the change genuinely
doesn't alter documented behavior, note that in the PR. It is a nudge, not a
hard block — the discipline is the point.
