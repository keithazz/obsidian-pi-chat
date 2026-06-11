# 0001 — Adopt the Claude PLAN/EXECUTE workflow

- **Status:** accepted
- **Date:** 2026-06-11
- **Supersedes:** none
- **Superseded-by:**

> Once this ADR is `accepted`, do not edit it to change the decision. To revise, write a
> new ADR that sets `Supersedes:` to this number, and change only the `Status` line here
> to `superseded-by-MMMM`.

## Context

The repository already had an established structure (an Obsidian-plugin + pi-extension
monorepo) with real documentation and in-flight task folders, plus its own
orientation files (`README.md`, `CLAUDE.md`, `AGENTS.md`). We adopted the Claude-driven,
subscription-only **PLAN/EXECUTE** workflow (one-session-one-PR, `grill-with-docs` →
`create-task`, mutability-split `docs/`). The workflow's documented defaults conflicted
with several existing conventions, so the `bootstrap-workflow` skill was run to reconcile
them. The pre-bootstrap orientation files were preserved as `*_bkp.md` backups and their
content migrated into the new structure.

## Decision

We adopt the workflow, with these maintainer-chosen adaptations (each was an explicit
adapt-vs-refactor decision):

1. **Docs layout (refactor repo).** `docs/ADR/` (uppercase, a single monolithic
   architecture overview) → lowercase `docs/adr/` as an **append-only single-decision
   log**; the architecture overview moved to `docs/reference/architecture.md` (it is
   code-tracking reference material, not a decision record). The uppercase dir also risked
   a real bug: the Linux EXECUTE sandbox is case-sensitive, where `docs/ADR/` ≠ `docs/adr/`.
2. **Product docs (refactor repo).** `docs/PRD/` → `docs/product/` (evergreen feature
   intent). A draft `docs/reference/navigation-api.md` was seeded from the navigation code.
3. **Task naming (adapt workflow).** The repo's existing `NNN_slug` / `NN_subtask_slug.md`
   + `00_decisions.md` underscore convention is kept; the workflow's task templates and the
   `create-task` skill were edited to match (rather than churning the in-flight task
   folders 001/002).
4. **Orientation home (refactor repo).** The project orientation (package ownership,
   architectural invariants, conventions, things-not-to-do) from the old `CLAUDE.md` /
   `AGENTS.md` was merged into `docs/reference/conventions.md`; the root `CLAUDE.md` stays
   lean and links to it.
5. **Verification tier (finding).** The repo has **no unit-test runner**; `npm run build`
   (tsc + esbuild type-check) is the ceiling the sandbox can prove. `environment/setup.sh`
   installs deps (`npm ci`) and sanity-checks `tsc`. Everything touching plugin runtime
   behaviour needs Obsidian and is handed to the reviewer via `## Manual testing required`.

## Consequences

- Documentation is now split by mutability and portable to a case-sensitive sandbox.
- The architecture overview is reference (must track code); future architectural changes
  are recorded as new ADRs rather than silent rewrites. §10/§11 of `architecture.md` are
  the natural seeds for those.
- Task files keep their established underscore convention; the workflow tooling now emits
  the same shape, so no future churn or re-mapping at task-creation time.
- The no-test-runner reality is explicit everywhere (CLAUDE.md, conventions.md, setup.sh),
  so EXECUTE sessions won't over-claim verification or try to stand up a test harness.
- Branch protection on `main` is assumed by the workflow but must be configured in the Git
  host by the maintainer; it cannot be verified from the repo.

## Alternatives considered

- **Adapt the workflow to the repo's uppercase `docs/ADR/` + monolithic doc** — rejected:
  diverges from the append-only ADR model and risks the Linux case-sensitivity bug.
- **Rename the in-flight task folders to the workflow's hyphen convention** — rejected:
  churns ~20 files across two mid-execution task folders for no functional gain.
- **Keep orientation in a root `AGENTS.md`** — rejected in favour of one orientation home
  under `docs/reference/` that the lean `CLAUDE.md` links to.
