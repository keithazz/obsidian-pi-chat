# 04 — Autonomy-mode state and the gate engine

> The first task that produces user-observable gating behaviour. Uses plain-text confirms only; the richer diff-view path lands in task 07.

## Why

PRD §3.2 calls for a spectrum of autonomy modes that gate per-write behaviour. ARCHITECTURE §3.2 puts this logic in the agency-control extension's `tool_call` hook, and §5.1 defines the named modes:

| Mode | Workflow checkpoints | Per-write gating | External services |
|---|---|---|---|
| **Step-by-step** | Every artifact (orchestrator's job; not in scope here) | Every write | Always ask |
| **Per-lesson**  | At lesson boundaries | Auto-edit within a lesson; ask on delete/rename | Always ask |
| **Autonomous**  | None below course level | Auto-edit; ask on destructive | Always ask |

We are concerned with the **per-write gating** column. Workflow checkpoints live in the orchestrator skill (deferred to a later work item).

## What to do

### Extend the extension state

In `packages/agency/extensions/agency-control.ts`, hold:

```ts
import type { AutonomyMode } from "@educator-agency/shared";

let mode: AutonomyMode = "step-by-step"; // default per decision D9

pi.on("session_start", async (_event, ctx) => {
  mode = "step-by-step";
  // ... existing loaded notify
});
```

### Wire the `agency-set-mode` handler to actually mutate state

Replace the stub in [02_control_transport.md](./02_control_transport.md):

```ts
pi.registerCommand("agency-set-mode", {
  description: "Set the agency's autonomy mode",
  handler: async (args, ctx) => {
    const parsed = parseSlashArgs("agency-set-mode", args);
    if (!parsed) return ctx.ui.notify("Invalid mode", "warning");
    mode = parsed.mode;
    ctx.ui.notify(
      encodeExtensionMessage({ kind: "mode-acknowledged", mode, effectiveAt: new Date().toISOString() }),
      "info",
    );
  },
});
```

### Decision matrix

Per-tool-class × mode. Compute the **gate decision** `"allow" | "ask" | "deny"` from `(class, mode, tool-specific signals)`:

| Class \\ Mode | step-by-step | per-lesson | autonomous |
|---|---|---|---|
| read-only | allow | allow | allow |
| edit      | ask   | allow | allow |
| create    | ask   | allow | allow |
| bash      | ask   | ask   | pattern-ask¹ |
| external-service | ask | ask | ask |
| unknown   | ask   | ask   | ask |

¹ For `bash` in autonomous: ask if the command matches any of `[/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i]` (decision D5, sourced from pi's reference `permission-gate.ts`). Otherwise, allow.

Edge case for class `edit` in per-lesson: ARCHITECTURE §5.1 says "ask on delete/rename" — but pi's `edit` tool only mutates content, not paths. The "delete/rename" subclass is reserved for future use (a custom tool that does it). For Phase 1, per-lesson auto-allows all `edit`. Document the gap as a comment.

Implementation:

```ts
function decide(klass: ToolClass, m: AutonomyMode, event: { toolName: string; input: any }): "allow" | "ask" | "deny" {
  if (klass === "read-only") return "allow";
  if (klass === "external-service" || klass === "unknown") return "ask";
  if (klass === "bash") {
    if (m === "autonomous") {
      const dangerous = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];
      return dangerous.some((p) => p.test(String(event.input.command ?? ""))) ? "ask" : "allow";
    }
    return "ask"; // step-by-step, per-lesson
  }
  // edit, create
  if (m === "step-by-step") return "ask";
  return "allow"; // per-lesson, autonomous
}
```

### Hook implementation

Replace the logging-only `tool_call` listener from task 03 with the gating one:

```ts
pi.on("tool_call", async (event, ctx) => {
  const klass = classifyTool({ toolName: event.toolName, input: event.input, fileExistsOnDisk: existsSync, cwd: ctx.cwd });
  const decision = decide(klass, mode, event);

  if (decision === "allow") return undefined;
  if (decision === "deny") return { block: true, reason: "Denied by policy" };

  // decision === "ask"
  if (!ctx.hasUI) {
    // headless print mode etc.; fail closed
    return { block: true, reason: "No UI available to confirm" };
  }

  const title = `${event.toolName} — ${klass}`;
  const message = renderPlainTextSummary(event); // see below

  const ok = await ctx.ui.confirm(title, message);
  if (!ok) {
    return { block: true, reason: "Rejected by user" };
  }
  return undefined;
});
```

`renderPlainTextSummary` is a small helper that produces a human-readable preview for the textual confirm. For `bash` it shows the command string. For `edit` it shows `${path}: <N> edit block(s)`. For `write` it shows `${path}: <N> chars`. This is the plain-text path — task 07 supersedes the `edit`/`create` confirms with the diff codec.

### Persistence across `/reload`

Not required for Phase 1 (decision D9: session-scoped, non-persistent). Note in a code comment that adding persistence is a one-liner with `pi.appendEntry("agency-mode", { mode })` plus a restore branch in `session_start`.

## Acceptance

End-to-end smoke (with task 06 not yet done, you'll change mode by hand-typing `/agency-set-mode <mode>` in the chat input):

1. **Default step-by-step**:
   - Ask the agent to "create a file called `notes.md` with two lines about caching." Expect a textual confirmation card before the `write` runs. Accepting writes the file; rejecting does not, and the agent receives a rejected-with-reason tool result.
   - Ask the agent to "list files." Expect no confirmation — `ls`/`find`/`read` auto-allow.
2. **Per-lesson**:
   - Type `/agency-set-mode per-lesson`. Status bar should update (task 06 wires the visual; for now confirm via the `mode-acknowledged` console log).
   - Repeat the file-creation prompt. Expect no confirmation — `write` auto-allows.
   - Ask the agent to "run `ls -la`." Expect a confirmation (bash still asks).
3. **Autonomous**:
   - Type `/agency-set-mode autonomous`. Repeat — `bash` only asks when the command matches the pattern set. `ls` runs without prompting; `rm -rf .` triggers the ask.
4. **Rejection flow**:
   - Reject any write proposal. The agent should receive a tool-rejection result and either ask for clarification or stop. The conversation should not crash.

Pi stderr / Obsidian devtools should show the per-call decision in the log line introduced in task 03.

## Files touched

- `packages/agency/extensions/agency-control.ts` (mode state, `agency-set-mode` handler, gate `tool_call` hook, `renderPlainTextSummary`)

## Out of scope

- Diff view (task 07). Plain-text confirm only.
- Reject-with-reason follow-up `editor` round-trip (task 05 — the plugin side of "Reject with reason"). For now, rejection = silent reject with the canned reason "Rejected by user."
- Post-execution `edit_made` notifications (task 08).
- Mode-switcher UI (task 06; tested here via slash command directly).
- Persistence across `/reload` (decision D9).

## Depends on

- 02 (codec, slash command registration)
- 03 (classification table)

## Notes

- Pi's `tool_call` hook can mutate `event.input` in place. Task 07 uses this to apply "accept with edits": the user's edited content from the MergeView gets written into `event.input.content` (for `write`) or `event.input.edits[*].newText` (for `edit`) before the tool runs.
- In RPC mode, `ctx.ui.confirm` becomes an `extension_ui_request{method:"confirm"}` (see pi's `docs/rpc.md`). Task 05 makes the plugin render this as a proposal card instead of auto-confirming.
- For testing without the UI changes from task 05, the plugin's current auto-confirm behaviour means every gate will pass silently. That's fine for verifying the *decision* logic in isolation (look at the log), but full end-to-end testing depends on task 05 being done too.
