# 02 — Structural queries

> Exposes a note's internal structure — heading tree, sections, block references, and cross-note heading search — as queryable operations backed by `MetadataCache`.

## Why

Agents reading long notes today must `vault_read` the full file and locate sections by scanning prose. This is token-expensive and brittle (depends on accidental formatting). `MetadataCache` already has the heading tree and block ID map; this task surfaces them as first-class operations and provides the section-boundary resolution that task 03's `vault_read_section` depends on.

## What to do

### 1. Add types to `packages/plugin/src/navigation/types.ts`

```ts
export interface HeadingNode {
  level: number          // 1–6
  text: string
  line: number           // 0-indexed line of the heading itself
  endLine: number        // last line of this section (exclusive), before next equal-or-higher heading
  id: string             // toSectionId(path, text)
  children: HeadingNode[]
}

export interface BlockRef {
  blockId: string        // the ^block-id string without caret
  id: string             // toBlockId(path, blockId)
  line: number
  headingContext?: string // nearest containing heading text, if any
}

export interface HeadingSearchHit {
  notePath: string
  heading: string
  level: number
  line: number
  id: string             // toSectionId(notePath, heading)
}
```

### 2. Add ops to `NavOp` in `packages/shared/src/navigation-rpc.ts`

```ts
export type NavOp =
  | ... // existing
  | "heading_outline" | "block_resolve" | "heading_search"
```

### 3. Implement in `NavigationService.ts`

**`headingOutline({ path })`**

1. Resolve the file via `app.vault.getAbstractFileByPath(path)` — throw `not_found` if missing.
2. Call `app.metadataCache.getFileCache(file)?.headings ?? []`.
3. Build a tree: iterate the flat heading list, using a stack keyed on level. For each heading, compute `endLine` by looking ahead to the next heading of equal or lower level number (or end-of-file from `file.stat.size` proxy — use the next heading's `position.start.line - 1`, or the note's last line for the final heading).
4. Return `{ path, outline: HeadingNode[] }`.

**`blockResolve({ path, blockId? })`**

- If `blockId` provided: look up `app.metadataCache.getFileCache(file)?.blocks?.[blockId]`. Throw `not_found` if absent. Find the nearest preceding heading for `headingContext`.
- If no `blockId`: return all blocks in the note as `BlockRef[]`.
- Return `{ path, blocks: BlockRef[] }`.

**`headingSearch({ query, matchType?, max_results, cursor? })`**

- `matchType`: `"substring"` (default), `"exact"`, `"regex"`.
- Iterate `app.vault.getMarkdownFiles()`. For each, call `getFileCache(file)?.headings`. Filter headings where `text` matches `query` according to `matchType`.
- Return `PagedResult<HeadingSearchHit>`.
- Regex: compile with `new RegExp(query)` inside a `try/catch`; throw `invalid_query` on invalid pattern.

### 4. Register tools in `navigation-tools.ts`

- **`vault_heading_outline`** — params: `{ path: string }`. Returns the heading tree.
- **`vault_section_get`** — params: `{ path: string; heading: string }`. Convenience wrapper: calls `headingOutline`, finds the matching `HeadingNode` (throw `not_found` / `ambiguous` if zero or multiple matches), returns `{ path, heading, startLine, endLine, id }`. Task 03 uses this to resolve the line range for `vault_read_section`.
- **`vault_block_resolve`** — params: `{ path: string; blockId?: string }`. Returns single block or all blocks.
- **`vault_heading_search`** — params: `{ query: string; matchType?: "substring"|"exact"|"regex"; max_results: number; cursor?: string }`.

## Acceptance

1. `npm run build` — no type errors.
2. Ask: "Show me the outline of `project.md`." — agent calls `vault_heading_outline`, returns nested heading tree.
3. Ask: "Find all notes with a heading containing 'Summary'." — agent calls `vault_heading_search`, returns hits with note paths and line numbers.
4. Ask: "What block IDs are defined in `notes.md`?" — agent calls `vault_block_resolve` without a blockId, returns all defined blocks.

## Files touched

- `packages/plugin/src/navigation/types.ts`
- `packages/plugin/src/navigation/NavigationService.ts`
- `packages/shared/src/navigation-rpc.ts`
- `packages/agency/extensions/navigation-tools.ts`

## Out of scope

Reading section *content* — that is task 03 (`vault_read_section`), which uses the line range from `vault_section_get`.

## Depends on

Task 01.

## Notes

`endLine` computation for the last heading in a file requires knowing the total line count. Use `(await app.vault.read(file)).split('\n').length - 1` as a one-time read to get the line count, or derive from `file.stat.size` as a heuristic (acceptable imprecision for structural queries only). The former is more correct but async — consistent with the note in task 01 about making `execute` async.
