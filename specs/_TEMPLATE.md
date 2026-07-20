---
title: <Feature or subsystem name>
status: stub            # stub | draft | current
last-verified: <commit-sha> (<YYYY-MM-DD>)   # last time this was checked vs code
code:                   # primary implementation entry points
  - <path/to/file-or-dir>
---

# <Title>

## Purpose

One or two sentences: what this is and why it exists, from the user's point of
view.

## Behavior (normative)

The observable rules. Use MUST / SHOULD / MUST NOT. Describe *what the system
does*, not how the code is organized. Cover the happy path plus the important
edges (empty, error, permission, offline, shared vs. private).

## Data & API surface

- **Model(s):** the record shape(s) this owns, and which fields are content
  vs. plaintext scope.
- **Endpoints / sync:** how the client reads and writes it.
- **Client:** the screens and libs that drive it.

## Encryption boundary

What is end-to-end encrypted vs. what is deliberately server-visible (scope,
scheduling, sharing), and why. Cross-link `platform/crypto-e2ee.md`.

## Out of scope

Things people might expect here but that live elsewhere (link them), or that are
deliberately not built.

## Open questions

Known gaps, TODOs, or decisions not yet made.
