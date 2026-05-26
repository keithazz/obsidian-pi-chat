# 00 — Decisions for the approval-gating work item

> ADR-style sibling. Captures choices that the other task files cite. Not a task — no acceptance criteria. Each decision links back to the audit point it resolves.
>
> Scope of this work item: the **approval-gating** and **autonomy-mode** capabilities described in PRD §3.2 and ARCHITECTURE §3.2, §4, §5. Skills, multimedia, history persistence, and the "plugin owns vault writes" full implementation are explicitly deferred to later work items (see §Deferred at the bottom).

---

## D1 — Plugin → extension transport: slash commands via `prompt`

The plugin invokes extension behaviour by sending a `prompt` RPC command whose message is a slash command registered on the extension side.

```
plugin → pi:  {"type":"prompt","id":"rpc-1","message":"/set-autonomy-mode autonomous"}
extension:    pi.registerCommand("set-autonomy-mode", { handler: (args, ctx) => ... })
```

**Why:** Pi's RPC has no native "send arbitrary message to extension" command. Slash commands are the documented mechanism for plugin-driven extension behaviour, and per pi's `docs/rpc.md` they run immediately even while the agent is streaming (and do not trigger an LLM call). This avoids inventing a new transport.

**Implications:**
- Every plugin → extension control message becomes a registered command. The shared package owns the canonical name list.
- Extension-command names must not collide with built-in pi commands or with any prompt-template or skill commands the user installs. We use the prefix `agency-` (e.g. `/agency-set-mode`, `/agency-revert`) to make collisions unlikely and to make extension-authored commands grep-able.
- Resolves audit B-5 (plugin → extension direction).

## D2 — Extension → plugin transport: sentinel-encoded `ctx.ui.notify`

Structured payloads the extension wants to push to the plugin (post-execution `edit_made`, `mode_acknowledged`, and the staged-proposal payload from D7) are JSON-encoded inside the `message` field of `ctx.ui.notify()`, prefixed with a sentinel:

```
ctx.ui.notify("AGENCY::edit_made::{\"editId\":\"...\",\"path\":\"...\"}", "info")
```

Plugin code checks `if (message.startsWith("AGENCY::"))`, splits `AGENCY::<kind>::<json>`, dispatches by kind. Non-sentinel notifications are rendered as normal info/warning/error toasts.

**Why:** `ctx.ui.notify` is the only structured stdout channel pi gives extensions outside the dialog protocol. It is fire-and-forget (no response expected), which matches the semantics of these payloads. Resolves audit B-5 (extension → plugin direction).

**Constraints:**
- Encoder/decoder lives in `packages/shared/src/rpc.ts`. Both consumers import from `@educator-agency/shared`. No ad-hoc string-building in either codebase.
- Payload size is bounded by terminal/RPC line buffer realism — keep individual notifications small. Large diffs go via D7 (staged content + ref).

## D3 — Phase-1 stance on built-in `write`/`edit` vs "plugin owns vault writes"

For this work item, **the built-in `write`/`edit` tools write directly to the filesystem** after the extension's gate passes. Obsidian's file-watcher will reload affected editors.

This is a deliberate, acknowledged violation of ARCHITECTURE §3.4 ("The plugin owns vault writes in Obsidian mode"). The reason is pragmatic: pi's `tool_call` hook can only block or allow — it cannot "block-but-feed-a-synthetic-success." Honouring §3.4 properly requires replacing the built-ins with custom proxy tools that call back into the plugin, plus a plugin → extension write-applied acknowledgement. That work is real and substantial.

**A follow-on work item (`tasks/002_plugin_owned_writes/`) is reserved for this.** Until then:
- `00_decisions.md` in `002_*` will pick up from this point.
- The history sidebar (also future work) must not assume the extension produced the "after" content directly — `edit_made` payloads in this work item record file paths and operation kind, not content snapshots. Snapshot-based history is the natural feature to ship together with proxy-tool writes.

Resolves audit B-7 for Phase 1; defers the principled fix.

## D4 — `ask_user` is a registered tool

Implemented as `pi.registerTool({ name: "ask_user", … })`. Its `execute` function calls `ctx.ui.select` or `ctx.ui.input` depending on whether the call passed `options`. The tool returns the user's response as text in `content`.

Schema (using `typebox` per pi convention):
```ts
parameters: Type.Object({
  question: Type.String(),
  options: Type.Optional(Type.Array(Type.String())),
})
```

**Why:** Both ARCHITECTURE §3.2 ("ask_user tool the agent can call") and §4 ("Agent-initiated questions … select and input methods") describe this. A custom tool is the natural representation — it shows up in the agent's tool list, has a typed schema, and routes through `ctx.ui` the same way confirmations do. Resolves audit B-8.

## D5 — Built-in tool risk classification

| Tool | Class | Notes |
|---|---|---|
| `read` | read-only | Always allowed in all modes. |
| `ls`   | read-only | Always allowed. |
| `grep` | read-only | Always allowed. |
| `find` | read-only | Always allowed. |
| `edit` | edit | Modifies existing file. Gated. |
| `write`| create | Creates or overwrites a file. Gated; overwrite vs create is decided at gate time by checking on-disk existence. |
| `bash` | bash | Own class — always-ask in step-by-step and per-lesson modes. In autonomous, ask on pattern match (rm/sudo/chmod 777 etc.); otherwise auto-allow. The pattern list is the same as pi's reference `permission-gate.ts`. |
| any custom tool with `sourceInfo.source` indicating external paid service | external-service | None today. Future: synthesia, hosted TTS. Always-ask regardless of mode (ARCHITECTURE §3.2 "money is treated as a different risk class"). |

The class table lives in the extension under a single exported constant, so it's auditable in one place. Resolves audit B-10.

## D6 — Cancel semantics

- Closing the plugin's proposal card via the close button = silent reject. Extension returns `{ block: true, reason: "Rejected by user" }`.
- Reject-with-reason is an explicit second affordance in the card. When chosen, the extension issues a follow-up `ctx.ui.editor` for the reason text, then the rejection reason is the entered text (still `{ block: true, reason }`).
- Timing out a dialog (`ctx.ui.confirm` `timeout` field) is treated as silent reject — same as close-button.

Resolves audit B-12.

## D7 — Proposal codec (edit-class)

Edit-class and create-class proposals are surfaced to the plugin in two steps:

1. **Staging** (extension → plugin, fire-and-forget):
   ```
   ctx.ui.notify("AGENCY::proposal::{proposalId, path, operation, before, after, skill, turnId, beforeHash}", "info")
   ```
   The plugin stashes the payload keyed by `proposalId`. `beforeHash` is a SHA-256 of the file content the extension observed pre-write; the plugin uses it to detect stale proposals if the user has edited the file under Obsidian since the extension read it.

2. **Decision** (dialog round-trip, blocking):
   ```
   await ctx.ui.editor({ title: "Approve edit", prefill: "AGENCY::proposal-ref::<proposalId>" })
   ```
   The plugin recognises the prefill sentinel, finds the stashed proposal, opens the CodeMirror MergeView side-by-side (left=before read-only, right=after editable). The user's choice maps onto the `editor` response as follows:

   | User action in MergeView | Plugin response |
   |---|---|
   | Accept (right side unchanged) | `{ value: <after> }` |
   | Accept with edits (right side modified) | `{ value: <edited after> }` |
   | Reject (silent) | `{ cancelled: true }` |
   | Reject with reason | `{ cancelled: true }` followed by an extension-initiated `editor` for the reason |

   The extension treats `value !== original.after` as "accept with edits" and uses the returned content as the actual write content (passed through to the built-in `edit`/`write` by mutating `event.input` before allowing the tool through).

**Non-edit gating (bash, destructive)** uses plain `ctx.ui.confirm({ title, message })` with no sentinel — nothing to render in a diff view.

Resolves audit B-6.

## D8 — Skill provenance in `edit_made` and the proposal payload

Pi does not natively report "the currently active skill" in tool-call events. For Phase 1 we set the skill name to:
- the name of the skill (if any) that produced the most recent `Skill activated` event in the session, or
- `"agent"` if no skill is currently active.

Phase 1 has no skills installed, so all writes will be attributed to `"agent"`. We bake the wiring in now so that when 002 / 003 introduce skills, the provenance "just works." The mechanism to track active skill is to listen for pi's `tool_execution_start` events whose tool name is `skill` (skills activate via a tool) and remember the activated skill name until the turn ends.

Recorded against audit B-11 implicitly — this isn't a fully-solved problem yet, but it's documented and we don't pretend otherwise.

## D9 — Where the autonomy mode lives

- **Authoritative copy:** the extension's in-memory state. Session-scoped, not persistent (per ARCHITECTURE §6).
- **Replica in plugin:** plugin UI shows the *acknowledged* mode (from `mode_acknowledged` sentinel). Plugin never *displays* the mode it just requested; it always waits for the echo to confirm. This avoids drift.
- **Default mode:** `step-by-step`. The extension initialises to that on `session_start` if no prior mode was set.

Per ARCHITECTURE §5.3, a mode change applies to the *next* tool call, not the one mid-flight.

## D10 — Naming

- Slash commands all prefixed `agency-` (e.g. `/agency-set-mode`).
- Sentinel for extension → plugin: `AGENCY::`.
- TypeScript types and codec functions exported from `@educator-agency/shared` (the existing path, no rename).
- `kind` field values in sentinel payloads are kebab-case (e.g. `proposal`, `proposal-ref`, `edit-made`, `mode-acknowledged`).

---

## Deferred (not in this work item; tracked separately)

| Concern | Where it goes |
|---|---|
| Plugin-owned vault writes via proxy tools | `tasks/002_plugin_owned_writes/` |
| History backend (isomorphic-git or otherwise), history sidebar, revert | `tasks/003_history/` |
| Skills (orchestrator, course-designer, …) and mode-injection into the orchestrator's system prompt | `tasks/004_skills/` |
| Per-vault user-defined modes from the JSON/TOML DSL described in ARCHITECTURE §5.1 | `tasks/005_custom_modes/` |
| External-service gates for Synthesia / paid services | bundled with `tasks/006_multimedia/` |
| Stale-read conflict detection across proposal hash check (ARCHITECTURE §11) | starts here in skeleton, real handling lives with 002 |
