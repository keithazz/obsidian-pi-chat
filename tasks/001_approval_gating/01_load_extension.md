# 01 — Make the plugin actually load the agency-control extension

> Foundation task. Without this, every other task in this work item is unreachable.

## Why

[packages/plugin/src/main.ts:216](../../packages/plugin/src/main.ts#L216) spawns `pi --mode rpc` with no `--extension` flag. Pi's auto-discovery only checks `~/.pi/agent/extensions/` and `.pi/extensions/`, neither of which contains our extension. The agency lives at `<vault>/agency/extensions/agency-control.ts` (per ARCHITECTURE §2 topology and §3.4) and only gets loaded if we pass `-e <path>` explicitly.

Additionally [packages/agency/extensions/agency-control.ts:18](../../packages/agency/extensions/agency-control.ts#L18) exports `function activate(_ctx)`, which doesn't match pi's documented factory contract `export default function (pi: ExtensionAPI)`. It loads, but the variable is misnamed and no handlers are registered.

Cited: ARCHITECTURE §3.1 (extensions intercept via `tool_call`), §3.4 (plugin spawn line).

## What to do

### Plugin (`packages/plugin/src/main.ts`)

1. Resolve the extension path at spawn time:
   ```ts
   const extensionPath = path.join(vaultPath, "agency", "extensions", "agency-control.ts");
   ```
   The `agency/` directory is symlinked into the dev vault by `scripts/dev-link.sh`. For non-dev installations the same convention holds: an installed agency lives at `<vault>/agency/`.
2. Update the spawn args in both branches (zsh and Windows):
   - macOS/Linux: `pi --mode rpc --extension "<extensionPath>"`
   - Windows: `["--mode", "rpc", "--extension", extensionPath]`
3. Guard: if the extension file does not exist, log a clear message in the chat ("Agency extension not found at `<path>` — run `npm run link-dev-vault` or scaffold the agency") and still spawn pi without the flag so the chat is at least usable.

### Extension (`packages/agency/extensions/agency-control.ts`)

Replace the stub with the canonical factory shape:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("AGENCY::loaded::{}", "info");
  });
}
```

The `AGENCY::loaded::{}` sentinel is the canary the plugin uses to confirm wiring (see Acceptance below). The actual encoder lives in `@educator-agency/shared` once task 02 is done; for this task it's fine to hand-write the sentinel string.

### Build / wiring

- `packages/agency/extensions/agency-control.ts` imports from `@earendil-works/pi-coding-agent` for types. Pi loads the extension via jiti at runtime; it does not need to be pre-built. But the type import must resolve at edit time — add `@earendil-works/pi-coding-agent` to `packages/agency/package.json` as a `devDependency` (types only; pi resolves the runtime).
- No esbuild build needed for the extension; pi compiles it on load.

## Acceptance

- After `npm run build && npm run link-dev-vault`, reopen the Obsidian dev vault, open Pi Chat.
- The chat view shows a system message originating from the `AGENCY::loaded::{}` notify (rendered as "extension loaded" or similar — exact rendering finalised in task 02 once the decoder lands; for this task an unprefixed "loaded" message is fine).
- Pi stderr / Obsidian devtools confirm no "extension not found" error.
- The chat still streams `read`/`bash` etc. as before — gating is not yet active. This task purely proves the extension is in the loop.

## Files touched

- `packages/plugin/src/main.ts` (spawn args)
- `packages/agency/extensions/agency-control.ts` (factory signature, session_start handler)
- `packages/agency/package.json` (devDep on pi types)

## Out of scope

- Any actual gating logic (task 04).
- The shared encoder (task 02 — for this task we can hand-write a sentinel string; task 02 will replace it with a typed call).
- Error UX when pi itself isn't installed (already handled in main.ts).

## Depends on

- Nothing (foundation task).

## Smoke-test notes

You can verify without Obsidian: from a terminal, run
```
cd dev-vault
pi --mode rpc --extension ./agency/extensions/agency-control.ts <<< '{"type":"prompt","message":"hi"}'
```
and observe an `extension_ui_request{method:"notify"}` line on stdout containing the `AGENCY::loaded::` sentinel.
