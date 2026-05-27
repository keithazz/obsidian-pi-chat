Convert the given feature description or notes into a properly structured PRD document and save it to `docs/PRD/`.

## What to do

1. **Read existing PRDs first.** Scan `docs/PRD/` to find the next sequence number and to absorb the writing style. Read `docs/PRD/01-basic-requirements.md` fully — new PRDs must be consistent with the vision, target users, and non-goals stated there.

2. **Read the ADR.** Skim `docs/ADR/01-basic-architecture.md` for architectural constraints the new PRD must respect. Note any section numbers you'll need to cite or reference.

3. **Determine the filename.** Use `docs/PRD/<NN>-<kebab-slug>.md` where `<NN>` is zero-padded to two digits and follows the last existing file.

4. **Write the PRD.** Follow this structure (omit sections that genuinely don't apply):

   ```
   # PRD — <Feature Name>

   > One-sentence context: what product area this belongs to, and a pointer to the parent PRD section if relevant.

   ## 1. Problem / motivation
   Why does this need to exist? What breaks or degrades without it?

   ## 2. Target users
   Which of the two audiences (educator / developer-researcher) does this primarily serve? What specific workflow does it address?

   ## 3. Requirements
   ### 3.N <Requirement name>
   Numbered, named requirements. Each requirement states *what* the system must do, not *how*. Reference ARCHITECTURE §sections where constraints apply.

   ## 4. Non-goals
   What this feature explicitly will not do. Be specific enough to prevent scope creep.

   ## 5. Open product questions
   Numbered list of decisions that still need to be made. These become inputs to the ADR and task breakdown.
   ```

5. **Cross-reference.** If the feature requires new architecture decisions, add a note at the end pointing to the relevant `docs/ADR/` file (create a stub with `> TODO` if it doesn't exist yet).

6. **Create `docs/PRD/` if it doesn't exist.**

Write the file. Do not create tasks or make code changes.

## Input

$ARGUMENTS
