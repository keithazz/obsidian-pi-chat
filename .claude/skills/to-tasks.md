Break a feature into a structured task folder under `tasks/` — one folder per feature, one file per discrete implementation task.

## What to do

1. **Read the existing work first.**
   - Scan `tasks/` to find the next sequence number (zero-padded three digits, e.g. `002`).
   - Read the relevant `docs/PRD/` and `docs/ADR/` sections for the feature. Note §references you'll cite in task files.
   - Read `tasks/001_approval_gating/README.md` and `00_decisions.md` to absorb the conventions.

2. **Create the task folder:** `tasks/<NNN>_<kebab_slug>/`

3. **Create `README.md`** in the folder. Structure:

   ```markdown
   # <NNN> — <Feature name>

   One-paragraph description of what this work item delivers and why.
   Cite the PRD §section and ARCHITECTURE §section it implements.

   End state of this work item:
   - Bullet list of observable outcomes when all tasks are done.

   ## Decision doc
   - [00_decisions.md](./00_decisions.md) — read this first. Records all non-obvious choices.

   ## Tasks in dependency order

   | # | File | Touches | Depends on |
   |---|---|---|---|
   | 01 | [01_name.md](./01_name.md) | files/packages changed | — |
   | 02 | [02_name.md](./02_name.md) | files/packages changed | 01 |
   ...

   ## What's explicitly deferred
   List any related work that is *not* in this folder and where it's tracked.

   ## How to verify end-to-end
   Numbered smoke-test sequence exercising every task in dependency order.
   ```

4. **Create `00_decisions.md`** — an ADR-style decisions record. One section per non-obvious choice. Each decision must have:
   - A short title (`## D1 — <Decision name>`)
   - The chosen option
   - **Why:** the reasoning
   - **Implications / constraints**
   - The ARCHITECTURE §section it resolves (if applicable)
   End with a `## Deferred` section listing anything explicitly punted to a later work item.

5. **Create one numbered task file per discrete implementation unit.** Each file (`01_name.md`, `02_name.md`, …) follows this structure:

   ```markdown
   # <NN> — <Task name>

   > One-line role: why this task exists in context of the work item.

   ## Why
   The specific gap or breakage this task addresses.
   Cite file:line references where relevant (e.g. `packages/plugin/src/main.ts:216`).
   Cite ARCHITECTURE §sections.

   ## What to do
   Concrete, ordered steps. Each step names the file(s) to touch and the change to make.
   Include code snippets where the shape of the change is non-obvious.

   ## Acceptance
   How to verify this task is complete — ideally a manual smoke test or a build command.

   ## Files touched
   Bullet list of files this task modifies.

   ## Out of scope
   What this task deliberately does not do (and where that work lives).

   ## Depends on
   Task numbers this must follow.

   ## Notes
   Any implementation warnings, timing constraints, or forward-compatibility considerations.
   ```

   Split tasks so that each one is independently reviewable and leaves the codebase in a working state after it lands. Annotate the dependency graph in `README.md`'s table.

6. **Do not write any code.** Task files are specifications, not implementations.

## Input

$ARGUMENTS
