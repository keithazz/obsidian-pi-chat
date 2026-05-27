# 002 — Vault-Aware Navigation

Implements the read-only navigation primitive over an Obsidian vault described in PRD §3 (all subsections). Exposes Obsidian's native model — links, embeds, tags, frontmatter, headings, blocks — as a set of pi tools the LLM agent can call directly. The navigation layer lives in the plugin (access to `App`, `Vault`, and `MetadataCache`) and is bridged to the pi extension via the Option A editor-dialog RPC decided in `00_decisions.md`.

End state of this work item:
- `NavigationService` is instantiated in the plugin and answers queries sourced from `MetadataCache` and the vault filesystem view.
- 23 pi tools are registered in `navigation-tools.ts` covering file structure, graph, tags, frontmatter, structure, content, search, and cache coherence.
- The extension→plugin query bridge (Option A, D1) is in place and exercised by all tools.
- All tool outputs use stable vault-relative identifiers (`path`, `path#heading`, `path#^block`) passable directly as inputs to other tools.
- All listing operations are paginated and bounded; truncation is always reported, never silent.
- A `vault_settle_cache` tool lets the agent explicitly wait for `MetadataCache` to reflect a recent write before issuing further navigation queries.

## Decision doc

- [00_decisions.md](./00_decisions.md) — read this first. Records the extension→plugin bridge design, identifier conventions, error model, expression language choice, and pagination approach.

## Tasks in dependency order

| # | File | Touches | Depends on |
|---|---|---|---|
| 01 | [01_navigation_service.md](./01_navigation_service.md) | `NavigationService.ts`, `identifiers.ts`, `errors.ts`, `types.ts`, `navigation-rpc.ts`, `navigation-tools.ts`, `main.ts` | — |
| 02 | [02_structural_queries.md](./02_structural_queries.md) | `NavigationService.ts`, `navigation-tools.ts`, `navigation-rpc.ts` | 01 |
| 03 | [03_content_retrieval.md](./03_content_retrieval.md) | `NavigationService.ts`, `navigation-tools.ts`, `navigation-rpc.ts` | 01, 02 |
| 04 | [04_graph_navigation.md](./04_graph_navigation.md) | `NavigationService.ts`, `navigation-tools.ts`, `navigation-rpc.ts` | 01 |
| 05 | [05_tag_queries.md](./05_tag_queries.md) | `NavigationService.ts`, `navigation-tools.ts`, `navigation-rpc.ts` | 01 |
| 06 | [06_frontmatter_queries.md](./06_frontmatter_queries.md) | `NavigationService.ts`, `navigation-tools.ts`, `navigation-rpc.ts` | 01 |
| 07 | [07_lexical_search.md](./07_lexical_search.md) | `NavigationService.ts`, `navigation-tools.ts`, `navigation-rpc.ts` | 01, 02 |
| 08 | [08_cache_coherence.md](./08_cache_coherence.md) | `NavigationService.ts`, `navigation-tools.ts`, `navigation-rpc.ts`, `types.ts` | 01–07 |

Tasks 02–07 are fully parallel after 01 lands. Task 08 is a hardening pass once all capability tasks are complete.

## What's explicitly deferred

- **Semantic / embedding search** — out of scope per PRD §5. If added later, layers on top of this navigation surface.
- **Writes, renames, deletes** — read-only guarantee (PRD §3.11). Mutation belongs in `tasks/003_*` or equivalent.
- **Cross-vault queries** — single vault only per PRD §5.
- **Non-markdown attachment content** — metadata listed, content not extracted per PRD §5.
- **Option B async bridge** — if concurrency becomes a bottleneck (multiple simultaneous nav queries queuing behind the serialised editor-dialog), replace `queryPlugin` with the notify+slash-command correlation pattern described in `00_decisions.md §D1`.
- **Excerpt extraction policy** (PRD §3.7 token-budget excerpt) — deferred pending real agent usage data. Not in any task file.

## How to verify end-to-end

After all eight tasks are complete:

1. `npm run build && npm run link-dev-vault`. Open `dev-vault/` in Obsidian; enable Pi Chat.
2. Ask: "List all notes in the vault." — agent calls `vault_note_list`, returns structured list with paths and metadata.
3. Ask: "What notes link to `index.md`?" — agent calls `vault_backlinks`, returns backlink list with link types and source locations.
4. Ask: "Find all notes tagged `#topic` that have a frontmatter field `status: draft`." — agent calls `vault_notes_by_tag` then `vault_query_frontmatter` (or composes them).
5. Ask: "Read just the 'Summary' section of `project.md`." — agent calls `vault_heading_outline` then `vault_read_section`; only that section's content is returned.
6. Ask: "Find all unresolved links in the vault." — agent calls `vault_unresolved_links`; completes in under 1 second on the dev vault.
7. Create a note via the mutation surface (or manually), then ask a navigation question about it — agent calls `vault_settle_cache` first, then queries; response reflects the new note.
8. Ask: "Search for 'TODO' in all note bodies." — agent calls `vault_search` with `max_results`; returns matching lines with context.
