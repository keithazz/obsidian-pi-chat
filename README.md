# Claude-driven PLAN/EXECUTE workflow

A minimal, subscription-only (no API key) workflow for planning work interactively and
executing it — interactively or AFK in sandboxed Claude Code web sessions — with a strict
**one-session-one-PR** review model.

## The two phases

**PLAN** (interactive, desktop/CLI, where you converse):
1. `grill-with-docs` — interrogate a feature against existing docs, surface gaps, flag
   documentation that needs updating. Produces a decided/undecided/docs-to-update summary.
2. `create-task` — break the discussed work into **simple** (single MD file) and
   **complex** (folder + README index + subtasks) tasks. Proposes a high-level breakdown
   for your sign-off, then writes MD files you review manually.

**EXECUTE** (interactive *or* AFK sandboxed web session):
- You launch a session from the Claude app pointed at the repo and tell it which task(s)
  to implement. The session works on one branch and opens **one PR** for your review.
- Because a session is the PR boundary, *you* decide review granularity by choosing what
  goes in the prompt — Claude never splits PRs on its own.

## Launch vocabulary (EXECUTE)

- `Implement tasks/001-foo.md. Open one PR.`
- `Implement all of tasks/002-bar/ following its README order. One PR.`
- `In this one session, implement tasks/001-foo.md and all of tasks/002-bar/. Single PR.`

## Verification tier

EXECUTE runs in a **lightweight sandbox: lint + type-check + unit tests only**, provisioned
by `environment/setup.sh`. It has no databases, queues, browsers, or running services.
Anything beyond unit level — integration, E2E, real migrations, manual UI checks — is out
of scope for the sandbox and is flagged for the human in each PR's `## Manual testing
required` section. Task files carry those reviewer instructions explicitly.

## Documentation model (split by mutability)

- `docs/adr/` — Architecture Decision Records. **Append-only**, immutable once accepted;
  supersede rather than edit. History has standalone value.
- `docs/product/` — Feature intent. **Evergreen**, edited in place.
- `docs/reference/` — Data models, API contracts, conventions. **Evergreen and must track
  code**; updated during EXECUTE in the same PR as the code.

Decisions (ADRs, product docs) are authored during PLAN. Code-tracking reference updates
happen during EXECUTE. This keeps one writer per doc per phase and prevents drift.

## Installation

### New repo
Copy `CLAUDE.md`, `.claude/`, `docs/`, and `tasks/` into your repo root. Set up branch
protection on your default branch (required PR review, no direct pushes) so EXECUTE
sessions can only ever open a PR, never merge. Start planning with `grill-with-docs`.

### Existing repo
Copy the same files in, then run the **`bootstrap-workflow`** skill in an interactive
session. It scans your codebase, seeds the reference/product docs from real code, and for
every mismatch (doc layout, branch naming, existing `CLAUDE.md`, etc.) raises an explicit
**adapt-the-workflow vs refactor-the-repo** decision for you to make — nothing is changed
silently.

## Billing note

Launch EXECUTE sessions from the Claude web/mobile app while signed into your Pro/Max
subscription. Do **not** set an `ANTHROPIC_API_KEY` anywhere or connect a Console API key
in the GitHub authorization — that would switch billing to per-token API usage. With no
local environment in play, the web sessions run on your subscription.

## Layout

```
CLAUDE.md                              cross-phase rules (read every session)
.claude/skills/
  grill-with-docs/SKILL.md             PLAN: interrogate a feature vs docs
  create-task/SKILL.md                 PLAN: break work into task files
  bootstrap-workflow/SKILL.md          one-time: align workflow with an existing repo
environment/
  setup.sh                             lightweight sandbox provisioning (lint + unit)
  README.md
docs/
  adr/        _TEMPLATE.md, README     append-only decisions
  product/    README                   evergreen feature intent
  reference/  README                   evergreen, code-tracking
tasks/
  _TEMPLATE-simple.md
  _TEMPLATE-complex-README.md
  _TEMPLATE-subtask.md
```
