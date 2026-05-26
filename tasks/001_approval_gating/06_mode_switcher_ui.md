# 06 — Mode switcher UI in the plugin

> Surface autonomy mode to the educator: show the current mode, let them change it, and keep the display honest about who is the authority.

## Why

PRD §3.2 expects "configurable by the educator at any point during a session." ARCHITECTURE §3.4 mentions "Autonomy mode switcher: a toolbar control and keyboard shortcut" and §6 establishes the plugin shows the *acknowledged* mode (not the requested one). This task makes both real.

## What to do

### Status-bar display

The chat view's status bar already shows provider/model/thinking level ([packages/plugin/src/main.ts:488-498](../../packages/plugin/src/main.ts#L488-L498)). Add a `mode:` segment next to those:

```
● anthropic · claude-sonnet-4 · thinking: medium · mode: step-by-step
```

`PiChatView` holds `currentMode: AutonomyMode = "step-by-step"` initialised from the default; updates **only** when the extension echoes `mode-acknowledged`. The `mode-acknowledged` decoded payload (task 02) is the trigger — never optimistic.

### Click to switch

The `mode:` text becomes a clickable inline selector. Clicking opens a small popover with the three options (step-by-step / per-lesson / autonomous). Clicking an option sends `sendControl({ name: "agency-set-mode", mode })` and disables the popover until the matching `mode-acknowledged` arrives. If no ack arrives within 3 seconds, re-enable the popover and show a small "(no response)" indicator next to the mode label.

### Command palette + hotkey

Add three Obsidian commands at plugin load:
- `Pi Chat: Set autonomy to step-by-step`
- `Pi Chat: Set autonomy to per-lesson`
- `Pi Chat: Set autonomy to autonomous`

Each is a one-liner that calls into the same `sendControl(...)` helper. Users can bind keyboard shortcuts via Obsidian's hotkeys UI; we don't ship default bindings (Phase 1 conservatism — don't squat on shortcut space until we know what's commonly used).

### Settings entry

Add a "Default autonomy mode" dropdown to the gear-icon settings panel (task already established that panel in [packages/plugin/src/main.ts:105-132](../../packages/plugin/src/main.ts#L105-L132)). The selection here:
- Persists across plugin reloads (use Obsidian's `loadData()` / `saveData()`).
- Is sent as a `set-mode` on `session_start` (i.e. on pi spawn) so the extension's session-scoped default matches user preference.
- Does **not** change the *currently active* mode — that's still session-scoped per ARCHITECTURE §6. The dropdown affects only future sessions. Document this in the setting's description text.

### Visual treatment

Suggested colour code, using existing Obsidian CSS vars:

| Mode | Accent |
|---|---|
| step-by-step | `--text-muted` (calm; nothing happens without you) |
| per-lesson   | `--text-accent` or `--interactive-accent` |
| autonomous   | `--text-warning` or a slightly warmer hue |

Not a hard requirement — the goal is to make "autonomous" visually distinct so the educator doesn't lose track of where they are.

## Acceptance

- Status bar shows `mode: step-by-step` immediately after pi connects.
- Clicking it opens a popover with three options. Selecting "autonomous" sends the slash command; the label updates only after the `mode-acknowledged` echo. Network/extension lag is visible (the popover briefly disables).
- Command palette commands work and produce the same status-bar update.
- Settings dropdown persists; the chosen mode is applied at the start of the next session, but the current session is not changed.
- The card-based gating flow (task 05) behaves correctly in all three modes — no confirm cards in autonomous for safe operations, confirm cards in step-by-step for any write.

## Files touched

- `packages/plugin/src/main.ts` (status-bar segment, popover, commands, settings dropdown, sendControl wiring)
- `packages/plugin/styles.css` (popover, mode pill)
- (No changes in the extension; this task is purely plugin-side.)

## Out of scope

- User-defined custom modes from the JSON/TOML DSL (ARCHITECTURE §5.1, deferred to the custom-modes work item).
- Per-skill autonomy overrides (deferred).
- Per-path policy overrides via `pathOverrides` / `externalApis` fields in the `set_autonomy_mode` payload — the shared type carries them, but the plugin Phase-1 UI does not expose them.

## Depends on

- 02 (codec, `sendControl`, `mode-acknowledged` decode path)
- 04 (the extension actually applies the mode change)

## Notes

- The shared `SetAutonomyMode` type today (`packages/shared/src/rpc.ts`) carries `pathOverrides` and `externalApis`. The Phase-1 UI does not expose these but the codec leaves them addressable for the custom-modes work item. `formatSlashCommand` for `agency-set-mode` should serialise only `mode` for now and ignore the override fields — to be revisited.
- We deliberately do **not** auto-revert to step-by-step on session end. If the educator was in autonomous and a new session starts, the extension's session_start reset (task 04) brings them back to step-by-step (or to the settings default, depending on what task 06 wires up). Be explicit in code which behaviour we picked.
