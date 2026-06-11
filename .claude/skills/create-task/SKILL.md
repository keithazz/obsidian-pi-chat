---
name: create-task
description: >
  Turn a planning conversation into reviewable task files (simple single-file tasks and
  complex task folders) that an execution session — interactive or AFK sandboxed web —
  will later implement. Use this skill after a feature has been discussed or grilled and
  the user wants to capture the work, whenever they say things like "let's break this
  down", "turn this into tasks", "create the task files", "split this up into work", or
  "scaffold the work for this". It first proposes a HIGH-LEVEL breakdown for sign-off,
  then writes MD files from templates only after the user approves. Prefer this over
  inventing your own task layout. Does NOT implement the tasks.
---

# create-task

Your job is to convert discussed work into well-formed task files that match this
repository's simple/complex conventions, so that a later execution session can pick them
up with no extra context. You decide *nothing* about review boundaries — you only shape
the files.

## Step 0 — Gather intent

Use the current conversation as primary input (often this follows a `grill-with-docs`
session). If you're missing the feature's intent, scope boundaries, or the
`Documentation impact` items, ask briefly before proceeding. Read `CLAUDE.md` and the
task templates in `tasks/` so your output matches conventions.

## Step 1 — Propose a high-level breakdown FIRST (gate)

Before writing any file, present a breakdown and get explicit sign-off. Show:

- Each proposed task, its **classification** (simple file vs complex folder), and a
  one-line description.
- For complex tasks: the subtask list with proposed order and any `HARD DEP:` links.
- Which `docs/reference/` updates (from grilling) attach to which task as definition-of-
  done checklist items.

Then ask the maintainer to confirm or adjust. **Do not write files until they approve.**
The simple/complex split and the eventual review bundling are the maintainer's calls,
not yours.

Classification guidance:
- **Simple** (single `tasks/NNN-slug.md`): a bounded change — bug fix, small enhancement,
  one isolated unit of work that a reviewer can hold in their head as one diff.
- **Complex** (`tasks/NNN-slug/` folder + `README.md` + subtasks): a feature, refactor,
  or anything where subtasks have ordering or dependencies, or where the work is large
  enough that subtasks might be assigned individually.

## Step 2 — Number tasks

Scan `tasks/` for the highest existing `NNN` prefix and continue from there. Use a
three-digit zero-padded prefix and a short kebab-case slug (`tasks/003-search-revamp/`).
Subtasks inside a folder use a two-digit prefix (`01-define-schema.md`).

## Step 3 — Scaffold from templates

Only after sign-off, create files:

- Simple task → copy `tasks/_TEMPLATE-simple.md` → `tasks/NNN-slug.md`, fill it in.
- Complex task → create `tasks/NNN-slug/`, then:
  - `README.md` from `tasks/_TEMPLATE-complex-README.md` (fill Goal, Shared context, and
    the ordered subtask checklist with dependency annotations).
  - one `NN-subtask-slug.md` per subtask from `tasks/_TEMPLATE-subtask.md`.

Fill files completely enough that an execution session with **no memory of this
conversation** could implement them. Every task file must restate enough intent to stand
alone — especially subtasks, which may be assigned in isolation; point them at the
folder README's `Goal` and `Shared context`.

Carry any reference-doc updates into the relevant task's "Documentation to update"
section so EXECUTE makes them alongside the code.

Fill each task's **`## Manual testing required`** section using the grilling discussion:
the sandbox only proves lint + type-check + unit tests, so anything needing live services,
E2E, real migrations, or UI inspection belongs here as concrete reviewer instructions.
This is often the most valuable part of the file for AFK work — be specific.

## Step 4 — Hand off

After writing, list the files created and remind the maintainer that these are for manual
review before assignment, and recap the launch vocabulary (one task / whole folder /
bundle) so they know how to dispatch them. Do not implement anything.

## What this skill must NOT do

- Do not write code or open PRs.
- Do not decide how tasks will be bundled into review/PR sessions — only produce the
  files; bundling happens at execution launch.
- Do not skip the Step 1 sign-off gate.
