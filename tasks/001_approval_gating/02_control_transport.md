# 02 — Plugin ↔ extension control transport

> Codify the small custom RPC layered on top of pi's protocol. After this task, every other task in this work item has a typed, tested channel to ride on.

## Why

ARCHITECTURE §4.1 specifies a set of project-specific RPC messages (`set_autonomy_mode`, `revert_request`, `edit_made`, `mode_acknowledged`) that ride on pi's protocol "as `notify`-style payloads with a project-specific `kind` field." This task makes that concrete:

- **Plugin → extension** uses **registered slash commands** (decision D1). The plugin sends `prompt { message: "/agency-..." }`; the extension registers handlers via `pi.registerCommand`.
- **Extension → plugin** uses **sentinel-encoded `ctx.ui.notify`** (decision D2). The extension calls `ctx.ui.notify("AGENCY::<kind>::<json>", "info")`; the plugin detects the prefix and dispatches by kind.

The shared package owns the encoder, decoder, and the type union. Plugin and extension both import from there. No ad-hoc string handling in either codebase — that's a smell we explicitly avoid.

Cited: ARCHITECTURE §4.1.

## What to do

### `packages/shared/src/rpc.ts`

Replace the current draft with the codec. Keep the existing public type names (`AutonomyMode`, `EditMade`, `ModeAcknowledged`, etc.) since they're already referenced from ARCHITECTURE §4.1 — extend or rename only where the new transport requires it.

Minimal API surface to export:

```ts
export const AGENCY_SENTINEL = "AGENCY::";

export type AutonomyMode = "step-by-step" | "per-lesson" | "autonomous";

// Extension → plugin (rides on notify.message)
export type ExtensionToPluginMessage =
  | { kind: "loaded"; protocolVersion: number }
  | { kind: "mode-acknowledged"; mode: AutonomyMode; effectiveAt: string }
  | { kind: "proposal"; proposalId: string; path: string;
      operation: "create" | "modify" | "delete" | "rename";
      before: string; after: string; beforeHash: string;
      skill: string; turnId: string }
  | { kind: "edit-made"; editId: string; turnId: string; skill: string;
      operation: "create" | "modify" | "delete" | "rename";
      path: string; summary: string };

// Plugin → extension (slash commands; this is the union of payloads carried by them)
export type PluginToExtensionCommand =
  | { name: "agency-set-mode"; mode: AutonomyMode }
  | { name: "agency-revert"; editId: string };

// Codecs
export function encodeExtensionMessage(msg: ExtensionToPluginMessage): string;
export function tryDecodeExtensionMessage(notifyMessage: string): ExtensionToPluginMessage | null;
export function formatSlashCommand(cmd: PluginToExtensionCommand): string;
export function parseSlashArgs<C extends PluginToExtensionCommand["name"]>(
  name: C, argsString: string
): Extract<PluginToExtensionCommand, { name: C }> | null;

// Versioning
export const AGENCY_PROTOCOL_VERSION = 1;
```

Conventions:
- `encodeExtensionMessage` produces `AGENCY::<kind>::<JSON.stringify(rest)>` — the kind is split out so the plugin can dispatch without parsing JSON first.
- `tryDecodeExtensionMessage` returns `null` for non-sentinel messages (a plain `ctx.ui.notify("hello", "info")` from anywhere else should keep working as a plain toast).
- `formatSlashCommand({ name: "agency-set-mode", mode: "autonomous" })` returns `"/agency-set-mode autonomous"`. Args are space-separated POSIX-style; if a value contains spaces (none of our payloads do today, but `agency-revert` editIds are UUIDs so they're safe) we still mandate URL-encoding for safety.
- `parseSlashArgs` is exposed for the extension's command handlers. It accepts the raw argument string pi passes to the handler and returns the typed payload.

Add `dist/` to the package's existing build output — already configured via `packages/shared/tsconfig.json`. No new build wiring needed.

### Plugin (`packages/plugin/src/main.ts`)

1. Import the codec:
   ```ts
   import {
     AGENCY_SENTINEL,
     tryDecodeExtensionMessage,
     formatSlashCommand,
     type ExtensionToPluginMessage,
   } from "@educator-agency/shared";
   ```
2. In `handleEvent`, in the `extension_ui_request` branch, when `msg.method === "notify"`, check `msg.message?.startsWith(AGENCY_SENTINEL)`. If yes, decode and route by `kind`:
   - `loaded` → show a small "agency ready" indicator in the status bar (replaces the system-message hack from task 01).
   - `mode-acknowledged` → update the UI's mode display (task 06).
   - `proposal` → stash the proposal payload keyed by `proposalId` for later use by the diff view (task 07).
   - `edit-made` → push to the post-execution activity log (task 08).
   Unknown kinds → log to console; ignore. Forward compatibility.
3. Add a small helper `private sendControl(cmd: PluginToExtensionCommand)` that wraps `this.sendRpc({ type: "prompt", id: ..., message: formatSlashCommand(cmd) })`. The plugin should use this helper for any plugin → extension communication going forward.

### Extension (`packages/agency/extensions/agency-control.ts`)

1. Replace the hand-written `AGENCY::loaded::{}` from task 01 with the typed encoder:
   ```ts
   import { encodeExtensionMessage, AGENCY_PROTOCOL_VERSION } from "@educator-agency/shared";
   ...
   ctx.ui.notify(encodeExtensionMessage({ kind: "loaded", protocolVersion: AGENCY_PROTOCOL_VERSION }), "info");
   ```
2. Register the canonical commands (handlers are stubs in this task; real behaviour lands in 04 and 06):
   ```ts
   import { parseSlashArgs, encodeExtensionMessage } from "@educator-agency/shared";

   pi.registerCommand("agency-set-mode", {
     description: "Set the agency's autonomy mode",
     handler: async (args, ctx) => {
       const parsed = parseSlashArgs("agency-set-mode", args);
       if (!parsed) return ctx.ui.notify("Invalid mode argument", "warning");
       // Task 04 will store this; for now, just echo.
       ctx.ui.notify(
         encodeExtensionMessage({ kind: "mode-acknowledged", mode: parsed.mode, effectiveAt: new Date().toISOString() }),
         "info",
       );
     },
   });

   pi.registerCommand("agency-revert", {
     description: "Revert a prior agency-authored edit",
     handler: async (args, ctx) => {
       // Implementation deferred to the history work item; stub for now.
       ctx.ui.notify("Revert not yet implemented", "warning");
     },
   });
   ```

### Build dependency

`packages/agency/package.json` already lists `@educator-agency/shared` as a dep. The extension is loaded by jiti, which resolves through the package's `main` field — the existing `packages/shared/dist/index.js` output is what gets loaded. Make sure `npm run build` runs `packages/shared` first; it does today because of workspace ordering, but verify after this task.

## Acceptance

Run two parallel checks:

1. **Plugin → extension** (manual): from the chat view, send a textual command that the plugin maps to `formatSlashCommand({ name: "agency-set-mode", mode: "autonomous" })`. (Task 06 wires up the UI for this; for verifying this task, you can add a temporary `addCommand` to the plugin or hand-type `/agency-set-mode autonomous` in the chat input — pi recognises slash commands in the prompt directly.) Extension responds with a `mode-acknowledged` sentinel `notify`. Plugin logs it as a recognised control message (console.log is fine here; the user-visible mode display lands in 06).
2. **Extension → plugin** (automatic on session start): the `loaded` sentinel from `session_start` is decoded by the plugin and a "Agency ready (v1)" indicator appears in the status bar.

Type-check parity:
```
npm run build
```
must pass with no `tsc` errors in `packages/shared` and no `esbuild` errors in `packages/plugin`. The extension is jiti-loaded, so its type-check is implicit through editor; if `tsc --noEmit` over `packages/agency/extensions/` is desired, add that as a separate `npm run lint:agency` task — out of scope here unless trivially in reach.

## Files touched

- `packages/shared/src/rpc.ts` (rewrite into the codec)
- `packages/shared/src/index.ts` (re-export new symbols)
- `packages/plugin/src/main.ts` (import codec, decode in `handleEvent`, add `sendControl` helper)
- `packages/agency/extensions/agency-control.ts` (import codec, register stub commands)

## Out of scope

- Acting on `agency-set-mode` (task 04).
- Rendering the proposal card or diff view (tasks 05, 07).
- Rendering the post-execution activity log (task 08).
- The plugin's mode-switcher UI (task 06).
- Reverting edits (deferred to the history work item).

## Depends on

- 01 (extension must load before its commands can register).

## Notes

- `AGENCY_PROTOCOL_VERSION` is `1`. Bump it whenever the wire format changes. The plugin should log a warning if the extension's `loaded.protocolVersion` differs from its own expected version, but should not refuse to connect — semver tolerance is fine for v1.
- Pi's `docs/rpc.md` confirms that slash commands sent via `prompt` run immediately, even while the agent is streaming. We rely on this: the plugin can change the autonomy mode at any time without blocking on the LLM.
- Slash commands do not appear as user-visible chat messages (they're handled in `input`/extension-commands path). Confirm during testing that `/agency-set-mode` does not pollute the chat with a "You: /agency-set-mode autonomous" entry.
