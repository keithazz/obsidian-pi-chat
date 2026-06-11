# Vault navigation API (reference)

> Reference doc — **must track the code.** This is the read-only vault-navigation tool
> surface. Product intent lives in [`docs/product/02-vault-navigation.md`](../product/02-vault-navigation.md).
>
> **⚠️ DRAFT — seeded from code during workflow bootstrap, not yet maintainer-verified.**
> Reconstructed from `packages/shared/src/navigation-rpc.ts` and
> `packages/plugin/src/navigation/types.ts`. Verify against the implementation before
> relying on it, and keep it in sync in the same PR as any change to those files.

## Transport

Navigation rides on pi's notify stream as sentinel-prefixed JSON, defined in
`packages/shared/src/navigation-rpc.ts`:

- Query encoding prefix: `AGENCY::nav-query::` (`encodeNavQuery` / `decodeNavQuery`).
- A query is `{ queryId, op, params }` (`NavQuery`); a response is
  `{ queryId, result?, error? }` (`NavResponse`).
- Errors are `{ kind, message }` (`NavError`) where `kind` ∈
  `not_found | ambiguous | invalid_query | truncated | timeout | query_cancelled`.

## Operations (`NavOp`)

| Group | Ops |
|---|---|
| File / folder structure | `file_metadata`, `folder_list`, `note_list`, `attachment_list` |
| Structural (within a note) | `heading_outline`, `block_resolve`, `heading_search` |
| Content retrieval | `note_read`, `section_read`, `block_read`, `lines_read` |
| Graph | `backlinks`, `forward_links`, `unresolved_links`, `graph_traverse` |
| Tags | `list_tags`, `notes_by_tag`, `query_tags` |
| Frontmatter | `frontmatter_get`, `query_frontmatter` |
| Lexical search | `search` |
| Cache | `settle_cache` |

## Query expression shapes

**Tag expressions** (`TagExpr`) — `{ op: "tag", value, match? }` with `match ∈ exact | prefix`,
combined via `and` / `or` / `not`.

**Frontmatter expressions** (`FmExpr`) — leaf predicates
`exists | eq | neq | gt | gte | lt | lte | in | contains | contains_all | intersects | regex`
over a `field`, combined via `and` / `or` / `not`. Scalar type is
`FmScalar = string | number | boolean | null`.

## Result shapes (selected, from `plugin/src/navigation/types.ts`)

- **`FileMetadata`** — `path, name, parent, type ("note"|"attachment"), created, modified, size`.
  `NoteFileMetadata` adds `linkCountIn`, `linkCountOut`; `FolderEntry` adds `childCount?`.
- **Paging** — `PagedResult<T>` = `{ items, total?, nextCursor?, truncated }`.
- **Headings** — `HeadingNode` = `{ level, text, line, endLine, id, children[] }` (a tree).
  `BlockRef`, `HeadingSearchHit` carry `notePath`/`heading`/`line`/`id`.
- **Content reads** — `NoteReadResult`, `SectionReadResult`, `BlockReadResult`,
  `LinesReadResult`, each extending `NavResultMeta { cacheAge? }`. `FrontmatterInclude ∈ raw | parsed | omit`.
- **Tags** — `TagEntry { tag, instanceCount, noteCount }`, `TagInstance { notePath, source, line? }`,
  `TagSource ∈ frontmatter | inline`.
- **Frontmatter** — `FrontmatterResult { path, fields }`, `FmQueryHit { path, fields, modified }`,
  `FmValue = FmScalar | FmScalar[]`.
- **Search** — `SearchMatch { notePath, line, field, matchedText, contextBefore, contextAfter }`;
  `SearchField ∈ body | headings | frontmatter | code_blocks | path`;
  `SearchSort ∈ mtime_desc | mtime_asc | link_count_desc | path_asc`;
  `SearchResult` = paged + `timedOut`.
- **Graph** — `LinkEntry { sourcePath, targetPath, type, resolved, originalText, line, headingContext? }`
  with `LinkType ∈ wikilink | markdown | embed`; `UnresolvedTarget`; `GraphNode { path, depth }`;
  `GraphTraverseResult { nodes, edges, truncated, truncatedAtDepth?, truncatedAtNodeCap? }`.
  `LinkDirection ∈ incoming | outgoing | both`, `EdgeType ∈ link | embed | both`.

## Invariants

- **Read-only.** No navigation op mutates the vault, cache, or settings
  (product §3.11). Safe to compose and to expose to less-trusted callers.
- **Mirror Obsidian's model.** Served from `MetadataCache`; identifiers and normalisation
  match Obsidian's own (paths for notes, `path#heading`, `path#^block`). See product §4.
- **Bounded outputs.** Listing/search ops require explicit limits and report `truncated`.
