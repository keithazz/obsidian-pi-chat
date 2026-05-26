# 07 — Proposal codec and side-by-side diff view

> Replace the plain-text confirm for edit/create operations with a real diff view, using the two-step staged-payload codec from decision D7.

## Why

PRD §3.2 calls for "diff-style approval gate." ARCHITECTURE §3.4 specifies a CodeMirror 6 `MergeView` with `@codemirror/lang-markdown`, side-by-side, with the right side editable to support "accept with edits." Task 04 / 05 ship a textual confirm — sufficient to validate gating but not the user experience PRD §3.2 actually asks for.

## What to do

### Two-step proposal flow

Per decision D7, edit/create proposals are handled as **staged content + editor dialog**:

1. **Stage** (extension → plugin, fire-and-forget):
   ```ts
   const proposalId = randomUUID();
   ctx.ui.notify(
     encodeExtensionMessage({
       kind: "proposal",
       proposalId,
       path,
       operation: "create" | "modify",
       before,         // empty string for create
       after,          // proposed content
       beforeHash,     // SHA-256 of `before` as the extension read it
       skill: currentSkillName(),
       turnId: ctx.sessionManager.getLeafId() ?? "",
     }),
     "info",
   );
   ```
2. **Decide** (dialog round-trip, blocking):
   ```ts
   const decided = await ctx.ui.editor({
     title: `${operation} ${path}`,
     prefill: `AGENCY::proposal-ref::${proposalId}`,
   });
   ```
   - `decided === undefined` (cancelled) → reject. Same reject-with-reason flow as task 05.
   - `decided !== undefined` → the returned string is the **content to write**. If it equals the originally-proposed `after`, this is a plain accept. If it differs, it's "accept with edits."
3. **Apply** to the tool call:
   ```ts
   if (event.toolName === "write") {
     event.input.content = decided;
   } else if (event.toolName === "edit") {
     // Apply the user's edited content by rewriting the edits[].newText to match.
     // Simplest path: convert the operation into a synthetic single-block edit
     // that replaces the entire current content with the edited content.
     event.input.edits = [{ oldText: before, newText: decided }];
   }
   return undefined; // allow the tool through
   ```

### Plugin: render the MergeView

When `extension_ui_request{ method: "editor", prefill: "AGENCY::proposal-ref::<id>" }` arrives:

1. Look up the stashed proposal payload by `proposalId`. If missing (out-of-order events), display an error card and respond `{ cancelled: true }`.
2. Open a CodeMirror 6 `MergeView` in a new Obsidian main-pane leaf (or a fold-out within the chat — pick one approach for v1; ARCHITECTURE §3.4 says main pane, which is the safer default):
   - Left: `before`, read-only.
   - Right: `after`, editable.
   - `@codemirror/lang-markdown` on both sides.
3. Header bar above the MergeView:
   - Path
   - Operation badge (`modify` / `create`)
   - Skill provenance (Phase 1: usually `agent`)
   - Buttons: **Accept** / **Reject** / **Reject with reason**.
4. **Accept** posts `{ value: <current text of right side> }` as the editor response. If the right side hasn't been touched, this equals `after`; if it has, this is the "accept with edits" path.
5. **Reject** posts `{ cancelled: true }`. Closes the pane.
6. **Reject with reason** posts `{ cancelled: true }` and then sends the `agency-rejection-reason` slash command (same as task 05).
7. **Stale-read warning** (ARCHITECTURE §11): when the proposal arrives, the plugin hashes the file as it currently exists on disk and compares to `beforeHash`. If different, show a yellow banner: "The file changed since this proposal was prepared. Accepting will overwrite those changes." Do **not** auto-reject — let the educator decide. This is the Phase-1 implementation of the stale-read concern; richer conflict handling lives with the plugin-owned-writes work item.

### Dependencies

Add to `packages/plugin/package.json`:
```
"dependencies": {
  "@codemirror/merge": "...",
  "@codemirror/lang-markdown": "...",
  "@codemirror/view": "...",
  "@codemirror/state": "..."
}
```
Pin to minor versions Obsidian's bundled CodeMirror is compatible with. Obsidian ships its own CodeMirror 6 — re-installing `@codemirror/*` from npm should work because esbuild bundles them into `dist/main.js`. But verify the bundled size is acceptable; if it balloons (likely +200KB), consider lazy-loading the MergeView module only when first needed.

### Fallback

If the proposal lookup fails (e.g. the plugin restarted between `stage` and `decide` and lost its in-memory proposal map), respond `{ cancelled: true }` with a system message in chat explaining why. The agent will then receive a rejection and can re-propose. Phase 1 acceptable; richer state recovery is part of the history work item.

## Acceptance

- Asking the agent to "rewrite this paragraph in [`story.md`](../../dev-vault/story.md) to be punchier" in step-by-step mode opens a MergeView pane. The left side is the original; the right shows the agent's proposal.
- Editing the right side and clicking Accept causes `story.md` to be written with the edited content (verified via Obsidian's file view).
- Clicking Accept without editing writes the agent's proposal as-is.
- Clicking Reject blocks the write; the agent receives a tool rejection.
- Manually editing `story.md` in Obsidian *between* the proposal staging and the user's acceptance triggers the stale banner. Accepting still works; rejecting cancels.
- Plain-text confirm cards (from task 04) still appear for `bash` and other non-edit operations.

## Files touched

- `packages/plugin/src/main.ts` (route `editor` requests, lookup stashed proposals, render MergeView, handle accept/reject/reject-with-reason, stale-hash check)
- `packages/plugin/styles.css` (MergeView pane styling, banner)
- `packages/plugin/package.json` (CodeMirror deps)
- `packages/agency/extensions/agency-control.ts` (replace the plain-text confirm for `edit`/`write` with the two-step stage-then-editor flow)

## Out of scope

- Persisting proposals across plugin reloads (cancel-and-restage on reload is fine).
- Multi-file proposals (one path per proposal in Phase 1; the agent issues sequential proposals for multi-file edits).
- Conflict resolution UI beyond the stale banner.
- Inline-diff style (`unifiedMergeView`) — ARCHITECTURE §10 picks side-by-side; revisit only if user feedback warrants.

## Depends on

- 02 (codec)
- 04 (the gate path that needs the staged payload)
- 05 (the rest of the proposal-card / reject-reason wiring; this task only upgrades the `editor` branch and the staging-by-`notify` decode path)

## Notes

- CodeMirror 6's `MergeView` is documented at https://codemirror.net/docs/ref/#merge.MergeView. The "right side editable" feature is supported by setting `b.editable = true` (default) and listening to its dispatch transactions.
- The proposal payload's `before` and `after` are not size-bounded in the codec. If a proposal touches a multi-MB file, the JSON in the `notify` message will be large. Pi's RPC line buffer can handle it (no documented limit beyond what Node's pipe buffering supports), but the editor UX of a huge MergeView is bad. Phase-1 mitigation: in the staging step, if `before.length + after.length > 200_000`, fall back to the plain-text confirm with a summary ("modify story.md, +120 lines / -10 lines") — implement after the happy path works. Track as a follow-up.
- The proposal stash on the plugin side should expire after, say, 5 minutes to avoid leaking memory if the extension stages but never sends the editor request. Documented expiry timer.
