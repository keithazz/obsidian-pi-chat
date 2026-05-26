# 001 — Approval gating and autonomy modes

Builds the configurable-autonomy + diff-gated-approval capability from PRD §3.2 and ARCHITECTURE §3.2, §4, §5 on top of the current POC chat view.

End state of this work item:
- The `agency-control` extension is loaded by the plugin and runs real policy.
- Three autonomy modes (`step-by-step`, `per-lesson`, `autonomous`) are configurable mid-session via a slash-command transport.
- Per-write gating consults a tool-class table to decide allow / ask / deny.
- "Ask" maps to a plugin UI: textual confirm cards for `bash`-class operations, side-by-side CodeMirror MergeView for `edit`/`create`.
- Accept-with-edits is supported via the editable right-hand pane.
- Reject-with-reason is plumbed through a small slash command.
- Auto-mode writes emit `edit-made` activity cards in the chat as an audit bridgehead.
- The agent can call `ask_user` to clarify mid-turn in any mode.

## Decision doc

- [00_decisions.md](./00_decisions.md) — read this first. Records the transport choices, codec design, vault-writes stance, tool classification, and naming conventions. The task files cite these decisions; the decisions cite the audit.

## Tasks in dependency order

| # | File | Touches | Depends on |
|---|---|---|---|
| 01 | [01_load_extension.md](./01_load_extension.md) | plugin spawn args; extension factory signature | — |
| 02 | [02_control_transport.md](./02_control_transport.md) | `shared/src/rpc.ts` codec; plugin decode path; extension command stubs | 01 |
| 03 | [03_tool_classification.md](./03_tool_classification.md) | extension classification table; logging-only `tool_call` hook | 01 |
| 04 | [04_mode_state_and_gate.md](./04_mode_state_and_gate.md) | mode state in extension; `agency-set-mode` handler; gate engine; plain-text confirms | 02, 03 |
| 05 | [05_plugin_proposal_card.md](./05_plugin_proposal_card.md) | plugin proposal-card UI replacing auto-confirm; reject-with-reason flow | 02, 04 |
| 06 | [06_mode_switcher_ui.md](./06_mode_switcher_ui.md) | plugin mode display, switcher popover, command-palette entries, settings dropdown | 02, 04 |
| 07 | [07_proposal_codec_and_diff.md](./07_proposal_codec_and_diff.md) | two-step staged-proposal codec; CodeMirror MergeView in plugin | 02, 04, 05 |
| 08 | [08_post_exec_notify.md](./08_post_exec_notify.md) | `edit-made` emission in extension; activity cards in plugin; in-memory session edit log | 02, 04, 07 |
| 09 | [09_ask_user_tool.md](./09_ask_user_tool.md) | `ask_user` registered tool; cooperates with plugin's `select`/`input` cards | 02, 05 |

A reasonable working order is 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09. Tasks 03 and 04 could be merged at implementation time if you'd rather have a single PR; they're split here for review reasons. Same for 05 and 06 (orthogonal — plugin-UI vs gate-UI).

## What's explicitly deferred

Tracked in [00_decisions.md §Deferred](./00_decisions.md#deferred-not-in-this-work-item-tracked-separately). Headlines:
- Plugin-owned vault writes (the proxy-tool route to honour ARCHITECTURE §3.4 properly).
- History persistence backend, history sidebar, revert.
- Skills (orchestrator and workers) — only the extension-side hooks live here; no skill files are added.
- Per-vault user-defined modes from the JSON/TOML DSL.
- External-service gates (Synthesia etc.) — the class exists, no consumers yet.

## How to verify the whole work item end-to-end

After all nine tasks are complete:

1. `npm run build && npm run link-dev-vault`. Open `dev-vault/` in Obsidian; enable Pi Chat.
2. Status bar shows mode `step-by-step`.
3. Ask: "List the files in the vault." — runs without prompting.
4. Ask: "Create a file `lesson_1.md` with a short outline." — opens MergeView. Accept. File appears in vault.
5. Switch to `autonomous` via the status-bar selector. Status bar updates only after the extension's echo.
6. Ask: "Rewrite `lesson_1.md` to be more concise." — no proposal card; activity card appears in chat after the edit lands.
7. Ask: "Now run `rm -rf .` to clean up." — confirm card appears even in autonomous (pattern-match).
8. Reject with reason "we don't want destructive ops." Agent receives the rejection with that reason.
9. Ask: "Should I use UK or US spelling in this course? Use ask_user." — options card appears, user picks one, agent continues.

That sequence exercises every task in the work item.
