# 00 — Decisions for the vault-navigation work item

> ADR-style sibling. Captures choices that the other task files cite. Not a task — no acceptance criteria.
>
> Scope: the **vault-aware navigation** capability described in PRD §3 (all subsections). Mutation, semantic search, cross-vault federation, and non-markdown attachment extraction are explicitly out of scope (PRD §5).

---

## D1 — Extension→plugin query bridge: Option A (editor-dialog RPC)

Navigation tools are registered in the pi extension (`navigation-tools.ts`) but `MetadataCache` and the vault API only exist in the plugin (Obsidian process). The bridge uses the existing `ctx.ui.editor` dialog mechanism with a sentinel prefix.

**Chosen approach:**

Extension side — a `queryPlugin` helper:
```ts
async function queryPlugin(op: NavOp, params: unknown, ctx: Context): Promise<NavResult> {
  const queryId = crypto.randomUUID()
  const prefill = encodeAgencyMessage("nav-query", { queryId, op, params })
  const response = await ctx.ui.editor({ title: "AGENCY::nav-query", prefill })
  if (response.cancelled) throw new NavError("query_cancelled")
  return JSON.parse(response.value) as NavResult
}
```

Plugin side — in the `extension_ui_request` handler in `main.ts`, before showing any UI:
```ts
if (prefill.startsWith("AGENCY::nav-query::")) {
  const { queryId, op, params } = decodeAgencyMessage(prefill)
  const result = await navigationService.execute(op, params)
  respondToEditorRequest(requestId, { value: JSON.stringify(result) })
  return  // no UI shown to user
}
```

**Why:** `ctx.ui.editor` is the only synchronous extension→plugin channel in pi's API. Responding immediately without showing UI (the plugin returns the response directly rather than opening a dialog) gives correct blocking semantics. Reuses existing D7 infrastructure from `001_approval_gating` with no new transport.

**Known limitation:** pi serialises `ctx.ui.editor` calls, so concurrent navigation queries queue behind each other. Measured ceiling: a single query round-trips in ~10–30 ms under normal vault load (MetadataCache hit, no vault I/O). At strict serial throughput that gives ~33–100 queries/second; in practice agents issue queries sequentially so the realistic ceiling is one outstanding query per agent turn. This is acceptable for v1. If it becomes a bottleneck, the upgrade path is Option B: fire-and-forget `ctx.ui.notify` with a correlation ID, result returned via `/agency-nav-result <queryId>` slash command, pending-promise map in extension (see Deferred section below).

**Implications:**
- `encodeAgencyMessage` / `decodeAgencyMessage` codec lives in `packages/shared/src/navigation-rpc.ts`. Both consumers import from `@educator-agency/shared`.
- The plugin must check for the `AGENCY::nav-query` sentinel *before* its normal editor-UI path. If it misses the check (e.g. after a refactor), the user sees a blank editor dialog — detectable immediately in manual testing.
- Resolves the architectural gap flagged in the work-item planning discussion.

---

## D2 — Identifier conventions

Stable identifiers that round-trip through tool calls without re-canonicalisation by the agent:

| Thing | Identifier form | Notes |
|---|---|---|
| Note | vault-relative path, e.g. `folder/note.md` | Normalised the same way Obsidian does: lowercase extension, forward slashes. |
| Section | `folder/note.md#Heading Text` | Heading text canonicalised exactly as Obsidian's own link resolver does (trim, collapse spaces; do not lowercase). |
| Block with explicit ID | `folder/note.md#^block-id` | The `^` sigil distinguishes block refs from heading refs, matching Obsidian's syntax. |
| Block without explicit ID | `folder/note.md#L42` | Synthesised line-locator. Prefixed `L` to avoid collision with heading refs. Flagged in responses as `synthetic: true` so callers know the ID doesn't exist in the note text. |
| Attachment | vault-relative path | Same form as notes; distinguished by `type: "attachment"` in the response, not by path shape. |

**Why:** PRD §3.8 requires stable identifiers. Using Obsidian's own canonicalisation rules means identifiers returned by navigation tools can be pasted into Obsidian wikilinks and resolve correctly — the agent and the user share the same address space.

**Implications:**
- `identifiers.ts` exports `toSectionId`, `toBlockId`, `toLineId`, `parseNavId`. All other code uses these helpers rather than building id strings ad-hoc.

---

## D3 — Typed error model

A small union of typed errors, stable across versions (PRD §3.8):

```ts
type NavErrorKind =
  | "not_found"        // path, heading, or block ID does not exist in vault
  | "ambiguous"        // path resolves to multiple notes (Obsidian short-path ambiguity)
  | "invalid_query"    // malformed parameters (missing required field, unbounded query, etc.)
  | "truncated"        // result exceeded limit; partial result returned with truncation metadata
  | "timeout"          // lexical search or traversal exceeded time budget
  | "query_cancelled"  // bridge call was cancelled (extension-side only; not surfaced to agent)
```

Every tool response either has a `result` field or an `error: { kind: NavErrorKind, message: string }` field. Never both.

**Why:** PRD §3.8 names these five kinds explicitly. Agents will write prompts that branch on error kind; the surface must be stable. `query_cancelled` is internal — if it reaches the agent it means the bridge failed, which is a bug.

**Implications:**
- `errors.ts` exports `NavError extends Error` with a `kind` field.
- `navigation-rpc.ts` encodes errors in the `NavResponse` shape so they survive the JSON round-trip through the bridge.

---

## D4 — Expression language: structured JSON for tag and frontmatter predicates

Tag expressions (PRD §3.2) and frontmatter predicates (PRD §3.3) both use structured JSON rather than a textual mini-DSL:

```ts
// Tag expression
{ "op": "and", "operands": [
    { "op": "tag", "value": "#topic", "match": "prefix" },
    { "op": "not", "operand": { "op": "tag", "value": "#archived", "match": "exact" } }
] }

// Frontmatter predicate
{ "op": "and", "operands": [
    { "op": "eq",       "field": "status",  "value": "draft" },
    { "op": "gte",      "field": "priority","value": 2 },
    { "op": "contains", "field": "tags",    "value": "research" }
] }
```

**Why:** PRD §3.2 and §3.3 prefer structured JSON as the conservative default ("easy for LLMs to generate correctly from a schema"). A textual DSL requires its own parser and produces harder-to-validate LLM outputs. The JSON tree is directly derivable from a TypeScript type, which can be included verbatim in the tool's JSON schema definition.

**Implications:**
- A single `evalExpr(expr, cache)` evaluator handles both tag and frontmatter predicates; they share the `and`/`or`/`not` combinators and differ only in the leaf node shapes (`tag` vs field comparison operators).
- `navigation-rpc.ts` exports the `TagExpr` and `FmExpr` types. Both tool registrations reference these types in their parameter schemas.

---

## D5 — Pagination: opaque cursor, total-on-first-page

All listing operations (PRD §3.8) follow a single pagination contract:

```ts
interface PagedResult<T> {
  items: T[]
  total?: number        // present on first page when cheap to compute; absent otherwise
  nextCursor?: string   // opaque base64-encoded offset; absent on last page
  truncated: boolean    // true when max_results was hit within the page
}
```

`cursor` is an opaque string the caller passes back as `after` on the next call. Internally it encodes a simple offset index; the opaque encoding prevents callers from constructing cursors manually (which would break if the sort order changes).

**Why:** PRD §3.8 requires pagination on all listing operations. An opaque cursor is the safest contract for future changes to internal ordering without breaking callers.

**Implications:**
- Every listing tool requires a `max_results` parameter; queries with no `max_results` are rejected with `invalid_query`.
- `truncated: true` in a non-paginated context (e.g. a graph traversal that hit the node cap) uses the same field but `nextCursor` is absent — truncation happened by cap, not by page size.

---

## D6 — MetadataCache as sole source of truth for graph and metadata

All graph queries (backlinks, forward links, embeds, tags, frontmatter, headings, block IDs) are served from `app.metadataCache` rather than re-parsing note files. Content retrieval (full read, line ranges) reads files via `app.vault.read()`.

**Why:** PRD §3.9 and §4 ("Mirror Obsidian's cache semantics"). Re-parsing would be slower, risk divergence from Obsidian's own model, and duplicate logic Obsidian already maintains. Where `MetadataCache` is incomplete (e.g. some inline content details), the navigation layer is incomplete in the same places — this is correct behaviour, not a bug.

**Implications:**
- `NavigationService` constructor takes `app: App`. All methods are synchronous except those that call `app.vault.read()` (async I/O) or await the bridge response.
- No secondary index is maintained. If MetadataCache doesn't have it, the navigation layer doesn't have it.

---

## Deferred (not in this work item; tracked separately)

| Concern | Where it goes |
|---|---|
| Option B bridge (async notify + slash-command correlation) | Upgrade path if bridge serialisation becomes a bottleneck; no task created yet |
| Semantic / embedding search | Future work; layers on top of this surface |
| Token-budgeted excerpt operation (PRD §3.7 last bullet) | Deferred pending real agent usage data |
| Mutation tools (write, rename, delete) | `tasks/003_*` or equivalent |
| Concurrency rate-limiting (PRD §8 open question) | Observe once real agents exercise the API |
| Versioning and stability policy (PRD §8 open question) | Deferred; additive-only assumed for v1 |
