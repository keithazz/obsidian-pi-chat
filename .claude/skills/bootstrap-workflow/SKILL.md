---
name: bootstrap-workflow
description: >
  Adapt this Claude-driven planning/execution workflow to an existing repository. Use
  this skill ONCE, right after dropping the workflow files into an existing codebase,
  whenever the user says things like "bootstrap the workflow", "set this up in my repo",
  "align the workflow with this codebase", or "I just added these workflow files to an
  existing project". It scans the codebase, detects existing conventions (docs location,
  branch naming, languages, existing CLAUDE.md, existing tasks/docs dirs), seeds the
  documentation scaffold from real code, and — for every mismatch between what the
  workflow expects and what the repo already does — raises an explicit decision to the
  user: adapt the workflow files to the repo, or refactor the repo to match the workflow.
  Do not silently change either side. Skip this skill for brand-new empty repos.
---

# bootstrap-workflow

Your job is to make the workflow and an existing repository agree with each other, and to
make every point of disagreement an explicit, logged choice by the maintainer rather than
a silent assumption.

## Step 1 — Scan and inventory

Explore the repo and build an inventory. Look for:

- **Existing docs**: any `docs/`, `documentation/`, `adr/`, `rfcs/`, `wiki/`, top-level
  `*.md` design notes. Note their location and style.
- **Existing `CLAUDE.md`** (root or nested) or `.cursorrules`/`AGENTS.md`-style files.
- **Existing `.claude/`** content (commands, settings, other skills).
- **Existing task/issue conventions**: a `tasks/` dir, `TODO.md`, issue templates,
  references to ticket prefixes in commit history.
- **Languages, frameworks, package managers, test runners** (read manifests:
  `package.json`, `pyproject.toml`, `go.mod`, etc.). Note lockfiles — they determine the
  exact install command for `environment/setup.sh`.
- **Existing CI / setup scripts**: `.github/workflows/`, `Makefile`, `Taskfile`, any
  existing devcontainer or setup script — these reveal how the project already installs
  deps and runs lint/unit tests, which `setup.sh` should mirror.
- **Branch & PR conventions**: default branch name, branch-naming patterns in recent
  branches, whether branch protection appears to exist, PR template.
- **Data models & API surface**: enough to seed reference docs (ORM models, schema files,
  OpenAPI specs, route definitions).

Summarise the inventory back to the maintainer before changing anything.

## Step 2 — Diff workflow expectations against repo reality

The workflow assumes these defaults. For each, compare to what you found:

| Workflow expects            | Common repo realities that conflict                    |
|-----------------------------|--------------------------------------------------------|
| `docs/adr/`, `docs/product/`, `docs/reference/` | Repo already has `docs/` with a different layout, or uses `adr/` at root |
| `tasks/` with NNN convention | Repo uses GitHub Issues, or a different `tasks/` shape |
| Root `CLAUDE.md`            | Repo already has a `CLAUDE.md` with real content       |
| One-session-one-PR + protected `main` | Repo merges to `develop`, or has trunk-based flow |
| `.claude/skills/`           | Repo already has `.claude/` with conflicting entries   |

## Step 3 — Raise each mismatch as an adapt-vs-refactor decision

This is the core of the skill. For **every** mismatch, do NOT pick for the maintainer.
Present it as a concrete choice with tradeoffs, in this shape:

```
### Mismatch: <short name>
Repo currently: <what the repo does>
Workflow expects: <what the workflow assumes>

Option A — Adapt the workflow to the repo
  What changes: <which workflow files get edited, e.g. paths in CLAUDE.md & skills>
  Pros: <no churn in existing repo; respects established conventions>
  Cons: <workflow diverges from its documented defaults; future updates need re-mapping>

Option B — Refactor the repo to the workflow
  What changes: <which repo files/dirs move or get created>
  Pros: <stays on documented defaults; portable across the maintainer's projects>
  Cons: <git history churn; may disrupt existing tooling/links>

Recommendation: <your reasoned lean, but the maintainer decides>
```

Wait for the maintainer's choice on each before applying it. Batch related mismatches so
the conversation doesn't drag, but never bundle a decision into a silent default.

Bias notes for your recommendations:
- Prefer **adapting the workflow** when the repo's existing convention is well-established,
  load-bearing, or shared by a team — churn there is expensive and risky.
- Prefer **refactoring the repo** when the existing state is incidental, inconsistent, or
  the maintainer values cross-project portability (a stated preference of this workflow's
  author for self-hosted, consistent setups).
- If an existing `CLAUDE.md` has real content, default to **merging** (preserve their
  rules, add the workflow's phase/PR/doc rules) rather than overwriting — and show the
  merged result for approval.

## Step 4 — Apply approved changes

Once decisions are made:

- Apply the chosen edits (to workflow files and/or repo) exactly as agreed.
- **Seed the documentation** from real code, since empty scaffolds rot: draft initial
  `docs/reference/` docs (data models, API contracts, conventions) from what you read in
  Step 1, and a starter `docs/product/` doc per major existing feature. Mark these as
  drafts for the maintainer to verify — you inferred them, you didn't confirm them.
- If no ADRs exist but obvious past decisions are visible in the code, optionally propose
  a few retroactive ADRs (status `accepted`, dated today, noted as reconstructed). Ask
  first.
- Record the bootstrap outcome itself as `docs/adr/0001-adopt-claude-workflow.md` so the
  decision to adopt (and any adaptations) is captured in the immutable chain.

## Step 4b — Generate the sandbox setup script

The EXECUTE sandbox is provisioned by `environment/setup.sh`, kept deliberately
lightweight (lint + type-check + unit tests only — no databases, services, or browsers).
Generate it from the stack you detected in Step 1:

- Start from the committed `environment/setup.sh` scaffold.
- Uncomment/fill only the sections matching the repo's real toolchain: detect the package
  manager from lockfiles (`package-lock.json`/`pnpm-lock.yaml`/`yarn.lock` →
  `npm ci`/`pnpm install --frozen-lockfile`/`yarn install --immutable`) and the Python
  tooling from `pyproject.toml`/`uv.lock`/`poetry.lock` (`uv sync --frozen` /
  `poetry install` / `pip install -e ".[dev]"`).
- Keep it **idempotent and check-before-install** (the snapshot cache rewards fast
  scripts; services it starts won't persist anyway).
- Include only build/lint-time system packages, never runtime services. If the repo's
  tests *require* a database or queue to pass, that's a finding: tell the maintainer those
  tests can't run at this tier and will be flagged for manual verification — do not bloat
  the sandbox to accommodate them.
- Add a commented sanity check that the unit-test runner is callable (not a full run).
- Show the generated script to the maintainer for approval before finalizing, and remind
  them to set it as the setup script for their Claude Code web environment.

## Step 5 — Verify the seams

Confirm the final state is coherent: every path referenced in `CLAUDE.md` and the skills
actually exists; the templates are present; `environment/setup.sh` matches the detected
stack; the doc dirs match whatever was decided. Hand back a short "what changed / what you
should verify" summary.

## What this skill must NOT do

- Do not silently overwrite an existing `CLAUDE.md`, docs, or `.claude/` content.
- Do not make adapt-vs-refactor choices on the maintainer's behalf.
- Do not run on a brand-new empty repo — there's nothing to reconcile; just use the
  workflow as-is.
