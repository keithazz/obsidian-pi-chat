---
name: grill-with-docs
description: >
  Interrogate a proposed feature, change, or idea against the repository's existing
  documentation before any code or tasks are written. Use this skill at the very start
  of planning ANY non-trivial feature, refactor, or behavioural change — whenever the
  user says things like "I want to add…", "let's plan…", "I'm thinking about changing…",
  "help me spec out…", or describes a feature they intend to build. It reads existing
  product, reference, and architecture-decision docs, asks sharp clarifying questions a
  few at a time, pushes back using what the docs already say, and produces a structured
  decided/undecided/docs-to-update summary. Always prefer this over jumping straight to
  implementation when the user is still figuring out WHAT to build. Does NOT write code
  and does NOT create task files.
---

# grill-with-docs

Your job is to be a rigorous, well-informed interlocutor who helps the maintainer
pressure-test a feature *before* it becomes tasks or code. You are not a cheerleader.
You use the existing documentation as leverage to find gaps, contradictions, and
unstated assumptions.

## Step 1 — Load the existing documentation first

Before asking anything, read what already exists so your questions are informed:

- Everything in `docs/product/` — the current intent of existing features.
- Everything in `docs/reference/` — data models, API contracts, conventions.
- The `docs/adr/` index and any ADRs whose subject touches this feature. Note which are
  `accepted` vs `superseded`.

If `docs/` is empty or sparse (e.g. a brand-new repo, or bootstrap hasn't run), say so
plainly and proceed — but treat "there is no documentation to grill against yet" as
itself a finding the maintainer should be aware of.

## Step 2 — Grill, a few questions at a time

Ask questions in small batches (one to three), not a wall of twenty. Let the answers
shape the next batch. Good grilling targets:

- **Contradiction with existing docs.** Quote the relevant doc and ask. E.g. "The search
  reference says results paginate at 20; does this feature change that, and if so what
  reads/writes depend on the old number?"
- **Unstated scope boundaries.** What is explicitly *out* of scope?
- **Data and contract impact.** Does this touch a data model or API contract in
  `docs/reference/`? If yes, that's a reference-doc update later — note it.
- **Decision-worthiness.** Is a genuine architectural choice being made (a tradeoff with
  lasting consequences)? If yes, it likely deserves an ADR.
- **Failure and edge behaviour.** What happens on the unhappy path?
- **Migration / backward compatibility.** What existing data or callers are affected?

Push back when an answer is vague or conflicts with a doc. It is more useful to surface a
problem now than to let it reach a PR.

## Step 3 — Converge to a structured summary

When the conversation has stabilised, end by producing this exact structure (do not write
files — this is conversational output the maintainer reads and reacts to):

```
## Decided
- <crisp statements of what is now settled>

## Undecided / open questions
- <things still genuinely unresolved, each with why it matters>

## Documentation impact
### New ADR(s) warranted
- <decision that should become an ADR, with a one-line rationale>
### Product docs to update (evergreen, edited in place)
- <which docs/product/* file and what changes>
### Reference docs to update (must track code; updated during EXECUTE)
- <which docs/reference/* file and what changes — these become task checklist items>
```

## What this skill must NOT do

- Do not write or scaffold code.
- Do not create task files — that is `create-task`'s job, and keeping them separate lets
  the maintainer grill without committing to execution.
- Do not create the ADRs/product docs yourself unasked; *propose* them in the summary.
  The maintainer decides whether to author them now (PLAN owns decisions) — if they say
  yes, you may then draft an ADR from `docs/adr/_TEMPLATE.md` or edit the product doc.

## Why the discipline matters

The quality of every later grilling session depends on the reference docs being honest.
That is why "documentation impact" is a first-class output here and why reference updates
are pushed into task definitions of done — so the docs you grill against next time still
tell the truth.
