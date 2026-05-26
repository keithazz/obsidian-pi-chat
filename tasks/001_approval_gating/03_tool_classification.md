# 03 — Tool risk classification

> Small, defensive task. Establishes the lookup table that the gate engine (task 04) consults. No user-visible behaviour change.

## Why

ARCHITECTURE §3.2 lists the risk classes ("read-only / edit / create / destructive / external-service") but doesn't enumerate which built-in tools fall in which class. The gate (task 04) shouldn't be making that judgement inline — it should call into one table that is auditable in one place.

Decision D5 in [00_decisions.md](./00_decisions.md) commits to the initial classification.

## What to do

In `packages/agency/extensions/agency-control.ts` (or a sibling file under `packages/agency/extensions/`, but keep the surface small — one file is fine for now), introduce:

```ts
export type ToolClass =
  | "read-only"
  | "edit"
  | "create"
  | "bash"
  | "external-service"
  | "unknown";

interface ClassificationInput {
  toolName: string;
  input: Record<string, unknown>;
  fileExistsOnDisk: (absolutePath: string) => boolean; // injected; uses node:fs.existsSync
  cwd: string;
}

export function classifyTool(call: ClassificationInput): ToolClass {
  switch (call.toolName) {
    case "read":
    case "ls":
    case "grep":
    case "find":
      return "read-only";
    case "edit":
      return "edit";
    case "write": {
      // overwrite vs create distinction is taken at gate time; we treat both as "create"
      // for class purposes — both produce a vault-content mutation.
      return "create";
    }
    case "bash":
      return "bash";
    default:
      return "unknown";
  }
}
```

Wire it into a `tool_call` listener that, for this task only, logs the classification without acting on it:

```ts
pi.on("tool_call", async (event, ctx) => {
  const klass = classifyTool({
    toolName: event.toolName,
    input: event.input,
    fileExistsOnDisk: (p) => existsSync(p),
    cwd: ctx.cwd,
  });
  console.log("[agency-control] tool_call", event.toolName, "→", klass);
  return undefined; // never block in this task
});
```

The `unknown` class is the safety net for future custom tools (Synthesia, etc.). The gate (task 04) treats `unknown` as "always ask" — fail-closed.

Also export the table itself as a `const` so tests / future work can inspect it:

```ts
export const TOOL_CLASS_TABLE: Record<string, ToolClass> = {
  read: "read-only",
  ls: "read-only",
  grep: "read-only",
  find: "read-only",
  edit: "edit",
  write: "create",
  bash: "bash",
};
```

`classifyTool` checks the table first, then falls back to `"unknown"`. Tools registered with `sourceInfo.source` indicating a paid external service should be tagged `external-service` — for now this is detected by a separate predicate (`isExternalServiceTool`) that returns `false` until we install one. Document the extension point with a one-line comment.

## Acceptance

- After this task, every `tool_call` produces a `[agency-control] tool_call <name> → <class>` line in pi's stderr / Obsidian devtools console.
- Sending `"list the files in this directory"` and triggering `bash`/`ls`/`read` calls produces correct classifications in the log.
- No tool is blocked. Behaviour is identical to before from the user's perspective.

## Files touched

- `packages/agency/extensions/agency-control.ts` (or a new `packages/agency/extensions/classification.ts` if you prefer separation — the task allows either; one file keeps things grep-able, two files keep the gate logic cleaner. Pick one.)

## Out of scope

- Acting on classifications (task 04).
- Distinguishing overwrite vs create at gate time (handled in 04 with `fileExistsOnDisk`).
- External-service classification beyond the predicate stub.

## Depends on

- 01 (extension is loaded).

## Notes

- The `"bash"` class is its own thing rather than collapsed into "destructive" because shell behaviour is intent-dependent. Decision D5 commits to: always-ask in step-by-step and per-lesson, pattern-match-ask in autonomous (using pi's reference `permission-gate.ts` patterns: `\brm\s+(-rf?|--recursive)`, `\bsudo\b`, `\b(chmod|chown)\b.*777`). Task 04 implements this.
- `edit` vs `create` is the architectural distinction we care about for diff UI later — `edit` has a non-empty `before`, `create` has empty `before`. We make this a *class* distinction here, but it could equally have been a property the gate computes. Keeping it as a class is more readable.
