# 03 — Content retrieval

> Implements the four read operations from PRD §3.7: full note read, section read, block read, and line-range read.

## Why

The agent currently uses pi's built-in `read` tool, which returns the entire file as a flat string with no structure. For long notes, reading a section or a block this way burns unnecessary tokens. This task provides scoped reads that return exactly what the agent asked for and nothing more, using the structural primitives from task 02 to resolve section and block boundaries.

## What to do

### 1. Add ops to `NavOp` in `packages/shared/src/navigation-rpc.ts`

```ts
| "note_read" | "section_read" | "block_read" | "lines_read"
```

### 2. Add types to `packages/plugin/src/navigation/types.ts`

```ts
export type FrontmatterInclude = "raw" | "parsed" | "omit"

export interface NoteReadResult {
  path: string
  content: string               // body only (frontmatter stripped or included per request)
  frontmatter?: string | Record<string, unknown>  // present unless include === "omit"
  lineCount: number
}

export interface SectionReadResult {
  path: string
  heading: string
  startLine: number
  endLine: number
  content: string
}

export interface BlockReadResult {
  path: string
  blockId: string
  content: string
  headingContext?: string
}
```

### 3. Implement in `NavigationService.ts`

All four methods are `async` (they call `app.vault.read()`).

**`noteRead({ path, frontmatter? })`**

- `frontmatter`: `"raw"` (default) | `"parsed"` | `"omit"`.
- Read the file with `app.vault.read(file)`.
- Split frontmatter from body: frontmatter is the YAML block between the first `---` and the second `---` on their own lines, if present. Use a simple split rather than a YAML parser — the `MetadataCache` already parsed the frontmatter; if `parsed` is requested, return `app.metadataCache.getFileCache(file)?.frontmatter ?? {}`.
- Return `NoteReadResult`.

**`sectionRead({ path, heading })`**

- Call `headingOutline({ path })` to get the tree.
- Find the node whose `text` matches `heading` (case-insensitive trim match). Throw `not_found` or `ambiguous` as appropriate.
- Read the file, split by lines, return lines `[node.line .. node.endLine]` (inclusive). Strip the heading line itself from `content` only if the caller requests it — default is to include the heading so the agent has context.
- Return `SectionReadResult`.

**`blockRead({ path, blockId })`**

- Call `blockResolve({ path, blockId })` — throw `not_found` if absent.
- Read the file, extract the line(s) of the block. Blocks are single paragraphs; return the full paragraph containing the block ID (lines up to the next blank line or heading).
- Return `BlockReadResult`.

**`linesRead({ path, startLine, endLine })`**

- Validate `startLine >= 0`, `endLine >= startLine`, `endLine - startLine <= 500` (cap; throw `invalid_query` if exceeded).
- Read file, return the requested slice as a string.
- Return `{ path, startLine, endLine, content: string }`.

### 4. Register tools in `navigation-tools.ts`

- **`vault_read`** — params: `{ path: string; frontmatter?: "raw"|"parsed"|"omit" }`. Full note read.
- **`vault_read_section`** — params: `{ path: string; heading: string }`. Section read.
- **`vault_read_block`** — params: `{ path: string; blockId: string }`. Block read.
- **`vault_read_lines`** — params: `{ path: string; startLine: number; endLine: number }`. Line-range read.

## Acceptance

1. `npm run build` — no type errors.
2. Ask: "Read the 'Goals' section of `project.md`." — agent calls `vault_read_section`; only that section's lines are returned.
3. Ask: "Read the note `short.md` with frontmatter as parsed data." — agent calls `vault_read` with `frontmatter: "parsed"`, receives body and structured frontmatter object.
4. Ask: "Read lines 10 to 20 of `long.md`." — agent calls `vault_read_lines`, receives exactly those lines.
5. Verify that `vault_read_lines` rejects a range wider than 500 lines with an `invalid_query` error.

## Files touched

- `packages/plugin/src/navigation/types.ts`
- `packages/plugin/src/navigation/NavigationService.ts`
- `packages/shared/src/navigation-rpc.ts`
- `packages/agency/extensions/navigation-tools.ts`

## Out of scope

Token-budgeted excerpt extraction (PRD §3.7 last bullet) — deferred per `00_decisions.md §Deferred`.

## Depends on

Tasks 01, 02 (section and block reads delegate to structural methods).

## Notes

`app.vault.read()` is async and returns the full file string each call. There is no partial-read API. For very large notes, `vault_read_lines` still reads the whole file and slices — this is consistent with Obsidian's own model and matches the PRD's "memory envelope" constraint (§3.10: "operate on the in-memory representation Obsidian already maintains").
