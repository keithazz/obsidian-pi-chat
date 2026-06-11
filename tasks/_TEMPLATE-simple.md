# NNN — <task title>

> Simple task: one self-contained unit of work, implemented in a single session, one PR.
> This file must stand alone — the executing session has no memory of the planning chat.

## Goal

One or two sentences: what this task achieves and why.

## Context

What an implementer needs to know to start: relevant files/modules, the current behaviour,
links to `docs/product/` or `docs/reference/` sections that apply.

## Scope

**In scope**
- <bullet>

**Out of scope** (do not touch)
- <bullet>

## Acceptance criteria

- [ ] <observable, checkable outcome>
- [ ] <…>

> **Verification tier (sandbox):** lint + type-check + unit tests. The execution sandbox
> has no databases, services, or browser — anything beyond this tier goes to
> `## Manual testing required` below.

## Manual testing required (reviewer)

What the reviewer must verify by hand because it was out of scope for the sandbox, and
why. Be concrete (commands to run, what to look for). Write "none" if truly nothing.

- <e.g. "Needs live Postgres: run the migration and confirm the new column backfills.">

## Documentation to update (part of definition of done)

- [ ] `docs/reference/<file>.md` — <what changes, if any>
- [ ] (delete this section if no doc update applies)

## Notes / risks

Edge cases, migration concerns, anything the implementer should watch for.
