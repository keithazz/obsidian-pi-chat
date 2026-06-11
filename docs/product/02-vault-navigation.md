# PRD — Vault-Aware Navigation

> A read-only navigation primitive over an Obsidian vault, exposing Obsidian's native model (links, embeds, tags, frontmatter, headings, blocks) as an LLM-friendly tool surface. Domain-agnostic; intended as a foundation for any agent that operates over an Obsidian vault.

## 1. Vision

Obsidian's value as a knowledge-management tool comes from its model of the vault as a structured graph — notes connected by wikilinks and embeds, organised by tags and frontmatter, structured into headings and blocks. Most of that structure is invisible to file-level tools. `grep`, `ls`, and `find` see a folder of `.md` files, not a graph.

For an AI agent operating over an Obsidian vault, this gap matters in practice. Tasks like "find the notes that link to this one," "list all notes tagged with X that haven't been updated since Y," or "extract the section under heading Z from this long note" are first-class operations in Obsidian's model and degenerate, fragile operations under shell tools. The agent ends up reading whole files to do work that should be a single structured query, burning tokens and producing brittle results that depend on accidental properties of the prose (capitalisation, spacing, where the agent happened to start reading).

Vault-aware navigation exposes Obsidian's native model as a tool surface: a set of read-only operations over the vault's graph, metadata, structure, and content. The operations are deterministic projections of state that Obsidian already maintains — the `MetadataCache`, the resolved-link table, the file system view — with stable identifiers, composable outputs, and predictable performance.

The goal is to make navigation of an Obsidian vault feel native to an agent rather than feeling like an agent flailing at a folder of text files. The capability is downstream of no particular content domain — it is the same primitive whether the vault holds research notes, fiction drafts, a personal knowledge base, project documentation, or anything else.

## 2. Target users

The primary consumer is an LLM-driven agent operating over an Obsidian vault. The design must therefore optimise for LLM-friendly tool surfaces: clear separation of concerns, token-efficient outputs, stable identifiers, predictable schemas, and unambiguous error modes. The agent is the user that exercises every operation; it is the user that suffers most when contracts are loose.

The secondary consumer is the developer or plugin author building such an agent. They need a stable contract, comprehensive documentation, and the ability to compose primitives without reaching for the underlying Obsidian API directly. This audience also needs deterministic behaviour for testing — given a vault state, the same query must return the same result.

A tertiary consumer is the end user of the agent (the Obsidian user themselves), who is not a direct caller but whose vault and trust expectations constrain the design. They expect their vault's semantics — Obsidian's semantics — to be respected, not a parallel model invented by the navigation layer. They never see the API directly, but they will absolutely notice when it disagrees with what they see in Obsidian.

## 3. Requirements

### 3.1 Graph navigation

The system must expose Obsidian's link graph as queryable structure.

- **Backlinks.** For any note, return the set of notes that reference it, distinguishing wiki-style references (`[[foo]]`), markdown links (`[foo](foo.md)`), and embeds (`![[foo]]`). Each backlink entry includes the source note's path and the location(s) of the reference (line number, surrounding heading context, and the original link text).
- **Forward links.** For any note, return its outgoing links with the same per-link metadata. Each link entry distinguishes resolved (target exists in vault) from unresolved (target missing).
- **Embeds.** Treat transclusions (`![[…]]`) as a distinct edge type. An embed is structurally different from a reference — it pulls content rather than pointing — and the agent must be able to ask "what embeds this" separately from "what links to this."
- **Unresolved-link enumeration.** List all unresolved (broken) references in the vault, grouped by target, with the source locations for each. This is one of the most useful diagnostic operations and has no equivalent in shell tools.
- **Bounded traversal.** For a starting note, return the N-hop neighbourhood with configurable direction (outgoing, incoming, both) and edge-type filter (links, embeds, both). The result is a graph projection, not a full crawl — depth and total node cap are required parameters and the operation returns truncation metadata when either cap is hit.

### 3.2 Tag queries

Tags must be queryable in a way that respects Obsidian's tag semantics, including the nested-tag hierarchy and the distinction between frontmatter and inline tags.

- **Tag enumeration.** List all tags in the vault with usage counts. Counts include all tag instances; the operation also reports the number of distinct notes carrying each tag.
- **Nested-tag matching.** A query for `#topic` must match `#topic/subtopic`, mirroring Obsidian's own behaviour. The operation distinguishes "exact match" from "prefix match" and exposes both.
- **Tag-to-notes.** Given a tag or tag expression, return the notes carrying it, with each note's basic metadata.
- **Frontmatter vs inline distinction.** Each tag instance is annotated with its source — the frontmatter `tags:` field or an inline `#tag` in the body. Callers can filter on this; the two carry different semantics in many vaults (frontmatter tags often denote document-level classification, inline tags often denote local context).
- **Tag expressions.** Support boolean combinations — AND, OR, NOT — over multiple tags. The expression shape must be small, total, and easy for an LLM to generate correctly from a schema. Structured JSON is preferable to a textual DSL unless real call-site verbosity makes that untenable.

### 3.3 Frontmatter queries

Frontmatter is the vault's typed metadata layer and must be queryable as such, not as opaque YAML strings.

- **Typed access.** For a given note, return its frontmatter as structured data with types preserved as Obsidian parses them — strings, numbers, booleans, lists, and dates where Obsidian recognises them.
- **Field-existence queries.** Find all notes that have a given frontmatter field defined, regardless of value.
- **Field-value queries.** Find all notes where field X matches a predicate — equality, set membership, range, regex against the serialised string, or a structured comparator for lists (contains, contains-all, intersects).
- **Composite queries.** Multiple field predicates combined with boolean operators. The expression-shape choice carries over from tags; whatever language is chosen for one is chosen for the other.
- **Type ambiguity.** Where Obsidian's frontmatter parsing is loose (a scalar that could be a string or a date, a list with mixed types), the navigation layer must surface what Obsidian's own parser believes the type to be, rather than re-parsing. The principle is "what Obsidian sees" — the agent must never see a different model than the user does.

### 3.4 Structural queries

Within a single note, structure (headings, blocks, sections) must be addressable.

- **Heading outline.** Return the heading tree of a note: each heading with its level, line range, line number of the heading itself, and any associated block ID. The outline is a tree, not a flat list; the operation preserves hierarchy.
- **Section retrieval.** Given a note and a heading reference, return the content between that heading and the next heading of equal-or-higher level. This is the natural "section" unit and is typically what an agent wants when extracting a part of a long note.
- **Block resolution.** Obsidian supports block references (`^block-id`). Given a block ID, return the block's content and its containing section's heading.
- **Cross-note heading search.** Find notes whose outlines contain a heading matching a query (substring, regex, or exact match), returning the note path and the matching heading's location.

### 3.5 Lexical search

Full-text search remains essential as a fallback and complement to structured queries. Even with rich metadata, agents will need substring and pattern matching over content.

- **Substring and regex.** Both supported. Regex search is bounded by a per-query timeout to prevent pathological patterns from stalling the agent or the vault.
- **Field scoping.** Searches can be scoped to body, headings, frontmatter values, code blocks, or file paths. The default is body and headings; "everything" must be opt-in.
- **Path globs.** File-path patterns filter which notes are searched, scoping queries to a folder without first having to list it.
- **Match output.** Each hit returns the note path, the line number, a configurable amount of surrounding context, and the matched span(s). Context is requested by line count, not by character or token count — predictable to the agent.
- **Ranking and limits.** Default ranking is by file modification time, descending. Alternative rankings — by link count, by tag overlap with a reference note, by lexicographic path — must be available. All result sets are bounded; the caller specifies a max-results parameter and unbounded queries are rejected.

### 3.6 File and folder structure

The filesystem view of the vault must be queryable, but in vault-aware terms.

- **Folder listing.** Return the contents of a folder with each entry's type (note, attachment, subfolder), basic metadata, and counts (note count, attachment count, descendant total for folders).
- **Vault-wide note listing.** List all notes matching a path-glob filter, returning each note's path, modification time, size, link counts (incoming and outgoing), and tag set. This is the workhorse operation for "find everything matching X" queries.
- **File metadata.** For any path, return its full metadata: path, name, parent folder, creation time, modification time, size, vault-relative path, and whether it's a markdown note or an attachment.
- **Attachment listing.** Distinguish notes (`.md`) from attachments. Attachment queries return the same metadata shape but do not attempt to parse content — the navigation layer does not OCR images, transcribe audio, or extract PDF text (see non-goals).

### 3.7 Content retrieval

Reading note content is part of the navigation surface, not separate from it. Agents reach navigation tools to find notes, and the moment they have a note they want to read it. Forcing them to switch tool families introduces a seam where one isn't needed and where contract drift accumulates.

- **Full read.** Return the full content of a note as text, with frontmatter parsed separately. The caller can request frontmatter included as raw YAML, included as parsed structured data, or omitted.
- **Section read.** Given a note and a heading reference, return the section's content. This is the natural unit and should usually be preferred over full read.
- **Block read.** Given a note and a block ID, return the block.
- **Line-range read.** Given a note and a line range, return those lines. The fallback when section or block units don't fit the need.
- **Excerpt with token budget.** Optional: given a note and a token budget, return a representative excerpt — frontmatter plus outline plus first N tokens of body, or another defined extraction. The exact policy is deferred (see open questions §8).

### 3.8 Composability and identifiers

The tool surface must be designed for composition. Outputs from one operation should be valid inputs to another without re-parsing.

- **Stable note identifiers.** Vault-relative file paths are the canonical note identifier. They are stable for the lifetime of a note (modulo rename, which the agent observes through whatever mutation surface it has — out of scope for this PRD).
- **Stable block identifiers.** Obsidian block IDs (`^block-id`) when present; otherwise a synthesised `path#L<line>` locator for content without explicit IDs.
- **Stable section identifiers.** A `path#heading` form, with the heading text canonicalised the same way Obsidian's own link resolution canonicalises it.
- **Pagination.** All listing operations support pagination via opaque cursors. The total count is included in the first page where it can be computed cheaply.
- **Error model.** A small set of typed errors: `not_found`, `ambiguous`, `invalid_query`, `truncated`, `timeout`. The error surface is part of the contract and must be stable across versions; agents will write prompts that match on these.

### 3.9 Cache coherence and freshness

Obsidian maintains a `MetadataCache` that is the source of truth for backlinks, resolved links, headings, tags, and frontmatter. The navigation layer must align with this cache and surface its freshness state honestly rather than hiding it.

- **Cache-backed reads.** All graph and metadata queries are served from `MetadataCache` rather than re-parsing notes on each call.
- **Write-then-read consistency.** After a write completes through Obsidian's vault API, a subsequent navigation query must reflect the new state. The mechanism is implementation-defined (await the next `metadataCache.on('changed')` event for the affected file, or expose an explicit settle operation), but the guarantee is required.
- **External edits.** Edits made to the vault outside Obsidian (the user editing in a different editor while the vault is loaded) eventually propagate. The navigation layer reports the staleness window or exposes a "wait for cache" operation; agents must not have to model the propagation themselves.

### 3.10 Performance envelope

Performance must be predictable for an agent that may issue many navigation queries per turn.

- **Latency target.** Cached queries (graph, tag, frontmatter, structure) complete in under 100ms on vaults up to 10,000 notes on commodity laptop hardware. Lexical search latency scales with the search corpus but is bounded by a configurable timeout.
- **Memory envelope.** Queries do not materialise the full vault into memory beyond what Obsidian already keeps there. Listing operations stream or paginate; full-vault scans (which lexical search may require) operate on the in-memory representation Obsidian already maintains.
- **Concurrency.** Queries are safe to issue concurrently. Reads do not block on each other; reads do not block on writes (the cache is read-only from the navigation layer's perspective).

### 3.11 Read-only guarantee

The navigation surface is strictly non-mutating. No operation modifies the vault, the cache, plugin state, or any settings. This is both a correctness property (callers can compose freely without sequencing concerns) and a security property (the surface can be exposed to less-trusted callers without further gating, and a navigation-only agent cannot harm the vault by definition).

## 4. Design principles

**Project Obsidian's model; don't invent a parallel one.** Every concept in the API maps to a concept Obsidian itself recognises — link, embed, tag, heading, block, frontmatter field, attachment. Where Obsidian's behaviour is loose or surprising (case-insensitive link resolution, nested-tag prefix matching, frontmatter type coercion), the navigation layer mirrors it rather than tightening or correcting it. Diverging from Obsidian's semantics produces correctness bugs that are extremely hard to debug, because the symptom is "the agent disagrees with the user about the vault."

**Read-only as a foundation.** Mutability is a separate, larger problem with its own approval, history, and recovery concerns. Treating navigation as strictly read-only keeps the surface small, the semantics simple, and the security story trivial. Mutation belongs in a separate tool family with its own gating.

**Small, orthogonal operations over monolithic queries.** A query DSL that does everything is hard to specify, hard to teach an LLM, and hard to evolve. Many small, well-named operations with clear single responsibilities are easier for an agent to compose correctly. The cost is more tool calls per task; the benefit is lower per-call error rate and a tool surface that an LLM can actually learn to use accurately.

**Stable identifiers everywhere.** Every output that an agent might want to feed into another operation includes the canonical identifier for that thing. Paths for notes, `path#heading` for sections, `path#^block` for blocks. The agent never has to construct identifiers from scratch, and round-tripping (use an output as the next input) always works.

**Predictable, bounded outputs.** Every operation that could return an unbounded result requires an explicit limit and supports pagination. Default limits exist but are conservative. Truncation is always reported in the result, never silent — the agent must be able to detect that it got a partial answer.

**Mirror Obsidian's cache semantics.** Queries are served from `MetadataCache` and inherit its freshness model. The navigation layer does not maintain its own index, does not parse notes redundantly, and does not attempt to be more current than Obsidian itself.

**LLM-friendly outputs.** Structured JSON with stable field names. Counts and totals where useful. Truncation flags where applicable. Numeric line numbers, not byte offsets. Vault-relative paths, not absolute paths. Strings normalised the way Obsidian normalises them, so a path returned by the API can be passed straight back without canonicalisation by the agent.

## 5. Non-goals

**Writes, edits, renames, deletes.** Navigation is read-only. Mutating operations belong in a separate tool surface (`vault-mutation` or equivalent) with its own approval gating, conflict detection, and history.

**Semantic / embedding search.** Embedding-based retrieval is a separate problem with its own design considerations (model choice, index freshness, hosted vs local trust model, sync to vault state). It is deliberately out of scope here so the navigation primitive remains deterministic, cheap, and trust-neutral. Semantic search, if added later, layers on top of vault-aware navigation, not the other way around.

**Cross-vault queries.** The API is scoped to a single vault. Multi-vault federation is out of scope.

**Content extraction from non-markdown attachments.** PDFs, images, audio, and other attachments are listed by metadata only. Extracting their text or content is the responsibility of a separate tool family (involving OCR, PDF parsing, transcription) and is out of scope here.

**Exposing other plugins' state.** The vault may contain state maintained by other Obsidian plugins (Dataview indices, Templater configs, Excalidraw drawings, Smart Connections embeddings). The navigation layer does not read or expose other plugins' internal state. Where another plugin's data is stored as markdown or attachments in the vault, it is visible through standard navigation; where it is stored internally to the plugin, it is invisible.

**Plugin discovery and configuration.** What plugins the user has installed, their settings, the current workspace layout — none of this is queryable through the navigation surface. The API is about the vault's content, not Obsidian's runtime state.

**Graph visualisation.** The graph is exposed as queryable structure, not rendered. Visualisation is a UI concern separate from the navigation API.

**Real-time event streams.** The API is request/response. Subscribing to "notify me when any note tagged X changes" is out of scope. Agents that need this can poll, or a future event-stream layer can be added alongside.

**Custom indices.** The navigation layer uses `MetadataCache` and the vault's filesystem view. It does not maintain its own indices — no inverted index for substring search beyond what's already in memory, no graph database, no embedding store. This keeps the surface lightweight and the cache-coherence story simple.

**Headless / non-Obsidian operation.** Querying a vault without an Obsidian instance running is out of scope. A future "vault library" capable of headless operation would re-implement parts of Obsidian's parsing and is a separate project.

## 6. Constraints and assumptions

- The vault is loaded in an Obsidian instance and the navigation layer runs in Obsidian's renderer process (or has direct access to the `App` instance, `Vault` API, and `MetadataCache`).
- The vault is on a local filesystem. Behaviour on cloud-synced vaults (iCloud, Dropbox, OneDrive) inherits whatever Obsidian itself supports — the navigation layer does not add or remove guarantees.
- The agent issuing queries is co-located with the navigation layer (same machine, same process, or connected via a low-latency RPC channel). High-latency remote operation is out of scope.
- `MetadataCache` is sufficient as the source of truth for graph and metadata queries. Where `MetadataCache` is incomplete or wrong, the navigation layer is incomplete or wrong in the same places — fixing `MetadataCache` is upstream.
- Vaults can be large (tens of thousands of notes), but typical vaults are smaller (hundreds to a few thousand). Performance targets are set for the common case; very large vaults may degrade gracefully but are not the primary target.
- All operations execute synchronously from the caller's perspective — request, response. Internal async resolution is fine; the surface itself is not asynchronous beyond the response.

## 7. Success criteria

A v1 release is successful if:

1. An agent can answer "what notes link to this one?" with a single tool call returning structured backlink data including reference locations and types.
1. An agent can answer "find notes tagged X with frontmatter field `status: draft` modified in the last 30 days" with a single tool call, or a clear two-call composition (tag query, then filter).
1. An agent can extract the section under a named heading from a long note without reading the full note, and the section returned is exactly what Obsidian itself would consider that section.
1. An agent can enumerate unresolved links across the vault — a diagnostic operation impossible with shell tools — in under a second on a 5,000-note vault.
1. After the agent writes to a note (through a separate mutation tool), a subsequent navigation query reflects the change without the agent needing to model cache propagation.
1. The full tool surface fits in a few hundred lines of tool definition, with each tool's purpose, parameters, output shape, and error modes documented for both LLM consumption and human reading.
1. The API contract is stable enough that the agent's tool-selection prompts, once tuned, do not require revision when the underlying implementation is refactored.
1. A developer integrating the navigation layer into a new agent project can produce a working "find notes about X and read their structure" agent in under an hour of integration work.

## 8. Open product questions

These are deferred decisions worth flagging early rather than discovering during implementation.

**Query expression shape.** Tag expressions, frontmatter predicates, and search filters all need a small expression language. The choice between structured JSON (verbose, unambiguous, easy for LLMs to generate from schema) and a textual mini-DSL (compact, more error-prone, requires its own parser) is undecided. Structured JSON is the conservative default; a DSL might be added later if call-site verbosity becomes a real cost.

**Block reference synthesis.** Notes without explicit block IDs need a synthesised locator (`path#L<line>` was proposed in §3.8). Whether to synthesise transparently, require the agent to fall back to line ranges, or require explicit block IDs is undecided. The line-locator approach is most forgiving but creates identifier types the user doesn't see in Obsidian, which is a potential confusion point if the agent surfaces them to the user.

**Search ranking defaults.** The default ranking for lexical search (modification time descending) is a guess at what's most useful. Empirical use may show that link-count ranking, a BM25 score over note bodies, or a hybrid scheme is better. The right default is a data question, not an assertion.

**Frontmatter type model.** Obsidian's frontmatter parsing is loose — YAML with quirks, plus the user's own conventions for fields like dates. The navigation layer's typed-access promise (§3.3) requires a defined coercion policy: what counts as a date, how strict to be about ISO formats, how to handle YAML lists that are sometimes scalars. This is fiddly and best resolved against real vault corpora rather than from first principles.

**Path globs vs path patterns.** Glob syntax (`**/foo/*.md`) is familiar but has portability quirks across implementations. A simpler "starts-with-folder" pattern is less expressive but unambiguous. Whether to expose one, the other, or both is undecided.

**Excerpt extraction policy.** The token-budgeted excerpt operation (§3.7) needs a defined policy: frontmatter plus outline plus body prefix, or something cleverer (heuristic extraction of the most-linked-to section, for instance). The simple policy is defensible for v1 and can be revisited once real agents exercise it.

**Concurrency limits.** Whether the navigation layer needs internal rate-limiting (to protect against an agent issuing a thousand queries in parallel and overwhelming `MetadataCache`) is undecided. Probably not at first, but worth observing once real agents exercise the API.

**Versioning and stability.** The tool surface will evolve. How to version it (additive only, semver, deprecation policy), and how to communicate breaking changes to agents whose prompts encode tool signatures, is undecided. Stability of the contract matters more here than in most APIs because the consumer (an LLM) cannot easily be told to migrate.

**Sensitivity to `MetadataCache` gaps.** `MetadataCache` is good but not exhaustive — it does not, for instance, track every detail of inline content (footnotes, callouts, custom markdown extensions). Where these gaps matter, the navigation layer either fills them itself (at the cost of duplicate parsing and a coherence problem) or accepts the gap (at the cost of an incomplete projection). The right balance has to be set per-feature and may shift as Obsidian's own API evolves.
