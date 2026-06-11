# Project guidance for Claude

This repository uses a two-phase, Claude-driven workflow:

- **PLAN** (interactive sessions, desktop/CLI): you converse with the maintainer to
  interrogate a feature (`grill-with-docs`) and break the work into reviewable task
  files (`create-task`).
- **EXECUTE** (interactive *or* AFK sandboxed web sessions): you implement the task
  files and open a single PR per session for the maintainer to review.

Read this whole file before doing either.

## Project orientation (read before substantive work)

This file holds the cross-phase *workflow* rules. Project-specific orientation lives in
`docs/`:

- [`docs/reference/conventions.md`](docs/reference/conventions.md) — package ownership,
  load-bearing invariants, coding conventions, and the verification tier. **Start here.**
- [`docs/reference/architecture.md`](docs/reference/architecture.md) — full technical
  architecture (cite its section numbers in commits/PRs, e.g. `architecture.md §4.1`).
- [`docs/product/`](docs/product/) — product intent (requirements, non-goals).
- [`docs/reference/navigation-api.md`](docs/reference/navigation-api.md) — navigation tool
  surface (draft).

If a request conflicts with product or architecture docs, stop and surface the conflict
rather than silently deviating.

---

## The single most important rule: one session = one PR

A session works on **one branch** and opens **at most one pull request**, no matter how
many tasks it covers. You do **not** decide how to split work across PRs — the
maintainer decides that when they choose what to put in a session's prompt. If a prompt
bundles several tasks ("implement 001 and all of 002"), that is a deliberate decision to
review everything together in one PR. Never open a second PR to "tidy up" the split.

You may never merge a PR. `main` is protected; opening the PR is your terminal state.

## Verification tier: what the sandbox proves, and what it doesn't

EXECUTE sessions run in a **lightweight sandbox provisioned for linting and unit tests
only** (see `environment/setup.sh`). That is the deliberate ceiling — the sandbox is not
provisioned with databases, queues, browsers, or running services, and you should not try
to stand them up.

**This repo currently has no unit-test runner.** The verification ceiling is the
type-checking build — `npm run build` (tsc for `shared`, esbuild for `plugin`). Treat that
as the "unit" tier until a test runner is added. See
[`docs/reference/conventions.md`](docs/reference/conventions.md) § Verification tier.

Before opening a PR you must:

- Run `npm run build` and make it pass for the code you changed. If a test runner exists by
  then, run it too. If you cannot make checks pass, say so in the PR rather than disabling
  checks or weakening tests to force a pass.

Anything that cannot be verified at this tier — integration against real services, E2E
flows, manual UI inspection, migrations against real data, performance — is **out of
scope for the sandbox** and must be handed to the reviewer. Every PR description must
include a `## Manual testing required` section listing, concretely, what a human should
test and why it was out of scope (e.g. "needs a live Postgres + Redis; run `X` and verify
`Y`"). Be specific enough that the reviewer can act without re-deriving your reasoning.
If nothing needs manual testing, state that explicitly.

Do not add or expand E2E/integration tests that require services the sandbox lacks unless
a task explicitly asks for them — write the unit-level tests you can actually run, and
flag the rest for manual verification.

## If you cannot finish the assigned scope

Do not silently descope. Commit what is complete, then in the PR description add a
`## Not done` section listing every assigned item you did not finish and why. A legible
partial PR the maintainer can reason about is far better than a mystery.

## Scope discipline

- Touch only what the assigned task(s) describe. Do not refactor adjacent code,
  reformat unrelated files, or "improve" things that weren't asked for.
- Never modify `.github/`, CI configuration, secrets, or anything under `.claude/`
  unless a task explicitly instructs it.
- Never modify files under `tasks/` during an EXECUTE session — task files are inputs,
  not outputs.

---

## Documentation rules (who writes what, and when)

Documentation lives in `docs/` and is split by **mutability**:

- `docs/adr/` — **Architecture Decision Records. Append-only and immutable once
  accepted.** Never edit an accepted ADR to change a decision. To change a decision,
  add a new ADR that sets `Supersedes: NNNN`, and update the old one's status to
  `Superseded-by: MMMM` (this status line is the *only* edit ever allowed on an
  accepted ADR). The historical chain is the point.
- `docs/product/` — **Product/feature intent. Evergreen, edited in place.** One current
  truth per feature. Git history is sufficient audit trail.
- `docs/reference/` — **Data models, API contracts, conventions. Evergreen, and MUST
  track the code.** A reference doc that lies is worse than none.

**Ownership per phase (avoid drift by giving each doc one writer per phase):**

- PLAN owns *decisions*: creating ADRs and editing product docs happens during
  planning, with the maintainer.
- EXECUTE owns *code-tracking*: when your code change contradicts a `docs/reference/`
  doc, update that reference doc **in the same PR**. If a change embodies a new
  architectural decision that has no ADR yet, add one (never edit an accepted ADR —
  supersede it). A task file may carry an explicit reference-doc update as a checklist
  item; treat that as part of the task's definition of done.

---

## Task file conventions

This repo uses **underscore** separators (`NNN_slug`), not hyphens.

- A **simple task** is a single self-contained `tasks/NNN_slug.md`.
- A **complex task** is a folder `tasks/NNN_slug/` containing a `README.md` index, an
  optional `00_decisions.md` (read it first when present — it records the transport/codec/
  naming decisions the subtasks cite), plus `NN_subtask_slug.md` files. The README states
  subtask order and dependencies and holds shared context.
- When implementing a complex task, **read its `README.md` (and `00_decisions.md`) first**,
  follow the stated order, and respect any subtask marked `HARD DEP:` before its dependents.
- When assigned a single subtask in isolation, treat the parent folder's `README.md`
  `Goal` and `Shared context` as your intent even though you're only doing one piece.

## Launch vocabulary the maintainer uses (for your interpretation)

- `Implement tasks/001_foo.md. Open one PR.` → one simple task.
- `Implement all of tasks/002_bar/ following its README order. One PR.` → whole complex
  task.
- `In this one session, implement tasks/001_foo.md and all of tasks/002_bar/. Single
  PR covering everything.` → deliberate bundle, one PR.

"One PR" is always implied by the session even when unstated.
