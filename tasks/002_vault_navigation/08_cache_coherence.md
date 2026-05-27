# 08 — Cache coherence and performance hardening

> Adds the `vault_settle_cache` tool, attaches freshness metadata to all responses, and validates that bounded-limit and timeout contracts hold across the full tool surface (PRD §3.9, §3.10).

## Why

Without explicit cache settlement, an agent that writes a note and immediately queries it will read stale `MetadataCache` data — backlinks, tags, and frontmatter from before the write. PRD §3.9 requires that after a write completes, a subsequent navigation query reflects the new state. This task wires up the `metadataCache.on('changed')` event to give the agent an explicit wait point, and adds the `cacheAge` metadata field to all responses so the agent can reason about freshness without the settle tool in non-critical paths.

## What to do

### 1. Add op to `NavOp` in `packages/shared/src/navigation-rpc.ts`

```ts
| "settle_cache"
```

### 2. Add `cacheAge` to the base response shape in `packages/plugin/src/navigation/types.ts`

Add an optional field to every operation's result type at the top of the type hierarchy:

```ts
export interface NavResultMeta {
  cacheAge?: number   // ms since MetadataCache last processed the primary queried file(s)
                      // absent for vault-wide operations or when the file has never been processed
}
```

Every result type that includes file-specific data should embed `NavResultMeta`. This does not require changing every return shape immediately — add it to the base and populate it where it is cheap to compute (single-file operations: `file_metadata`, `heading_outline`, `frontmatter_get`, `note_read`, etc.).

### 3. Implement cache-age tracking in `NavigationService`

In the constructor, set up a listener:
```ts
this.app.metadataCache.on('changed', (file) => {
  this.lastChanged.set(file.path, Date.now())
})
```

`lastChanged: Map<string, number>` — updated on every cache change event. Single-file operations look up the queried path; vault-wide operations omit `cacheAge`.

Add a `cacheAgeFor(path: string): number | undefined` helper that returns `Date.now() - this.lastChanged.get(path)` or `undefined` if never seen.

### 4. Implement `settleCache({ path, timeoutMs? })`

```ts
async settleCache({ path, timeoutMs = 5000 }: { path: string; timeoutMs?: number }) {
  const file = this.app.vault.getAbstractFileByPath(path)
  if (!file) throw new NavError("not_found", `No file at path: ${path}`)

  return new Promise<{ path: string; settledAt: number }>((resolve, reject) => {
    const timer = setTimeout(() => {
      this.app.metadataCache.off('changed', handler)
      reject(new NavError("timeout", `Cache did not update for ${path} within ${timeoutMs}ms`))
    }, timeoutMs)

    const handler = (changedFile: TFile) => {
      if (changedFile.path === path) {
        clearTimeout(timer)
        this.app.metadataCache.off('changed', handler)
        resolve({ path, settledAt: Date.now() })
      }
    }
    this.app.metadataCache.on('changed', handler)
  })
}
```

Add `"settle_cache"` to the `execute` switch.

### 5. Register tool in `navigation-tools.ts`

- **`vault_settle_cache`** — params: `{ path: string; timeoutMs?: number }`. Returns `{ path, settledAt }` on success; `timeout` error if the cache does not update within `timeoutMs`.

Tool description: "Call this after writing to a note and before issuing navigation queries about that note. Returns when MetadataCache has processed the write. If the cache does not update within `timeoutMs` milliseconds (default 5000), returns a timeout error."

### 6. Validate bounded-limit contracts across the full surface

Review every listing and search method added in tasks 01–07. For each:
- Confirm that `max_results` is required in the pi tool schema (not optional).
- Confirm that the implementation rejects a call with no `max_results` with `invalid_query` — not silently applying a default.
- Confirm that `truncated: true` is set whenever the result was capped.

Fix any gaps found during review.

### 7. Document the bridge serialisation ceiling in `00_decisions.md`

Add a note under D1: measured or estimated maximum concurrent-query throughput under the serialised editor-dialog bridge, with a reference to Option B as the documented upgrade path.

## Acceptance

1. `npm run build` — no type errors.
2. Create a note via the mutation surface (or by manually saving in Obsidian). Ask the agent: "Settle the cache for `new_note.md`, then tell me its tags." — agent calls `vault_settle_cache` first; the subsequent `vault_list_tags` or `vault_notes_by_tag` returns data reflecting the new note.
3. Ask the agent to call `vault_settle_cache` on a path that doesn't exist — receives a `not_found` error.
4. Verify that `vault_frontmatter_get` on a recently-changed file includes `cacheAge` in the response and the value is plausible (< 60 000 ms in normal operation).
5. Verify that calling any listing tool without `max_results` returns `invalid_query`.

## Files touched

- `packages/plugin/src/navigation/types.ts`
- `packages/plugin/src/navigation/NavigationService.ts`
- `packages/shared/src/navigation-rpc.ts`
- `packages/agency/extensions/navigation-tools.ts`
- `tasks/002_vault_navigation/00_decisions.md` (bridge ceiling note in D1)

## Out of scope

Proactive cache invalidation notification — PRD §5 explicitly defers real-time event streams. The agent polls or uses `vault_settle_cache`; it does not subscribe.

## Depends on

Tasks 01–07.

## Notes

The `metadataCache.on('changed', ...)` listener accumulates entries in `lastChanged` for the lifetime of the plugin. On large vaults with frequent edits this map grows but remains bounded by the number of distinct files — acceptable. If the plugin is unloaded, the listener must be removed in `onunload()` to prevent a leak; add the cleanup call in `main.ts` alongside the existing `onunload` teardown.
