# 08 — Post-execution `edit_made` notifications

> In auto-permitting modes, the user needs to *see* what just happened, even though they didn't approve it interactively. This task adds an "activity feed" of accepted edits inline in chat.

## Why

PRD §3.2 (autonomous still produces user-visible audit), PRD §3.6 (history as audit trail), ARCHITECTURE §3.2 ("Post-execution edit_made notifications in auto-permitting modes"), §4 ("Post-hoc notifications in auto modes — the notify method, which is fire-and-forget and does not block the tool").

The history backend itself (revert, sidebar, persistence) is deferred to a later work item. This task implements the **eventing** — the bridgehead — so that when history persistence lands it just consumes events already being emitted.

## What to do

### Extension side

After a write-class tool call has been allowed (either auto-allowed or accepted), and after pi has actually run the tool, emit an `edit-made` notify:

```ts
pi.on("tool_result", async (event, ctx) => {
  if (event.isError) return; // tool failed; nothing to record
  if (!["edit", "write"].includes(event.toolName)) return;

  const editId = randomUUID();
  const path = event.input?.path ?? "(unknown)";
  const operation = event.toolName === "write"
    ? (existsBefore.get(path) ? "modify" : "create")
    : "modify";
  const summary = summariseChange(event); // "+12 / -3 lines" etc.

  ctx.ui.notify(
    encodeExtensionMessage({
      kind: "edit-made",
      editId,
      turnId: ctx.sessionManager.getLeafId() ?? "",
      skill: currentSkillName(),
      operation,
      path,
      summary,
    }),
    "info",
  );
});
```

`existsBefore` is a small map populated at `tool_call` time (we know whether the target file existed before the gate allowed the write). `currentSkillName()` returns `"agent"` in Phase 1 per decision D8.

`summariseChange` is intentionally lightweight: read the file before the tool runs (already done at proposal-staging time in task 07 — pass that data forward via the call closure, or via the `editId` keyed map) and the file after the tool runs; compute a one-line summary. If the file is large, just report `<bytes-before> → <bytes-after>` rather than running a full diff.

### Plugin side

When the plugin decodes an `edit-made` payload (the path already established in task 02):

- Render an **activity card** in the chat message stream:
  ```
  ✎ agent · modify story.md · +12 / -3 lines
  ```
  Style it more compactly than proposal cards — this is informational, not blocking. One line.
- The card is clickable; clicking opens a read-only diff view of the recorded change.
  - Phase 1 simplification: clicking opens the file in Obsidian's normal editor. The "view the diff" experience is a future-work UX once we have history persistence and snapshots. Document this stub.
- Maintain an in-memory list of `edit-made` events for the current session, accessible via a command palette command "Pi Chat: Show session edit log" that lists them with timestamps. Pure in-memory; no persistence yet.

### Cards do **not** appear in step-by-step mode for already-approved edits

In step-by-step the user explicitly approved each edit. Re-rendering an activity card after the proposal card is noisy. Suggested behaviour: the extension always *emits* `edit-made` (so future history persistence catches everything), but the plugin **suppresses the activity card** for edits that already produced a resolved proposal card in this session. Implementation: when an `edit-made` arrives with a `turnId` that the plugin recently rendered a proposal card for, downgrade the card to a small ✓ pill on the already-rendered proposal card instead of creating a new card.

Track resolved proposal cards by `requestId` and link them to `edit-made` via `(path, turnId)`. Not strictly required for v1 — if it gets fiddly, the simpler "always render the activity card" UX is acceptable for Phase 1 and a "deduplicate later" note is fine.

## Acceptance

- In autonomous mode, asking the agent to edit two files in a row produces two activity cards in the chat, one per accepted edit, with summary text.
- In step-by-step mode, the user's proposal card resolution shows the activity outcome inline; no duplicate activity card appears (assuming we implemented the dedup). If dedup is deferred, two cards appearing is acceptable for Phase 1.
- "Pi Chat: Show session edit log" lists the edits with timestamps, paths, and summaries.
- Rejected proposals do **not** produce activity cards.
- Failed tool calls (e.g. write to a read-only path) do **not** produce activity cards (`event.isError` short-circuit).

## Files touched

- `packages/agency/extensions/agency-control.ts` (track existence-before, emit `edit-made` from `tool_result`, summary helper)
- `packages/plugin/src/main.ts` (decode `edit-made`, render activity card, in-memory session edit log, command palette entry)
- `packages/plugin/styles.css` (activity card styling)

## Out of scope

- Persistence beyond the current session (history work item).
- A first-class "history sidebar" pane (history work item).
- Revert (`/agency-revert <editId>` stub registered in task 02; real implementation is in the history work item).
- Cross-vault dedup of edits (not a concept yet).

## Depends on

- 02 (codec)
- 04 (gate emits writes only after allowing them)
- 07 (proposal staging gives us the `before` content we summarise against)

## Notes

- ARCHITECTURE §6 (state ownership) lists "Change history" as a separate backend; we are explicitly **not** wiring that up here. The contract this task establishes is: every accepted edit produces one `edit-made` event with stable fields. Whoever later builds the history backend can subscribe.
- Pi's `tool_result` hook is documented in `docs/extensions.md` (the `tool_result` event chains like middleware and runs after the tool finishes). It fires even when the gate allowed the write through auto-mode, which is exactly what we want.
- If the user has typed manually into the file between the gate's `tool_call` allow and pi's actual write, the on-disk `before` may differ from what the gate saw. The summary should report what pi wrote, not pre-image diffs against the stage-time `before`. Keep this in mind when implementing `summariseChange`.
