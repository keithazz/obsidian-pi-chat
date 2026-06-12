# ARCHITECTURE — Educator Agency

> Detailed technical architecture for the system described in [product/01-basic-requirements.md](../product/01-basic-requirements.md). Intended for contributors and integrators.
>
> **Reference doc — must track the code.** This describes the *target* architecture and current shape of the system. Architectural *decisions* (and changes to them) are recorded as append-only ADRs under [`docs/adr/`](../adr/); when a decision here changes, add an ADR rather than rewriting history silently. The §10 accepted tradeoffs and §11 open questions below are the natural seeds for future ADRs.

## 1. Overview

Educator Agency is an agency built on top of [pi](https://github.com/earendil-works/pi), the coding agent runtime by Earendil Works. Pi provides the agent loop, tool execution, LLM connectivity, session persistence, skill loading, and a versioned RPC protocol that makes the agency embeddable into other applications.

The project consists of three layers above pi:

- **A pi extension** (`agency-control`) — intercepts tool calls to enforce configurable approval policy, records history, surfaces post-hoc edit notifications, and routes agent-initiated questions.
- **An agency definition** — a collection of pi skills (orchestrator, course designer, deep researcher, lesson planner, multimedia producer) plus shared prompts, living in the user's vault.
- **An Obsidian plugin** — spawns pi in RPC mode, renders streaming events into a chat sidebar, hosts a diff view for proposal review, surfaces a change history sidebar, and writes accepted changes back to the vault.

Pi runs in two modes — interactive TUI for terminal use, and RPC over stdin/stdout for the plugin. The same extension and skills serve both modes unchanged; pi's runtime handles the routing of approval dialogs and notifications to the appropriate user interface.

The architecture has no separate "bridge" process. What the project would otherwise have had to build as a custom WebSocket protocol, supervisor, and orchestration layer is delivered by pi.

## 2. System topology

```
┌─────────────────────┐         ┌──────────────────────┐
│ Terminal user       │         │ Obsidian plugin      │
│ (pi's native TUI)   │         │ (TypeScript)         │
└──────────┬──────────┘         └──────────┬───────────┘
           │                                │
           │ stdin/stdout                   │ spawn() + JSONL stdio
           │ (interactive mode)             │ (--rpc mode)
           ▼                                ▼
       ┌────────────────────────────────────────┐
       │              pi runtime                │
       │  ─ agent loop                          │
       │  ─ built-in tools (read, write, edit,  │
       │    bash, find, grep, ls, ...)          │
       │  ─ LLM provider (pi-ai, multi-vendor)  │
       │  ─ session persistence (JSONL tree)    │
       │  ─ skills loader                       │
       │  ─ extension hooks                     │
       │  ─ ctx.ui sub-protocol (TUI ↔ RPC)     │
       └────────────────────┬───────────────────┘
                            │
                            │ extension API
                            ▼
       ┌────────────────────────────────────────┐
       │       agency-control extension         │
       │  ─ tool_call gating per autonomy mode  │
       │  ─ ask_user wiring (via ctx.ui.select) │
       │  ─ post-execution edit notifications   │
       │  ─ history recording (per accepted op) │
       │  ─ external-service gates (Synthesia)  │
       └────────────────────┬───────────────────┘
                            │
                            ▼
       ┌────────────────────────────────────────┐
       │     vault/agency/                      │
       │  ├── skills/                           │
       │  │     ├── orchestrator/SKILL.md       │
       │  │     ├── course-designer/SKILL.md    │
       │  │     ├── deep-researcher/SKILL.md    │
       │  │     ├── lesson-planner/SKILL.md     │
       │  │     └── multimedia-producer/SKILL.md│
       │  ├── extensions/                       │
       │  │     └── agency-control.ts           │
       │  ├── PEDAGOGY.md                       │
       │  └── style.css                         │
       └────────────────────────────────────────┘
```

In terminal mode the educator types directly into pi's prompt; pi's native dialogs surface approvals. In Obsidian mode the plugin sits between the educator and pi, translating between JSONL RPC events and the plugin's UI.

## 3. Components

### 3.1 Pi runtime

Pi is the foundation. Its relevant properties for this architecture:

- **Two execution modes** — interactive TUI and `--rpc`. The extension and skills are mode-blind; pi's `ctx.ui` sub-protocol bridges between TUI dialogs and JSONL `extension_ui_request` / `extension_ui_response` messages on stdio.
- **Built-in tools** — `read`, `write`, `edit`, `bash`, `find`, `grep`, `ls`. These cover the full file-operation surface this project needs. The extension intercepts these via the `tool_call` hook to enforce policy; it does not replace them.
- **Skills** — markdown files with frontmatter, loaded from configurable paths, activated by description matching. Skills are the agency's "agents".
- **Extensions** — TypeScript modules with access to event hooks (`tool_call`, `session_start`, etc.) and to a programmatic `ctx` for UI and registered-tool calls. Extensions can intercept, modify, or block tool calls.
- **Session persistence** — JSONL files at `~/.pi/agent/sessions/`, indexed by working directory. Branching is built in (`/tree`, `--fork`). This is the project's conversation persistence; no separate implementation is needed.
- **Multi-provider LLM access** — Anthropic, OpenAI, Google, and others, via pi's auth mechanism (`/login`) or environment variables. Educators choose their provider; the agency does not care.
- **Trust model is explicitly extension-defined** — pi has no permission popups. The agency-control extension *is* the project's trust model implementation.

### 3.2 The agency-control extension

A single TypeScript extension hosting all policy and runtime logic that is specific to this project. Its responsibilities:

- **Approval gating.** On every `tool_call`, classify the tool by risk (read-only, edit, create, destructive, external service) and consult the current autonomy mode to decide whether to allow, ask, or auto-allow-and-notify. Ask paths use `ctx.ui.confirm()` (which becomes a TUI dialog or an `extension_ui_request{method:"confirm"}` depending on pi's mode).
- **Mode state.** Holds the current autonomy mode. In Obsidian mode the plugin pushes mode changes via a custom RPC message; in terminal mode the user changes mode via a slash command registered by the extension. Mode is session-scoped, not persistent.
- **Agent-initiated questions.** Exposes an `ask_user` tool the agent can call when it needs human input that isn't a write approval. Maps to `ctx.ui.select()` or `ctx.ui.input()`. Available in all modes, including autonomous.
- **Post-execution notifications.** In auto-permitting modes, after a write completes the extension records the change to history and (in Obsidian mode) emits an `edit_made` notification via `ctx.ui.notify()`.
- **History recording.** Each accepted write produces a history entry: before/after snapshots, originating skill name, timestamp, turn ID. The extension owns the history backend (see §6).
- **External-service gates.** Skills that call Synthesia (or any future external paid service) go through a separate gate that respects a per-service autonomy axis. Money is treated as a different risk class from filesystem changes.

The extension is the only project-authored runtime code that runs inside pi. Everything else is markdown (skills, prompts) or external code (the Obsidian plugin in its own Electron context).

### 3.3 Skills — the agency definition

Markdown files under `vault/agency/skills/`, loaded by pi. Each skill is one specialised agent. The intended set for v1:

- **`orchestrator`** — the only mode-aware skill. Routes user requests to specialists, manages workflow checkpoints (when to pause for review), decides when to recurse on lessons vs course-level work.
- **`course-designer`** — co-creates the course-level outline (course title, learning objectives, lesson list).
- **`deep-researcher`** — produces grounded research notes for a lesson, citing academic and primary sources.
- **`lesson-planner`** — synthesises research and pedagogy into a lecturer-facing lesson plan.
- **`multimedia-producer`** — converts settled markdown content into the final-touch artifacts (DOCX, PPTX, Synthesia). Implementation of each artifact type is deferred to a separate design document; the orchestrator and other skills are agnostic to which library or runtime is used downstream.

All skills except the orchestrator are mode-agnostic. They produce content; they propose writes; they assume rejection is possible and they handle feedback constructively. They do not know whether they are running in terminal mode or under Obsidian.

The orchestrator's prompt reads the current autonomy mode from session context and decides where to pause for human input. This is the one piece of skill logic that varies by mode — and it varies by *workflow* mode (where to pause), not by *UI* mode (terminal vs Obsidian).

### 3.4 Obsidian plugin

A TypeScript Obsidian community plugin. Its responsibilities:

- **Pi lifecycle.** Spawn `pi --rpc --extension <vault>/agency/extensions/agency-control.ts` with cwd set to the vault root. Capture stdout (JSONL events) and stderr (diagnostics). Restart with exponential backoff on crash. Kill on plugin unload. Surface stderr to a log file with a "Show server logs" command.
- **JSONL transport.** Read and write LF-delimited JSONL from pi's stdio. Strict on splitting (LF only, never Unicode separators). Schema validation on inbound messages.
- **Chat interface.** A right-panel `ItemView` rendering: streaming `text_delta` events; consecutive `thinking_start/delta/end` and `toolcall_start/delta/end` trace events grouped into a single collapsible **working block** per contiguous run (spinner + live current-step header while streaming → "Worked · N steps" summary-count when sealed, expanding to reveal nested per-step collapsibles); proposal cards (incoming `extension_ui_request{method:"confirm"}`); question cards (incoming `extension_ui_request{method:"select"|"input"}`); and post-hoc `edit_made` activity cards (incoming `extension_ui_request{method:"notify"}` with structured content). Activity cards use the accent palette and are visually distinct from working blocks (secondary palette); they also act as run boundaries — a trace run following an activity card opens a new working block. Working-block runs are also sealed by assistant narration text, proposal/question cards, or turn end.
- **Diff view.** A main-area `ItemView` hosting a CodeMirror 6 `MergeView`, side-by-side with `@codemirror/lang-markdown`. The right side is editable, supporting "accept with edits" — the educator can amend a proposal before approving.
- **Vault writes.** On approval, the plugin executes the actual write via Obsidian's `vault.modify` or `vault.create` API. The extension does not write to disk in Obsidian mode; the plugin does. This keeps Obsidian's editor state authoritative.
- **History sidebar.** A list view of recent skill-authored changes, with click-to-diff (re-opens the merge view in read-only mode) and click-to-revert (restores from the history backend).
- **Settings.** API keys, default agency directory, autonomy-mode defaults, model selection.
- **Autonomy mode switcher.** A toolbar control and keyboard shortcut. Sends a custom RPC message to update the extension's mode. Next tool call observes the new mode.
- **Onboarding.** First-run flow: check pi is installed (prompt to install if not), scaffold the default agency into `vault/agency/`, configure provider credentials.

The plugin is the larger half of the codebase. It contains no skill logic, no LLM logic, and no policy logic — it is purely a UI shell that renders pi's events and produces pi's expected responses.

### 3.5 Multimedia generation

The agency produces three types of final-touch artifacts from settled markdown content:

- **DOCX** — Word documents.
- **PPTX** — PowerPoint slide decks.
- **Avatar videos** — narrated video presentations via Synthesia.

Implementation details for each artifact type are deferred to a separate design document and are not constrained by this architecture. The `multimedia-producer` skill is the integration point; whatever tools and libraries it uses to produce artifacts live behind that skill's tool surface and are transparent to the rest of the system.

The orchestrator never invokes multimedia generation as part of the standard content-design workflow. Multimedia is requested explicitly by the educator once markdown content is settled. An educator producing only markdown — never touching multimedia — uses the full agency.

External multimedia services (Synthesia, future avatar / audio / video services) flow through the extension's external-service gate (§3.2). The default policy is "always ask before calling," because such calls cost money or consume per-account quotas regardless of autonomy mode.

## 4. The approval mechanism

The architectural seam is pi's `tool_call` event hook. When the extension intercepts a write-class tool call and decides it requires approval, it calls `ctx.ui.confirm()` (or `ctx.ui.select()` / `ctx.ui.input()` for richer interactions). Pi's runtime then:

- **In terminal mode:** renders a TUI dialog and blocks the tool call until the user responds.
- **In RPC mode:** emits an `extension_ui_request` JSONL event on stdout, blocks the tool call, and waits for an `extension_ui_response` on stdin with the matching `id`.

Either way, the extension's `confirm` call resolves with the user's response. If `false` (or `cancelled:true` in RPC), the extension returns `{ block: true, reason: "..." }` from the `tool_call` hook, and the agent receives a tool result of "rejected with feedback." If `true`, the extension allows the tool through.

This single mechanism handles all three approval-flow concerns from earlier drafts of this architecture:

- **Write gating** — the `confirm` method.
- **Agent-initiated questions** (`ask_user`) — the `select` and `input` methods.
- **Post-hoc notifications** in auto modes — the `notify` method, which is fire-and-forget and does not block the tool.

There is no custom WebSocket protocol to design or maintain. Pi documents this sub-protocol; the project's contribution is the Obsidian plugin's UI on top of it and a small custom RPC vocabulary for things pi does not natively model (autonomy-mode updates, revert requests, the structured "edit_made" payload).

### 4.1 Project-specific RPC additions

A small RPC vocabulary layered on top of pi's protocol:

- **Plugin → extension:**
  - `set_autonomy_mode { mode, pathOverrides, externalApis }` — replicates the plugin's autonomy state to the extension.
  - `revert_request { editId }` — user clicked Revert on a history entry.
- **Extension → plugin:**
  - `edit_made { editId, turnId, skill, operation, path, summary, beforeRef, afterRef }` — auto-mode notification emitted via `ctx.ui.notify()`.
  - `mode_acknowledged { mode, effectiveAt }` — extension echoes the applied mode.

These ride on pi's existing message stream as `notify`-style payloads with a project-specific `kind` field; they do not require a separate transport.

## 5. Autonomy modes

The agency supports a configurable autonomy spectrum, applied independently along two axes: workflow checkpoints (where the orchestrator pauses) and per-tool gating (what individual writes require approval).

### 5.1 The named modes (v1)

| Mode | Workflow checkpoints | Per-write gating | External services |
|---|---|---|---|
| **Step-by-step** | Every artifact | Every write | Always ask |
| **Per-lesson** | At lesson boundaries | Auto-edit within a lesson; ask on delete/rename | Always ask |
| **Autonomous** | None below course level | Auto-edit; ask on destructive | Always ask |

The set of named modes is expected to evolve. The named modes are bundles over a small policy DSL stored as JSON or TOML in `vault/agency/modes/`; users can define new modes by composing the underlying axes (checkpoint set, path patterns, tool-class allow/ask/deny, external-service policy). User-defined modes appear in the mode switcher alongside built-ins.

### 5.2 Where mode logic lives

- **Per-write gating** lives in the agency-control extension. The extension's `tool_call` hook is the only place this logic exists.
- **Workflow checkpoints** live in the orchestrator skill's prompt. The orchestrator reads `autonomy.checkpoints` from session context and decides whether to hand control back to the user after each artifact.
- **External-service gating** lives in the extension, on a separate axis from filesystem gating, because the risk class is different (money vs state mutation).

This separation is deliberate. The extension is mechanical (intercept, gate, notify, record). The orchestrator is intentional (decide when to pause for human judgement). Mixing them would force the extension to understand domain workflow, which it should not.

### 5.3 Mid-session mode changes

A mode change via the plugin's UI sends `set_autonomy_mode` to the extension. The next tool call observes the new mode. The current tool call (if one is mid-flight awaiting approval) is unaffected. This is the simplest semantics and matches familiar coding-agent behaviour.

### 5.4 Agent-initiated questions are mode-independent

The `ask_user` tool surfaces the agent's own questions to the educator. It works the same in every mode — autonomous mode does not suppress agent questions, because that would make autonomous mode brittle (agents would have to guess when they should ask, producing wrong outputs).

## 6. State ownership

| State | Owner | Notes |
|---|---|---|
| Conversation history | Pi session (JSONL) | Auto-saved; survives pi restart |
| Vault content | Filesystem | Single source of truth |
| Pending proposals | Extension (in-flight) → plugin (post-emit) | Buffered briefly; resolved by `extension_ui_response` |
| Agent state mid-turn | Pi runtime | Ephemeral |
| Agency definition | Vault (`agency/`) | Editable; under the user's history backend |
| Autonomy mode | Plugin (authoritative) / extension (replicated) | Plugin pushes on change; bridge copy is non-persistent |
| API keys, settings | Pi auth file + plugin settings | Pi settings precedence documented in install docs |
| RPC connection state | Plugin and pi (ephemeral) | Re-established on reconnect |
| Change history | History backend (see §8) | Survives pi/plugin restart |

The statelessness of pi's RPC across restarts is what makes the supervisor pattern safe: nothing valuable is lost on crash; the plugin restarts pi and replays the last user message if necessary.

## 7. Distribution

Two artifacts ship separately:

- **The agency** — skills, the agency-control extension, default `PEDAGOGY.md` and `style.css` templates, and example mode files. Distributed as a pi package (via pi's package mechanism) or as a degittable repository. Self-contained; vault-installable.
- **The Obsidian plugin** — the UI shell. Submitted to the Obsidian community plugin registry. Installed via Obsidian's plugin browser.

A third dependency is pi itself, installed independently per pi's documentation. The plugin's onboarding flow checks for pi's presence and offers an install link if missing.

Multimedia tools required by the `multimedia-producer` skill (whatever they end up being) are described in their own design document and may be bundled with the agency, installed as part of the plugin's onboarding, or installed separately. From this architecture's perspective they are an implementation detail of one skill.

API key management uses pi's standard mechanisms: `pi auth login` (via `/login` slash command in interactive mode), environment variables, or pi's auth file. The plugin's settings panel can also write to pi's auth file. The macOS GUI environment-variable inheritance limitation is addressed by spawning pi through a login shell.

## 8. History and revert

Every accepted write produces a history entry recorded by the agency-control extension. The history backend is responsible for storing before/after snapshots, supporting traversal and per-entry revert, and surfacing data to the plugin's history sidebar.

The architecture commits to the history *capability* but defers the storage backend choice. Two viable options:

- **Embedded git via a pure-JS library** (e.g. `isomorphic-git`) — initialises a separate `.obsidian/plugins/agency/history.git` repo, commits each accepted change with the skill as author and the user as committer. Replicates the original git-based design (revert by `git revert`, log by `git log --author=`) without requiring git CLI to be installed.
- **Native git when present** — opt-in for power users who want skill-authored changes mirrored into their vault's main git repository.

Default is the embedded option for zero-dependency operation. Power users can opt into native-git mirroring via a setting.

Either way, the user-facing operations are the same: list recent changes, view diff for a change, revert a change. Implementation lives in the agency-control extension; UI lives in the Obsidian plugin's history sidebar.

In terminal mode, history is still recorded by the extension. Users with their own git setup can interact with history via standard git commands; users without get a simpler command surface exposed by the extension (e.g. a slash command for listing recent changes).

## 9. Trust model

The agency is code that runs on the user's machine with the user's privileges. We do not sandbox it.

- Installing an agency is equivalent to installing a software package — users opt in by following the install instructions.
- The agency-control extension is the trust-model surface. It is auditable, lives in the vault, and is shipped with the project rather than supplied by arbitrary third parties.
- On first load of a modified agency (e.g. user edits a skill, or pulls a community agency from an external source), the plugin computes a hash and prompts the user to confirm: "This agency has changed. Continue?"
- The trust model is documented in `INSTALL.md` and surfaced during plugin onboarding.

The decision against sandboxing is deliberate: sandboxing TypeScript that needs to invoke arbitrary CLI tools, call external APIs, and write to the vault is hard, brittle, and prevents the project's core capability. Transparency beats security theatre.

This stance is consistent with pi's own design ("No permission popups. Build your own confirmation flow with extensions inline with your environment and security requirements"), and the agency-control extension is precisely that confirmation flow.

## 10. Accepted tradeoffs

**Pi as a dependency vs building the runtime ourselves.** Pi wins because it delivers, mature and tested, what would otherwise be the largest part of this project. Cost: a meaningful upstream dependency on a young (though active) project, and a Node runtime requirement everywhere.

**Plugin-writes vs extension-writes in Obsidian mode.** Plugin wins because Obsidian's editor state must be authoritative. Cost: write failures are reported back through the RPC response rather than thrown locally; the error path is one hop longer.

**One agent with specialised skills vs peer multi-agent topology.** One-agent-many-skills wins for v1 because pi is structured that way and the project's actual workflow is sequential specialisation rather than concurrent peer agents. Cost: if future workflows genuinely need peer agents (e.g. a Critic skill that runs in parallel with a Planner), the architecture needs revisiting.

**Mode-agnostic skills always assuming rejection vs mode-aware skills.** Mode-agnostic wins to prevent prompt drift. Cost: skills in autonomous mode include rejection-handling reasoning that never fires.

**Trust-by-transparency vs sandboxing.** Transparency wins; sandboxing the agency is infeasible given its required capabilities. Cost: the trust model is fundamentally weaker than a sandbox would be, and must be documented and surfaced.

**Markdown-first vs multimedia-first.** Markdown-first wins because the substance of the work is in the design, not the production. Cost: educators who expect "type a sentence, get a deck" find the workflow slower than they hoped; the project's framing must make this explicit.

**Embedded git vs SQLite event log for history.** Embedded git wins because the conceptual model already commits to git semantics (revert, log, author/committer split). Cost: a non-trivial JS dependency, and the history-store is a separate repo from any main vault git the user maintains.

**Side-by-side diff (CM6 `MergeView`) vs inline diff (`unifiedMergeView`).** Side-by-side wins for v1 because the lifecycle is simpler and the rendering is more predictable at prose scale. Cost: takes a dedicated pane.

## 11. Open architectural questions

- **Skills routing under an orchestrator pattern.** Pi's skill activation is normally driven by content matching the user's prompt. The orchestrator-routes-to-specialists pattern requires verifying that the orchestrator skill can explicitly route to other skills within a turn, or that the orchestrator can produce intermediate prompts that activate the next skill. To be confirmed in Phase 1.
- **Concurrent writes to the same file within a turn.** The plugin probably needs a per-file lock; the exact mechanism is undecided.
- **Stale-read conflict detection.** If on-disk content has changed since the agent read it (because the user manually edited in Obsidian), the proposal is based on stale information. Plan: include a content hash in `ProposalRequest`-style payloads and let the plugin reject if stale. Undecided in detail.
- **Multi-window Obsidian.** Single-client connection is current assumption; the second window's plugin instance would get a connection error. Behaviour to be specified.
- **Plugin / pi / extension version compatibility matrix.** How far back does the extension support old plugin versions, and vice versa, is undecided. Pi's protocol versioning helps but does not cover the project-specific RPC additions.
- **History backend on vaults synced via iCloud / Dropbox.** Embedded git inside `.obsidian/plugins/agency/` should be safe but is worth testing on common sync setups before Phase 4.
- **Multimedia producer architecture.** Implementation choices for DOCX, PPTX, and Synthesia generation are deferred to a separate design pass. The architectural commitment here is only the integration point (the `multimedia-producer` skill).
