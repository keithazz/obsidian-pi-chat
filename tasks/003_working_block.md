# 003 — Group chat traces into a collapsible "working" block

> Simple task: one self-contained unit of work, implemented in a single session, one PR.
> This file must stand alone — the executing session has no memory of the planning chat.

## Goal

Collapse the stack of separate "thinking" and "tool-call" rows in the chat sidebar into a
single collapsible **working block** per contiguous run of agent steps: a spinner with a
live current-step header while the agent works, sealing to a "Worked · N steps" summary
when the run ends, and expanding to reveal the existing per-step detail. This declutters
the transcript while preserving the transparency requirement that current tool activity
stays visible as it happens (PRD §3.9).

## Context

All rendering lives in the Obsidian plugin; this task touches only `packages/plugin/`.

**Current behaviour** ([packages/plugin/src/main.ts](../packages/plugin/src/main.ts)):
- Trace rendering is driven purely by live `message_update` streaming events in the RPC
  handler (~L499–525): `thinking_start/delta/end` and `toolcall_start/delta/end`.
- `startThinkingTrace()` (~L979) and `startToolCallTrace()` (~L1006) each append their own
  **top-level** `pi-chat-msg pi-chat-trace` `<details>` row to `this.messagesEl`. Each
  auto-opens while streaming and auto-collapses on its `*_end` event. This is the stacked
  "Thinking / read / edit" list the working block replaces.
- `currentThinkingEl` / `currentToolCallArgsEl` are the streaming-target handles; they are
  cleared on `turn_end` / `agent_end` / `done` (~L529) and at `sendMessage` (~L954).
- Trace CSS is `.pi-chat-trace*` in [packages/plugin/styles.css](../packages/plugin/styles.css)
  (~L173–243). It already uses `--text-muted` / `--background-secondary` (secondary
  palette), not accent — keep it that way.

**The purple cards are a different thing — leave them alone.** `renderActivityCard()`
(~L819, `.pi-chat-activity-card`, styled with `--interactive-accent` at styles.css ~L345)
renders `edit_made` notifications and opens a diff on click. These are NOT traces and must
not be merged into or restyled by the working block. An activity card simply marks the end
of the current working run (see Scope).

**Decisions settled during planning (grill-with-docs):**
- **Run boundary.** A working block wraps one *contiguous* run of thinking + tool-call
  steps. The run is sealed by the next non-trace event: assistant narration text
  (`appendAssistantText`), an activity card (`renderActivityCard`), a proposal card, a
  question card, or turn end. The next trace after a boundary starts a *new* working block.
  A single turn may therefore show several working blocks interleaved with Pi's prose.
- **Always wrap.** Even a single lone step (one thinking trace, or one tool call) gets the
  working-block container — one uniform code path, no bare traces.
- **Live behaviour.** While the run streams, the block is **collapsed** with a spinner, and
  its header shows the **current step live** (e.g. "Reading `course.md`…", "Thinking…").
  This upholds PRD §3.9 — the current action stays narrated without expanding.
- **Resting state.** When the run seals, the spinner stops and the header becomes a
  **summary count** (e.g. "Worked · 3 steps"). Block stays collapsed. Exact verb/icon/format
  is implementation taste within this shape.
- **Expanded content.** Clicking the block reveals the **existing per-step nested
  collapsibles** — today's thinking `<details>` and tool-call `<details>` (with args)
  rendering, preserved, nested one level deeper inside the block.
- **Colour.** Secondary palette only: `--background-secondary` / `--text-muted` /
  `--background-modifier-border`. Never `--interactive-accent`.

See `docs/reference/architecture.md` §3.4 (chat interface) and PRD §3.9 (transparency).

## Scope

**In scope**
- Introduce a working-block container in the chat sidebar that groups a contiguous run of
  thinking + tool-call traces, per the decisions above.
- A spinner + live current-step header while the run streams; a "Worked · N steps"-style
  summary header once sealed; collapsed by default in both states.
- Seal the current block on any boundary event (assistant text, activity card, proposal
  card, question card, turn end / new prompt) and start a fresh block on the next trace.
- Preserve the existing per-step thinking/tool-call `<details>` rendering verbatim, nested
  inside the block as the expanded content.
- CSS for the block using the secondary palette only. A CSS spinner (e.g. `@keyframes`) is
  fine — there is none today.

**Out of scope** (do not touch)
- `.pi-chat-activity-card` (the purple `edit_made` cards) — not restyled, not merged. They
  only act as a run boundary.
- Any RPC / `packages/shared` / extension / skill change. This is plugin-render only.
- Re-rendering historical traces on session resume/reconnect (traces are live-stream only
  today; see Notes).
- Proposal/question card rendering itself — only their role as a boundary matters here.

## Acceptance criteria

- [ ] A turn with multiple consecutive thinking/tool-call steps renders as **one**
      collapsible working block, not a stack of separate rows.
- [ ] While streaming, the block is collapsed, shows a spinner, and its header reflects the
      current step live (thinking vs. the active tool name / target).
- [ ] When the run is sealed (assistant text, activity card, proposal/question card, or turn
      end), the spinner stops and the header shows a summary count of steps.
- [ ] Expanding the block reveals each step as its own nested collapsible, with thinking
      text and tool-call args exactly as rendered today.
- [ ] A single lone step is still wrapped in a working block.
- [ ] Assistant narration text, and a subsequent run of traces, produce a **second** working
      block — i.e. boundaries split runs; out-of-order grouping does not occur.
- [ ] Purple `edit_made` activity cards render unchanged (accent styling, click-to-diff) and
      are visually outside any working block.
- [ ] The working block uses only secondary-palette tokens (no `--interactive-accent`).
- [ ] `npm run build` passes.

> **Verification tier (sandbox):** lint + type-check + unit tests. This repo's ceiling is
> `npm run build` (tsc for `shared`, esbuild for `plugin`). The sandbox has no Obsidian, so
> all visual/interaction behaviour below goes to `## Manual testing required`.

## Manual testing required (reviewer)

None of the visual/interaction behaviour is verifiable in the sandbox (no Obsidian
renderer). In `dev-vault/` opened in Obsidian, with pi running:

- Send a prompt that triggers a multi-step turn (e.g. "read X then edit it"). Confirm:
  - The thinking + tool steps collapse into a **single** working block (not a stack).
  - While streaming, the block is collapsed, the **spinner animates**, and the header text
    tracks the current step ("Thinking…", then the active tool/target).
  - When the agent emits reply text (or the turn ends), the spinner stops and the header
    becomes a "Worked · N steps" summary.
  - Clicking the block expands it; each step is its own nested collapsible with thinking
    text / tool args intact.
- Trigger a turn that interleaves narration between steps (think → tool → reply text →
  think → tool). Confirm you get **two** working blocks split by the prose, in reading
  order — not one block that swallows steps from both sides of the text.
- Trigger an `edit_made` (an approved/auto write). Confirm the **purple activity card**
  still renders with accent styling, opens the diff on click, and sits **outside** any
  working block. Confirm a trace run that follows the card starts a new block.
- Trigger a single-step turn (one tool call, no thinking, or vice versa) and confirm it is
  still wrapped in a working block.
- Sanity-check both light and dark themes: the block reads as secondary/muted, clearly
  distinct from the purple cards.

## Documentation to update (part of definition of done)

- [ ] `docs/reference/architecture.md` §3.4 (chat interface) — the line describing
      "tool-call narration cards (`tool_call` events before and after execution)" should
      note that consecutive thinking/tool-call traces are grouped into a single collapsible
      "working" block (spinner + live current-step header while streaming → summary-count
      when sealed), and that `edit_made` activity cards remain separate and act as run
      boundaries.

## Notes / risks

- **Boundary plumbing.** Every place that currently appends a non-trace row to
  `this.messagesEl` — `appendAssistantText`, `renderActivityCard`, proposal/question card
  rendering, and the `turn_end`/`agent_end`/`done` + `sendMessage` resets — must seal the
  open working block so the next trace opens a fresh one. Missing a boundary shows up as
  steps grouping across narration (out-of-order). A single "current working block" handle
  (alongside `currentThinkingEl` / `currentToolCallArgsEl`), sealed by a helper called from
  each boundary, is the natural shape.
- **Live-only assumption.** Traces are built purely from streaming `message_update` events;
  nothing replays them on session resume today. If that changes later, the grouping logic
  would need to run over replayed events too — out of scope here, noted so it isn't a
  surprise.
- **Spinner.** No spinner exists in the codebase yet; add a small CSS `@keyframes` rotation
  rather than pulling a dependency.
- **`removeAttribute("open")` interplay.** Today each step's `<details>` auto-collapses on
  its `*_end`. Inside the block, keep per-step collapsibles collapsed by default so the
  expanded block isn't a wall of open text; the block itself owns the collapsed/expanded
  state the user toggles.
