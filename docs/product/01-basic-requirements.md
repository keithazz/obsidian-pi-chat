# PRD — Educator Agency

> A multi-agent co-creation tool for educators, built on Obsidian and the [pi](https://github.com/earendil-works/pi) coding agent runtime.

## 1. Vision

Educators producing self-directed learning content spend disproportionate effort on **conversion and packaging** — turning a lesson concept into slides, handouts, narrated videos. The intellectual work is in the design; the production is mechanical but slow.

Educator Agency is a co-creation tool: educators work in their existing markdown-based notes (Obsidian), and a multi-skill AI agency collaborates with them inside that environment to design, draft, refine, and produce educational content. The substance of the work — outlines, lesson plans, research notes, pedagogical voice — lives in markdown. Multimedia artifacts (slide decks, documents, narrated videos) are produced as a final touch once the markdown content is settled.

Every change a skill proposes can pass through a diff-style approval gate, configurable by the educator from step-by-step review through to autonomous batch production. Every accepted change is committed to history with skill provenance. Nothing happens behind the educator's back.

The conceptual lineage is Cursor IDE applied to educational content design rather than code — and is delivered, in part, by literally using a coding agent (pi) as the runtime.

## 2. Target users

Two distinct audiences, served by two distinct deliverables from the same agency definition.

**Primary: educators (Obsidian plugin users).** Working educators — university lecturers, instructional designers, online course authors — who already use Obsidian or markdown-based notes. They are domain experts, comfortable with markdown, not necessarily comfortable with terminals or git internals. The Obsidian plugin is built for them.

**Secondary: developers and researchers (CLI users).** AI researchers, instructional-design technologists, and developers who want to extend the agency, build custom skills, or run the agents headlessly. They use pi directly with the same extension and skills the plugin spawns. The CLI path exists to keep the architecture honest and to enable researcher workflows; it is not the path through which non-technical educators are expected to engage.

Importantly, the *agency definition itself* is shared by both audiences and lives inside the user's vault, so a developer's customisations can be packaged and shared with educator colleagues.

## 3. Requirements

### 3.1 Markdown-first co-creation, not autocompletion

The skills must be designed for **multi-turn collaborative authoring** in markdown, not single-shot generation. The educator gives intent; specialised skills propose structure, content, and refinements; the educator reviews, edits, accepts, or rejects with feedback; the skills iterate. The expected unit of interaction is "design a unit of teaching material", not "generate a paragraph". Multimedia generation comes after the markdown is settled — never before, and never instead.

### 3.2 Configurable autonomy with diff-gated approval

The system must support a spectrum of autonomy levels, configurable by the educator at any point during a session. At minimum:

- **Step-by-step**: every proposed write reviewed and approved before the next action.
- **Per-lesson**: skills proceed within a lesson without per-write gating, but pause at lesson boundaries for review.
- **Autonomous**: once the course outline is approved, skills proceed through all subsequent work without intervention.

In every mode, an agent can pause itself to ask the user for input it genuinely needs to proceed (an ambiguity in scope, a missing pedagogical preference, etc.). Such pauses are independent of the autonomy mode — they're agent-initiated, not gate-initiated.

In every mode, all accepted writes are recorded with provenance and are reversible. In autonomous modes especially, the educator must be able to inspect what was produced after the fact and revert any change.

### 3.3 Multi-skill specialised collaboration

The agency must decompose work across **specialised skills** — at minimum a course designer, a research aggregator, a lesson planner, and a slides/multimedia producer — coordinated by an orchestrator. The educator (or a developer) can add, remove, or reconfigure skills.

This decomposition is what makes the agency meaningfully better than a single general-purpose chat: each skill has a focused job, focused instructions, and focused tool access, which produces consistently better output than a single agent juggling all concerns.

### 3.4 Multimedia artifact generation

The agency must be able to produce, as final-touch artifacts from settled markdown content:

- **DOCX** documents (lesson handouts, lecture notes, assessment briefs)
- **PPTX** slide decks (for in-person lectures)
- **Avatar narration videos** via [Synthesia](https://www.synthesia.io/) (for self-directed learning content)

The architecture must accommodate additional artifact types as a first-class extension point. Implementation choices for each artifact type are deferred and documented separately; the PRD's commitment is to the *capability*, not to the libraries or runtime used.

Multimedia generation is explicitly a downstream operation: it consumes finalised markdown, it does not drive content design. An educator producing a course should be able to produce a complete, useful markdown course *without ever generating multimedia*, and then add multimedia later if desired.

### 3.5 User-customisable agency, in the vault

The agency definition — skills, extensions, prompts, pedagogical guidance — must live inside the user's Obsidian vault, not inside an installed package. This enables:

- Per-vault customisation (different agency configurations for different courses or institutions).
- The agency itself being editable through the same diff/approval loop that edits content.
- Sharing of agency configurations alongside content.

The system provides a canonical default agency that users can scaffold into their vault and modify from there.

### 3.6 History as audit trail

Every accepted skill-authored change must be committed to a history that supports:

- Identifying which skill made the change.
- Identifying which conversation turn produced it.
- Reverting any skill-authored change with a single action.
- Distinguishing skill-authored from human-authored content.

History must work whether or not the user has git tooling installed; the system should not require the user to be git-literate, but should interoperate cleanly with users who maintain their vault under git for their own reasons.

The educator must be able to view recent skill-authored changes in a sidebar within Obsidian, click through to see what changed, and revert from there. The terminal user gets the same capability through the standard git history of the vault if they have git enabled.

### 3.7 Dual-mode delivery

A single agency definition (skills + extensions) must work in two modes:

- **Terminal mode**: pi runs interactively in the user's terminal with the agency-control extension loaded. Approvals and questions surface as pi's native TUI dialogs.
- **Obsidian mode**: the Obsidian plugin spawns pi in RPC mode with the same extension loaded. Approvals route to the plugin's diff view; questions route to chat-embedded question cards; notifications route to inline activity cards.

The dual-mode property is delivered by pi's runtime, not implemented by this project. The same extension code and the same skills run unchanged in both modes. This is a structural property of the architecture, not a contract that has to be re-verified for each new skill.

### 3.8 Local-first

All vault data stays on the user's machine. The only network egress is to the LLM provider (Anthropic, OpenAI, or another configured via pi's multi-provider support) and to any explicitly opted-in third-party multimedia services (Synthesia for avatar videos). The educator's content is never sent to any server operated by this project.

### 3.9 Transparency and observability

The educator must always be able to see:

- Which skill is currently active.
- What tool is being called and with what arguments.
- What changes are about to be proposed (in ask mode) or have just been made (in auto modes).
- What is recorded in the change history and by which skill.

Skill activity and tool calls are narrated in the chat interface as they happen.

## 4. Design principles

These constrain how features are built rather than describing user-facing behaviour.

**Skills are mode-agnostic; the orchestrator is mode-aware.** Worker skills (course designer, lesson planner, etc.) must not contain references to "the chat sidebar", "the terminal", or assumptions about whether their writes will be approved. They do their job and assume any proposed write may be rejected with feedback. The orchestrator skill is the only skill that knows about autonomy mode, and uses that knowledge to decide where to pause for human input.

**Rejection is a first-class outcome.** Even though some autonomy modes never produce rejections, all skills are written assuming they might. This prevents prompt drift between modes and means autonomous mode is structurally safe to introduce.

**Markdown is the canonical medium.** Skills produce and edit markdown. The vault is markdown. Conversations are markdown. Multimedia artifacts are downstream conversions, not sources of truth. An educator who never wants slides or videos still benefits from the full agency.

**The vault is the source of truth.** No staging directories, no shadow folders. The vault holds the canonical content; pending proposals exist only as in-memory state in the plugin until accepted.

**The plugin owns vault writes in Obsidian mode.** Writes go through Obsidian's vault API so the editor's in-memory state and the disk stay consistent. The extension proposes; the plugin writes.

**The bridge is not a separate component.** What earlier drafts called "the bridge" is just pi running in RPC mode with the agency-control extension loaded. There is no second process or codebase to maintain.

**Trust through transparency, not sandboxing.** The agency is code that runs on the user's machine with the user's privileges. Installing an agency is equivalent to installing a software package — users opt in explicitly. We surface what the agency contains before first run rather than attempting to sandbox.

## 5. Non-goals

- **Cloud-hosted version.** No SaaS, no hosted instance, no team collaboration server.
- **Real-time multi-user editing.** One educator per vault. Simultaneous edits across users are out of scope.
- **Replacing the educator's judgement.** The system is a co-author, not an autonomous publisher. Nothing ships without explicit acceptance, even in autonomous mode (autonomous still means the educator reviews afterward; it does not mean the educator never sees the output).
- **General-purpose Obsidian AI assistant.** Tools like Smart Composer already do this well. This project is specifically for educational content co-creation.
- **Code editing.** The agency is for prose, instructional content, and educational multimedia. Code agents (Claude Code, Cursor, pi itself when used as a coding agent) are out of scope and complementary.
- **General-purpose multimedia toolkit.** The system generates educational artifacts of specific types (DOCX, PPTX, Synthesia avatars). It is not a Pandoc replacement.
- **Sandboxing the agency.** The agency runs as a normal process with full disk and network access. Users opt in by installing.
- **Windows as Tier 1.** Windows is Tier 2 — best effort, tested when possible, but macOS and Linux are the primary platforms.

## 6. Constraints and assumptions

- The educator has an LLM API key (Anthropic, OpenAI, or any provider supported by pi) and is comfortable configuring it.
- The educator has Node.js (the minimum version required by pi) on their system, or is willing to install it.
- The educator's vault is on a local filesystem (not synced through a real-time collaboration backend).
- The Obsidian community plugin submission process is the primary distribution path for the plugin.
- pi's package distribution mechanism (or a degittable repository) is the primary distribution path for the agency definition.

## 7. Success criteria

A v1.0 release is successful if:

1. A working educator can install the Obsidian plugin from the community plugins directory, configure an API key, scaffold the default agency into a vault, and produce a complete lesson plan in markdown within 15 minutes.
2. The same educator can subsequently produce a slide deck, a handout, or a Synthesia video from that lesson plan with one further request.
3. A developer can install pi and the agency, run the agency in their terminal against a sample vault, and reproduce the educator's workflow within 5 minutes of setup.
4. A developer can add a new skill (e.g. a quiz generator) by writing a markdown skill file, dropping it into their vault's agency directory, and having the orchestrator route to it — without modifying any other code.
5. A user can review the change history and clearly identify which content was authored by which skill versus by themselves.
6. The trust model is documented prominently enough that no user is surprised by what the agency can do on their machine.

## 8. Open product questions

These are deferred decisions worth flagging:

- **Onboarding flow for non-developer educators.** The plan assumes plugin settings + a setup wizard suffice; the experience of getting a first conversation working may need more scaffolding once tested with real educators.
- **Agency sharing mechanism.** Section 3.5 enables sharing, but the UX (export agency, import agency, browse community agencies) is undefined.
- **Cost visibility.** Educators using premium LLM models will care about cost. Whether and how the plugin surfaces a running cost estimate is undecided. Pi exposes session-level token usage; the question is how to translate that into something meaningful for a non-developer audience.
- **Failure recovery UX.** When an agent fails mid-multimedia-export (Synthesia rate limit, model timeout, etc.), the recovery experience for non-technical users is undefined.
- **Autonomy mode defaults per session vs persistent.** Whether autonomy mode resets per session, persists per vault, or is configurable per skill is undecided. Likely starts as per-session and is reconsidered after observing real use.
