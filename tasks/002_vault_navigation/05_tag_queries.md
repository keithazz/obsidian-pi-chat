# 05 — Tag queries

> Exposes Obsidian's tag model as queryable operations: vault-wide enumeration, nested-tag matching, notes-by-tag lookup, and boolean tag expressions (PRD §3.2).

## Why

Tags are one of Obsidian's primary organisational primitives. An agent that can't query them must resort to full-text search for `#tag` strings — fragile, slow, and insensitive to Obsidian's nested-tag semantics (`#topic` matching `#topic/subtopic`). `MetadataCache` maintains a complete tag index; this task surfaces it.

## What to do

### 1. Add ops to `NavOp` in `packages/shared/src/navigation-rpc.ts`

```ts
| "list_tags" | "notes_by_tag" | "query_tags"
```

### 2. Add types to `packages/plugin/src/navigation/types.ts`

```ts
export type TagSource = "frontmatter" | "inline"
export type TagMatch = "exact" | "prefix"

export interface TagEntry {
  tag: string             // normalised, without leading #
  instanceCount: number   // total occurrences across the vault
  noteCount: number       // distinct notes carrying this tag
}

export interface TagInstance {
  notePath: string
  source: TagSource
  line?: number           // present for inline tags; absent for frontmatter tags
}

export interface NoteTagResult {
  path: string
  tags: Array<{ tag: string; source: TagSource; line?: number }>
  modified: number
}

// Tag expression — see 00_decisions.md §D4
export type TagExpr =
  | { op: "tag";  value: string; match?: TagMatch }
  | { op: "and";  operands: TagExpr[] }
  | { op: "or";   operands: TagExpr[] }
  | { op: "not";  operand:  TagExpr }
```

Export `TagExpr` from `packages/shared/src/navigation-rpc.ts` so the tool schema in the extension can reference it.

### 3. Implement in `NavigationService.ts`

**`listTags({ prefix?, max_results, cursor? })`**

- Iterate all markdown files. For each, call `getFileCache(file)?.tags` (inline tags) and extract tags from `getFileCache(file)?.frontmatter?.tags` (frontmatter tags).
- Accumulate a `Map<string, { instances: number; notes: Set<string> }>`.
- Normalise tags: strip leading `#`, lowercase.
- Filter by `prefix` if provided (same normalisation).
- Sort by `instanceCount` descending. Page with opaque cursor.
- Return `PagedResult<TagEntry>`.

**`notesByTag({ tag, match?, source?, max_results, cursor? })`**

- `match`: `"exact"` | `"prefix"` (default).
- Prefix match: `normalisedTag.startsWith(normalise(query) + "/") || normalisedTag === normalise(query)`.
- `source`: filter to `"frontmatter"` or `"inline"` only, or both (default).
- For each matching note, return `NoteTagResult` with all matching tag instances and their sources.
- Return `PagedResult<NoteTagResult>`.

**`queryTags({ expr, max_results, cursor? })`**

- Evaluate `TagExpr` against each note in the vault.
- Implement `evalTagExpr(expr: TagExpr, noteTags: Set<string>): boolean`:
  - `tag` leaf: check exact or prefix match against `noteTags`.
  - `and` / `or` / `not`: recurse.
- Validate the expression shape before evaluating (depth cap of 8, max 20 leaf nodes) — throw `invalid_query` if exceeded.
- Return `PagedResult<NoteTagResult>` for notes where the expression evaluates to true.

### 4. Register tools in `navigation-tools.ts`

- **`vault_list_tags`** — params: `{ prefix?: string; max_results: number; cursor?: string }`. Returns all tags with counts.
- **`vault_notes_by_tag`** — params: `{ tag: string; match?: TagMatch; source?: TagSource; max_results: number; cursor?: string }`. Returns notes carrying a tag.
- **`vault_query_tags`** — params: `{ expr: TagExpr; max_results: number; cursor?: string }`. Boolean tag expression over the vault.

Include the `TagExpr` type definition inline in the `vault_query_tags` tool's JSON schema description so the LLM can construct valid expressions without prior context.

## Acceptance

1. `npm run build` — no type errors.
2. Ask: "List all tags in the vault with their usage counts." — agent calls `vault_list_tags`, returns sorted tag list.
3. Ask: "Find notes tagged `#project`." — agent calls `vault_notes_by_tag`; result includes notes tagged `#project/active` and `#project/archived` (prefix match).
4. Ask: "Find notes tagged `#draft` but not `#archived`." — agent calls `vault_query_tags` with an AND/NOT expression; returns matching notes.
5. Verify that frontmatter-only vs inline-only source filtering works on a note that has both.

## Files touched

- `packages/plugin/src/navigation/types.ts`
- `packages/plugin/src/navigation/NavigationService.ts`
- `packages/shared/src/navigation-rpc.ts`
- `packages/agency/extensions/navigation-tools.ts`

## Out of scope

Frontmatter field queries — that is task 06. Tag queries here are purely about the tag index, not about general frontmatter predicates.

## Depends on

Task 01.

## Notes

Obsidian normalises tag strings to lowercase in `MetadataCache`. Strip the leading `#` when comparing — `getFileCache()?.tags` returns entries like `{ tag: "#topic/subtopic", position: ... }` with the `#` included. The `normalise` helper should strip `#` and lowercase consistently. Frontmatter `tags:` may be a string or an array in the YAML; `MetadataCache` normalises this — use the cache value, not raw YAML.
