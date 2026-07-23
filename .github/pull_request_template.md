<!-- See specs/README.md → "The change loop". Specs lead; code follows. -->

## What & why

<!-- One or two sentences. Link the spec section this implements. -->

## Spec sync (required)

- [ ] The relevant spec(s) under `specs/` are updated in this PR
      (`features/<area>.md` for a feature change; `platform/*` for API /
      data-model / crypto changes).
- [ ] A test proves the behavior change, and it's registered in the owning
      spec's `tests:` frontmatter + `## Verification` section (or the change is
      not observable — say so below).
- [ ] `last-verified` bumped on every spec I touched (commit + date).
- [ ] `node scripts/check-spec-sync.mjs --base main` reports no spec or test
      drift (or the drift is explained below).

<!-- If code changed but NO documented behavior changed, say so here so the
     spec-sync gate's warning is accounted for: -->

## Verification

<!-- `npm test` result / on-device read-back / what you checked. -->
