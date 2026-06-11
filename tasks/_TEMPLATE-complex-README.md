# NNN — <complex task / feature title>

> Complex task index. A session may implement this whole folder (one PR for the feature)
> or a single subtask in isolation. Read this README first either way.

## Goal

A paragraph stating the feature's intent and the problem it solves. **This is the shared
intent every subtask inherits** — when a subtask is assigned alone, the implementer reads
this to understand the bigger picture.

## Subtasks (execute in order)

- [ ] `01-<slug>.md` — <one line> — deps: none
- [ ] `02-<slug>.md` — <one line> — HARD DEP: 01
- [ ] `03-<slug>.md` — <one line> — HARD DEP: 01
- [ ] `04-<slug>.md` — <one line> — soft dep: 03

> `HARD DEP: NN` means the dependency must be fully complete before this subtask starts —
> if implementing the whole folder in one session, sequence accordingly; if a hard
> dependency isn't yet merged and you're doing a subtask alone, stop and flag it.
> `soft dep` means preferred ordering but not blocking.

## Shared context

Things every subtask needs: data models, naming conventions, architectural constraints,
external services, and explicit out-of-scope notes for the feature as a whole. Reference
`docs/reference/` and any relevant ADR by number.

> **Verification tier (sandbox):** lint + type-check + unit tests only. Each subtask
> carries its own `## Manual testing required` for the reviewer; when the whole folder is
> implemented in one session, the PR should aggregate those into one manual-testing list.

## Documentation impact (for the executing session)

- ADR(s): <created during PLAN — list numbers, or "none">
- Product doc: `docs/product/<file>.md` — <edited during PLAN / to edit>
- Reference docs to update during EXECUTE:
  - [ ] `docs/reference/<file>.md` — <what changes> (also noted in the relevant subtask)
