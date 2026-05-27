# 04 — Graph navigation

> Exposes Obsidian's link graph as queryable structure: backlinks, forward links, embeds, unresolved-link enumeration, and bounded neighbourhood traversal (PRD §3.1).

## Why

"What notes link to this one?" and "what does this note link to?" are first-class operations in Obsidian's model and completely invisible to shell tools. `MetadataCache.resolvedLinks` and `MetadataCache.unresolvedLinks` maintain this graph continuously. This task surfaces it via tools so the agent can navigate the graph without reading every file.

## What to do

### 1. Add ops to `NavOp` in `packages/shared/src/navigation-rpc.ts`

```ts
| "backlinks" | "forward_links" | "unresolved_links" | "graph_traverse"
```

### 2. Add types to `packages/plugin/src/navigation/types.ts`

```ts
export type LinkType = "wikilink" | "markdown" | "embed"
export type LinkDirection = "incoming" | "outgoing" | "both"
export type EdgeType = "link" | "embed" | "both"

export interface LinkEntry {
  sourcePath: string
  targetPath: string
  type: LinkType
  resolved: boolean
  originalText: string      // the raw link text as written
  line: number
  headingContext?: string   // nearest containing heading in the source note, if any
}

export interface UnresolvedTarget {
  target: string            // the unresolved link text
  sources: Array<{ path: string; line: number; type: LinkType }>
}

export interface GraphNode {
  path: string
  depth: number
}

export interface GraphTraverseResult {
  nodes: GraphNode[]
  edges: LinkEntry[]
  truncated: boolean
  truncatedAtDepth?: number
  truncatedAtNodeCap?: boolean
}
```

### 3. Implement in `NavigationService.ts`

**`backlinks({ path, types?, max_results, cursor? })`**

- `types`: filter to `["wikilink"]`, `["embed"]`, etc. Default: all.
- `MetadataCache` exposes `metadataCache.getBacklinksForFile(file)` — use this to get the map of source files to their link metadata.
- For each source file, read `getFileCache(source)?.links` and `getFileCache(source)?.embeds` to enrich with line numbers and `headingContext` (find the nearest preceding heading for the link's line number).
- Return `PagedResult<LinkEntry>`.

**`forwardLinks({ path, types?, includeUnresolved?, max_results, cursor? })`**

- Use `metadataCache.resolvedLinks[path]` for resolved targets and `metadataCache.unresolvedLinks[path]` for unresolved.
- Enrich from `getFileCache(file)?.links` and `.embeds` for line numbers and heading context.
- `includeUnresolved` defaults to `true`.
- Return `PagedResult<LinkEntry>`.

**`unresolvedLinks({ max_results, cursor? })`**

- Iterate `metadataCache.unresolvedLinks`. Collect all `{ target, sources[] }` entries.
- Group by target string. Return `PagedResult<UnresolvedTarget>` sorted by number of sources descending.
- This is deliberately vault-wide — no path filter. The use case is diagnostic enumeration.

**`graphTraverse({ startPath, depth, direction?, edgeTypes?, nodeCap? })`**

- `depth`: required, 1–5 (throw `invalid_query` outside this range).
- `nodeCap`: default 100, max 500.
- BFS from `startPath`. At each level, expand via `forwardLinks` / `backlinks` according to `direction` (default `"both"`) and `edgeTypes` (default `"both"`).
- Stop when `depth` levels are exhausted or `nodeCap` is reached. Set `truncated: true` and populate `truncatedAtDepth` / `truncatedAtNodeCap` accordingly.
- Return `GraphTraverseResult` — nodes and edges as flat lists with depth annotation on nodes.

### 4. Register tools in `navigation-tools.ts`

- **`vault_backlinks`** — params: `{ path: string; types?: LinkType[]; max_results: number; cursor?: string }`.
- **`vault_forward_links`** — params: `{ path: string; types?: LinkType[]; includeUnresolved?: boolean; max_results: number; cursor?: string }`.
- **`vault_unresolved_links`** — params: `{ max_results: number; cursor?: string }`.
- **`vault_graph_traverse`** — params: `{ startPath: string; depth: number; direction?: LinkDirection; edgeTypes?: EdgeType; nodeCap?: number }`.

## Acceptance

1. `npm run build` — no type errors.
2. Ask: "What notes link to `index.md`?" — agent calls `vault_backlinks`, returns entries with types and source locations.
3. Ask: "List all unresolved links in the vault." — agent calls `vault_unresolved_links`, returns grouped list; completes in under 1 second on the dev vault.
4. Ask: "Show me the 2-hop neighbourhood of `project.md` following outgoing links." — agent calls `vault_graph_traverse` with `depth: 2, direction: "outgoing"`, returns node and edge lists.
5. Verify that `vault_graph_traverse` with `depth: 6` is rejected with `invalid_query`.

## Files touched

- `packages/plugin/src/navigation/types.ts`
- `packages/plugin/src/navigation/NavigationService.ts`
- `packages/shared/src/navigation-rpc.ts`
- `packages/agency/extensions/navigation-tools.ts`

## Out of scope

Embed-content retrieval — embeds are an edge type in the graph, but reading the embedded content is a content-retrieval operation (task 03). This task exposes embed *references*, not embed *content*.

## Depends on

Task 01.

## Notes

`metadataCache.getBacklinksForFile(file)` returns a `CustomArrayDict` — iterate with `.data` to get the underlying map. The heading-context enrichment (finding the nearest preceding heading for a link's line number) reuses the heading-outline logic from task 02. If task 02 is not yet landed, stub `headingContext` as `undefined` and fill it in when 02 merges.
