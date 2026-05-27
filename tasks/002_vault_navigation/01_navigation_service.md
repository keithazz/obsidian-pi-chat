# 01 — NavigationService skeleton, file/folder structure, bridge

> Lays the foundation for all navigation tasks. Introduces the NavigationService class, the extension→plugin bridge, and implements the §3.6 file/folder operations as the first exercised capability.

## Why

No navigation tooling exists today. The agent can only see the vault through `read`, `ls`, and `find` — shell tools with no awareness of Obsidian's model. This task creates the scaffolding every subsequent task builds on, and validates the bridge end-to-end before any later capability depends on it.

## What to do

### 1. Create `packages/shared/src/navigation-rpc.ts`

Define the `NavQuery` / `NavResponse` message shapes and the sentinel codec:

```ts
export type NavOp =
  | "file_metadata" | "folder_list" | "note_list" | "attachment_list"
  // later tasks add more entries here

export interface NavQuery { queryId: string; op: NavOp; params: unknown }
export interface NavResponse { queryId: string; result?: unknown; error?: NavError }

export function encodeNavQuery(q: NavQuery): string {
  return `AGENCY::nav-query::${JSON.stringify(q)}`
}
export function decodeNavQuery(s: string): NavQuery {
  return JSON.parse(s.slice("AGENCY::nav-query::".length))
}
```

Also export the `NavErrorKind` union and `NavError` shape (these are serialised over the bridge, so they live in shared rather than in the plugin).

### 2. Create `packages/plugin/src/navigation/errors.ts`

```ts
export type NavErrorKind = "not_found" | "ambiguous" | "invalid_query" | "truncated" | "timeout" | "query_cancelled"
export class NavError extends Error {
  constructor(public kind: NavErrorKind, message: string) { super(message) }
}
```

### 3. Create `packages/plugin/src/navigation/identifiers.ts`

Exports: `toSectionId(path, heading): string`, `toBlockId(path, blockId): string`, `toLineId(path, line): string`, `parseNavId(id): { path: string; fragment?: string; synthetic?: boolean }`.

Follow Obsidian's heading canonicalisation: trim whitespace, collapse internal runs of whitespace to single space. Do not lowercase. Use `#^` prefix for block IDs, `#L` prefix for synthetic line IDs.

### 4. Create `packages/plugin/src/navigation/types.ts`

Shared result shapes used across tasks — define incrementally as tasks land. For this task, define:

```ts
export interface FileMetadata {
  path: string; name: string; parent: string
  type: "note" | "attachment"
  created: number; modified: number; size: number
}
export interface FolderEntry extends FileMetadata { childCount?: number }
export interface PagedResult<T> {
  items: T[]
  total?: number
  nextCursor?: string
  truncated: boolean
}
```

### 5. Create `packages/plugin/src/navigation/NavigationService.ts`

```ts
export class NavigationService {
  constructor(private app: App) {}

  execute(op: NavOp, params: unknown): unknown {
    switch (op) {
      case "file_metadata":   return this.fileMetadata(params as FileMetadataParams)
      case "folder_list":     return this.folderList(params as FolderListParams)
      case "note_list":       return this.noteList(params as NoteListParams)
      case "attachment_list": return this.attachmentList(params as AttachmentListParams)
      default: throw new NavError("invalid_query", `Unknown op: ${op}`)
    }
  }
```

Implement the four §3.6 methods:

- **`fileMetadata({ path })`** — resolve via `app.vault.getAbstractFileByPath(path)`. Return `FileMetadata`. Throw `not_found` if absent, `ambiguous` if short-path resolves to multiple.
- **`folderList({ path, cursor?, max_results })`** — use `TFolder.children`. Recurse one level only. Return `PagedResult<FolderEntry>` with `childCount` for subfolders (total descendants, cheap from `TFolder`). Reject missing `max_results` with `invalid_query`.
- **`noteList({ glob?, cursor?, max_results, sort? })`** — `app.vault.getMarkdownFiles()`, filter by glob if provided, sort by mtime desc (default), page with opaque cursor. Return `PagedResult<FileMetadata>` with `linkCountIn` and `linkCountOut` from `MetadataCache.resolvedLinks`.
- **`attachmentList({ folder?, cursor?, max_results })`** — `app.vault.getFiles()` minus markdown files. Same paging contract.

### 6. Wire the bridge into `packages/plugin/src/main.ts`

Instantiate `NavigationService` when the plugin loads:
```ts
this.navigationService = new NavigationService(this.app)
```

In the `extension_ui_request` handler, add a check *before* the existing proposal-view path:
```ts
if (request.prefill?.startsWith("AGENCY::nav-query::")) {
  const query = decodeNavQuery(request.prefill)
  let response: NavResponse
  try {
    const result = this.navigationService.execute(query.op, query.params)
    response = { queryId: query.queryId, result }
  } catch (e) {
    const kind = e instanceof NavError ? e.kind : "invalid_query"
    response = { queryId: query.queryId, error: { kind, message: String(e) } }
  }
  this.sendEditorResponse(request.id, { value: JSON.stringify(response) })
  return
}
```

### 7. Create `packages/agency/extensions/navigation-tools.ts`

Implement `queryPlugin`:
```ts
async function queryPlugin(op: NavOp, params: unknown, ctx: Context): Promise<unknown> {
  const queryId = crypto.randomUUID()
  const prefill = encodeNavQuery({ queryId, op, params })
  const resp = await ctx.ui.editor({ title: "AGENCY::nav-query", prefill })
  if (resp.cancelled) throw new NavError("query_cancelled", "Bridge cancelled")
  const parsed: NavResponse = JSON.parse(resp.value)
  if (parsed.error) throw new NavError(parsed.error.kind, parsed.error.message)
  return parsed.result
}
```

Register the four §3.6 tools using `pi.registerTool`. Each tool's `execute` calls `queryPlugin` with the appropriate op and passes `input` as params. Tool schemas (JSON Schema) must include `max_results` as required for listing tools.

Export a `registerNavigationTools(pi, ctx)` function called from `agency-control.ts` on `session_start`.

## Acceptance

1. `npm run build` — no type errors.
2. Open dev-vault in Obsidian. Ask the agent: "List the files in the vault root." It should call `vault_folder_list` and return a structured list.
3. Ask: "Get metadata for `index.md`." It should call `vault_file_metadata` and return path, type, size, timestamps.
4. Confirm no editor dialog is shown to the user during either call.

## Files touched

- `packages/shared/src/navigation-rpc.ts` (new)
- `packages/plugin/src/navigation/errors.ts` (new)
- `packages/plugin/src/navigation/identifiers.ts` (new)
- `packages/plugin/src/navigation/types.ts` (new)
- `packages/plugin/src/navigation/NavigationService.ts` (new)
- `packages/plugin/src/main.ts` (modified — instantiation + bridge handler)
- `packages/agency/extensions/navigation-tools.ts` (new)
- `packages/agency/extensions/agency-control.ts` (modified — call `registerNavigationTools` on session_start)

## Out of scope

All other `NavOp` values. The `execute` switch will throw `invalid_query` for any op not yet implemented — this is correct behaviour, not a stub.

## Depends on

Nothing. This is the root task.

## Notes

The `execute` method is synchronous in this task. Tasks 03 and 08 will make some methods async (vault file reads and cache-settle). When that happens, `execute` must become `async execute(...)` and the plugin's bridge handler must `await` it. Design the switch statement with this in mind — returning `Promise<unknown>` from the start avoids a two-step refactor.
