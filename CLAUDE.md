# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Read AGENTS.md first** — it contains the full orientation, architectural invariants, ownership table, and a list of things you must not do. This file adds Claude-specific notes and quick-reference commands.

## Commands

```sh
npm install              # after fresh clone or workspace changes
npm run build            # full build (tsc for shared, esbuild for plugin)
npm run dev              # parallel watchers: shared (tsc --watch) + plugin (esbuild --watch)
npm run link-dev-vault   # create dev-vault/ symlinks; safe to re-run
```

There are no automated tests. `npm run build` is the closest equivalent — it fails on type errors in both packages.

## Architecture overview

The system is a monorepo of three co-versioned packages that must always be kept in sync:

```
packages/shared/src/rpc.ts        ← shared type definitions (AutonomyMode, RPC message types)
packages/agency/extensions/agency-control.ts   ← pi extension (runs inside pi process)
packages/plugin/src/main.ts       ← Obsidian plugin (UI shell, pi lifecycle, JSONL transport)
```

**Runtime topology:** The plugin (`main.ts`) spawns `pi --mode rpc --extension agency-control.ts` as a child process. All communication between plugin and pi is newline-delimited JSON over stdin/stdout (JSONL). The extension runs inside the pi process and communicates back to the plugin by calling `ctx.ui.notify(...)` with messages that carry an `AGENCY::` sentinel prefix.

**Two-layer RPC:**
1. Pi's native protocol (JSONL `type: "prompt"`, `type: "extension_ui_request"`, `type: "response"`, etc.)
2. The custom agency vocabulary (`packages/shared/src/rpc.ts`) that rides on top — `notify` messages from the extension use `AGENCY::<kind>::<json>` encoding; plugin→extension commands are pi slash commands prefixed with `/agency-`.

**Proposal flow (step-by-step mode):** When pi calls `edit`/`write`, the extension intercepts via `tool_call`, builds a before/after diff, emits a `proposal` sentinel via `notify`, then opens a `ctx.ui.editor` dialog. The plugin receives the sentinel first (stashing the proposal), then receives the editor request which references the stash by id. The user sees a `ProposalView` (CodeMirror `MergeView`); their response is sent back via `extension_ui_response`.

**Autonomy modes** (`step-by-step` | `per-lesson` | `autonomous`) live in `agency-control.ts` and determine which tool classes are auto-allowed vs. gated. Mode state is session-scoped and non-persistent (resets to `step-by-step` on each `session_start`). The plugin persists the user's *default* mode across sessions via Obsidian's `loadData`/`saveData`.

**Key invariant:** The extension proposes; the plugin writes. The extension never calls Obsidian's vault API. The plugin is the only code that touches vault files on the Obsidian path.

## What is and isn't implemented

| Surface | State |
|---|---|
| Chat view, streaming, tool-call traces, JSONL transport | Working |
| Approval gating (diff view, confirm/reject) | Working |
| `ask_user` tool, select/input cards | Working |
| Autonomy mode switcher (UI + extension) | Working |
| Session edit log + post-hoc diff view | Working |
| `agency-control` extension | **Mostly complete** (see file for stubs) |
| Default skills | **None** — `packages/agency/skills/` is empty |
| History sidebar, settings UI, `agency-revert` | Not implemented |

## Skills

Three reusable skills live in `.claude/skills/`. Read them before doing the work they describe:

| Skill | When to use |
|---|---|
| [`grill-with-docs`](.claude/skills/grill-with-docs.md) | Before writing any PRD or task breakdown — interrogates a feature idea and scaffolds missing `docs/` stubs |
| [`to-prd`](.claude/skills/to-prd.md) | Converting resolved requirements into a `docs/PRD/<NN>-<slug>.md` document |
| [`to-tasks`](.claude/skills/to-tasks.md) | Breaking a specified feature into a `tasks/<NNN>_<slug>/` folder with `README.md`, `00_decisions.md`, and numbered task files |

## Conventions

- Cross-package imports use workspace names: `import { AutonomyMode } from "@educator-agency/shared"`. Never use relative paths between packages.
- Any new RPC message kind goes in `packages/shared/src/rpc.ts` first; update both consumers in the same commit.
- Cite architecture section numbers in commit messages when implementing a specified behaviour (e.g. `ARCHITECTURE §4.1`).
- The plugin manifest `id` is `pi-chat-poc`. Renaming requires re-running `npm run link-dev-vault`.
- Plugin changes can only be verified by opening `dev-vault/` in Obsidian. Never claim a plugin-behaviour change works without UI verification.
