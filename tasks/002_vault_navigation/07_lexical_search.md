# 07 — Lexical search

> Full-text substring and regex search over vault content with field scoping, path-glob filtering, configurable ranking, and per-query timeout (PRD §3.5).

## Why

Structured queries cover everything that has structure. Lexical search covers everything that doesn't: free-text patterns, content the agent hasn't seen yet, ad-hoc keyword lookups. It is the indispensable fallback and the one operation where the agent truly has to touch file content at scale. Without a bounded, scoped interface the agent would issue repeated `vault_read` calls until it found what it needed — expensive and easily infinite.

## What to do

### 1. Add op to `NavOp` in `packages/shared/src/navigation-rpc.ts`

```ts
| "search"
```

### 2. Add types to `packages/plugin/src/navigation/types.ts`

```ts
export type SearchField = "body" | "headings" | "frontmatter" | "code_blocks" | "path"
export type SearchSort  = "mtime_desc" | "mtime_asc" | "link_count_desc" | "path_asc"

export interface SearchMatch {
  notePath: string
  line: number
  field: SearchField
  matchedText: string     // the exact matched span
  contextBefore: string   // `contextLines` lines before the match
  contextAfter:  string   // `contextLines` lines after the match
}

export interface SearchResult {
  items: SearchMatch[]
  total?: number
  nextCursor?: string
  truncated: boolean
  timedOut: boolean       // true if the timeout was hit before the full corpus was scanned
}
```

### 3. Implement in `NavigationService.ts`

**`search({ query, isRegex?, fields?, glob?, sort?, contextLines?, timeoutMs?, max_results, cursor? })`**

Parameters:
- `query`: the search string or pattern.
- `isRegex`: default `false`. If `true`, compile `new RegExp(query, "gm")` — throw `invalid_query` on compilation failure.
- `fields`: default `["body", "headings"]`. `"frontmatter"` searches serialised YAML values; `"code_blocks"` restricts to fenced code; `"path"` searches the vault-relative file path only.
- `glob`: path-glob filter applied before reading any file content. Implement with a simple `minimatch`-style match (Obsidian bundles no glob lib; implement a minimal `**` and `*` wildcard expander or use a small helper).
- `sort`: default `"mtime_desc"`. Sort the candidate file list before searching so the first `max_results` hits come from the most relevant files.
- `contextLines`: default `2`, max `10`. Lines of surrounding context included in each hit.
- `timeoutMs`: default `5000`, max `30000`. If the scan has not completed within this window, stop, set `timedOut: true`, and return partial results.
- `max_results`: required; unbounded queries rejected with `invalid_query`.
- `cursor`: opaque offset into the sorted file list (not into a results list — pagination here restarts the scan from a file offset).

Implementation:

1. Build the candidate file list: `app.vault.getMarkdownFiles()`, filter by `glob` if provided, sort by `sort`.
2. Start a `Date.now()` timer.
3. For each candidate file (respecting cursor offset):
   a. Check timeout — if elapsed > `timeoutMs`, set `timedOut: true` and break.
   b. Read with `app.vault.read(file)` (async).
   c. Split into lines. For each field in `fields`, extract the relevant lines:
      - `body`: all non-frontmatter, non-heading lines.
      - `headings`: lines matching `/^#{1,6} /`.
      - `frontmatter`: lines between the opening and closing `---` delimiters.
      - `code_blocks`: lines inside fenced ` ``` ` blocks.
      - `path`: match against `file.path` directly (no line scanning needed).
   d. Apply the query (substring `line.includes(query)` or regex `pattern.test(line)`).
   e. For each match, build a `SearchMatch` with context.
   f. Stop accumulating hits once `max_results` is reached — set `truncated: true`.
4. Return `SearchResult`.

### 4. Register tool in `navigation-tools.ts`

- **`vault_search`** — params:
  ```ts
  {
    query: string
    isRegex?: boolean
    fields?: SearchField[]
    glob?: string
    sort?: SearchSort
    contextLines?: number
    timeoutMs?: number
    max_results: number
    cursor?: string
  }
  ```
  Tool description must emphasise: `max_results` is required; unbounded calls will be rejected. Mention that `timedOut: true` in the response means partial results — the agent should either narrow the query or accept partial results.

## Acceptance

1. `npm run build` — no type errors.
2. Ask: "Search for 'TODO' in all note bodies." — agent calls `vault_search` with `max_results: 20`; returns matches with line numbers and context.
3. Ask: "Search for the regex `\\d{4}-\\d{2}-\\d{2}` in frontmatter." — agent calls `vault_search` with `isRegex: true, fields: ["frontmatter"]`; returns date-like strings.
4. Ask: "Search for 'api' only in notes under `projects/`." — agent passes `glob: "projects/**"`.
5. Verify that calling `vault_search` without `max_results` returns an `invalid_query` error.
6. Verify that `timedOut: true` appears when `timeoutMs: 1` is passed (artificially low timeout).

## Files touched

- `packages/plugin/src/navigation/types.ts`
- `packages/plugin/src/navigation/NavigationService.ts`
- `packages/shared/src/navigation-rpc.ts`
- `packages/agency/extensions/navigation-tools.ts`

## Out of scope

Semantic / embedding search (PRD §5). BM25 or other relevance ranking — `sort` options are structural properties (mtime, link count, path), not relevance scores.

## Depends on

Tasks 01, 02 (heading-line detection reuses the heading-regex pattern from structural queries).

## Notes

Reading every file for a full-vault regex search is O(vault size). For the dev vault (small) this is fine. For large vaults the timeout is the safety valve — not a correctness mechanism but a practical bound. The sort-before-scan approach means the most-useful files (by mtime or link count) are hit first, so partial results under timeout are more useful than a random sample. The `cursor` pagination restarts scanning from a file-list offset, not from a character offset within files — this means a paginated search can miss hits in files that appear before the cursor if those files changed between pages. This is documented behaviour, not a bug.
