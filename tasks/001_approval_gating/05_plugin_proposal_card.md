# 05 — Plugin proposal card (replacing auto-confirm)

> Replace the auto-confirm hack in [packages/plugin/src/main.ts:385](../../packages/plugin/src/main.ts#L385) with a real UI that lets the educator decide.

## Why

Today the plugin auto-replies `{ confirmed: true }` to every `extension_ui_request`. Task 04 introduces real gating, which means real confirmation requests; until this task lands, the gate is silently bypassed.

PRD §3.2 ("Configurable autonomy with diff-gated approval"), ARCHITECTURE §3.4 (chat-embedded approvals), §4 (`ctx.ui.confirm` ↔ proposal card mapping).

## What to do

### Render proposal cards inline in the chat

In `handleEvent`'s `extension_ui_request` branch, branch by `msg.method`:

- `confirm` → render a **proposal card** in the message list with title, message, and three buttons: **Accept**, **Reject**, **Reject with reason**.
- `select` → render an **options card** with one button per option. (Used by the `ask_user` tool from task 09 and the reject-with-reason flow.)
- `input` → render an **input card** with a single-line text field and a Submit button.
- `editor` → for this task, fall back to `input`-style (multi-line `<textarea>`). The real diff-view editor comes in task 07.
- `notify` → if `tryDecodeExtensionMessage(message)` returns a known control kind, dispatch as decided in task 02. Otherwise, render the message as a system toast (the existing `addSystemMessage` path is fine).

Each card stores the `extension_ui_request.id` on its DOM element so its buttons can post the correct `extension_ui_response`.

### Card lifecycle

- A card stays in the message stream after the user resolves it. Show a small "✓ accepted" / "✗ rejected" pill on the card, keep title/message visible. This is the audit trail in chat.
- If a new turn starts while a card is still unanswered, leave it open. The agent is blocked on it; that's expected.
- If the user closes the chat panel without answering, the request stays open; reopening the panel restores it. (For Phase 1 we accept that closing the *plugin* — by disabling it or restarting Obsidian — loses the pending request; the next pi turn will re-emit it or fail with a tool timeout. Document this in code comments.)

### Buttons and responses

- **Accept** → `{ type: "extension_ui_response", id, confirmed: true }`.
- **Reject** → `{ type: "extension_ui_response", id, confirmed: false }`.
- **Reject with reason**:
  1. The plugin sends `{ confirmed: false }` to resolve the current `confirm`.
  2. The extension (task 04 amendment — see below) detects "reject with reason" via a follow-up `editor` request the next time it's asked. To keep the cooperative state machine simple, the **plugin** initiates the reason capture: clicking "Reject with reason" opens an inline textarea in the card itself, sends `confirmed: false` *and* immediately follows it with a slash command `/agency-rejection-reason <id> <reason>` (added to the codec).
  3. Extension's command handler stashes the reason and uses it next time the same agent turn produces a tool-rejection — this is a small piece of state on the extension side, scoped to the current turn.
  
  **Simpler alternative:** wrap the rejection-reason in the `confirm` response by misusing the `cancelled` field plus an unused field — but pi's RPC schema validates response shape, so we don't trust this path. Stick with the slash command, which is already part of the codec design.

  Add the slash command to the codec in `@educator-agency/shared`:
  ```ts
  type PluginToExtensionCommand =
    | { name: "agency-set-mode"; mode: AutonomyMode }
    | { name: "agency-revert"; editId: string }
    | { name: "agency-rejection-reason"; requestId: string; reason: string };
  ```
  And on the extension side, register `agency-rejection-reason` and store `lastRejection = { requestId, reason }`. The gate's `if (!ok)` branch then prefers `lastRejection.reason` over the canned "Rejected by user" string, and clears it after use.

### DOM

Add `.pi-chat-proposal-card` styles in `packages/plugin/styles.css`. Keep the look consistent with `.pi-chat-trace` cards already there. A reasonable structure:

```
<div class="pi-chat-proposal-card" data-request-id="...">
  <div class="pi-chat-proposal-title">edit — edit</div>
  <div class="pi-chat-proposal-message">notes.md: 1 edit block</div>
  <div class="pi-chat-proposal-actions">
    <button class="pi-chat-proposal-accept">Accept</button>
    <button class="pi-chat-proposal-reject">Reject</button>
    <button class="pi-chat-proposal-reject-reason">Reject with reason…</button>
  </div>
</div>
```

The reject-reason flow expands the card to include a `<textarea>` and a "Submit reason" button.

### Removing the auto-confirm

Delete (or comment out with a clear marker) the auto-confirm block at [packages/plugin/src/main.ts:385-391](../../packages/plugin/src/main.ts#L385-L391). Replace it with the dispatch described above.

## Acceptance

- In step-by-step mode, asking the agent to "create a file" produces a proposal card with the file path and a brief preview. Clicking Accept lets pi write the file; Reject blocks the tool and the agent reports the rejection back to the user. Reject-with-reason expands the card, the educator types a sentence, Submit clears the card and the agent's tool-rejection result includes that reason.
- In autonomous mode, asking the agent to "run `rm -rf .`" produces a card. Asking it to "list files" does not.
- Cards persist in the chat history after resolution with an outcome pill.
- `ask_user`-style `select` and `input` requests (you can synthesise these with a temporary extension command for testing) also render usable cards.

## Files touched

- `packages/plugin/src/main.ts` (event dispatch, card rendering, button wiring, reject-reason flow)
- `packages/plugin/styles.css` (proposal-card styles)
- `packages/shared/src/rpc.ts` (add `agency-rejection-reason` to `PluginToExtensionCommand`; update `formatSlashCommand`/`parseSlashArgs`)
- `packages/agency/extensions/agency-control.ts` (register `agency-rejection-reason` handler; thread `lastRejection` through the gate's reject branch)

## Out of scope

- Side-by-side diff rendering (task 07). For `editor` requests this task uses a plain textarea fallback. Edit/create proposals still use the plain-text `confirm` card from task 04.
- History of resolved cards beyond the chat scroll (deferred to the history work item).
- Keyboard shortcuts for Accept/Reject (nice-to-have, defer).

## Depends on

- 02 (codec, sendControl helper)
- 04 (mode + gate so the cards actually appear in real flows)

## Notes

- Pi's RPC docs note: dialog methods (`confirm`, `select`, `input`, `editor`) **block the tool call** until the response arrives. If the plugin never sends one, the entire agent stalls. Make sure error paths (e.g. an exception during card rendering) still post a response (`{ cancelled: true }`) so pi doesn't deadlock.
- The current plugin uses `addSystemMessage` for the auto-confirm notice. Keep system messages for genuinely systemic events (pi crashed, etc.) and use the proposal card path for any decision the user is being asked to make.
- The reject-with-reason slash command is fire-and-forget from the plugin's perspective. The extension acknowledges by *using* the reason; there's no echo. If you want a visible acknowledgement, the extension could emit a `notify` with kind `rejection-recorded` — optional, not required.
