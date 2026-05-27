# 06 — Frontmatter queries

> Exposes frontmatter as typed, queryable metadata: single-note access and vault-wide field predicate queries (PRD §3.3).

## Why

Frontmatter is the vault's typed metadata layer. Queries like "find all notes where `status` is `draft` and `priority` is greater than 2" are natural vault operations but require reading and parsing every file with shell tools. `MetadataCache` already holds parsed frontmatter for every note. This task surfaces it as structured queries without additional I/O.

## What to do

### 1. Add ops to `NavOp` in `packages/shared/src/navigation-rpc.ts`

```ts
| "frontmatter_get" | "query_frontmatter"
```

Also export `FmExpr` (see below).

### 2. Add types to `packages/plugin/src/navigation/types.ts`

```ts
export type FmScalar = string | number | boolean | null
export type FmValue  = FmScalar | FmScalar[]

export interface FrontmatterResult {
  path: string
  fields: Record<string, FmValue>   // as MetadataCache parsed them
}

export interface FmQueryHit {
  path: string
  fields: Record<string, FmValue>
  modified: number
}

// Frontmatter predicate expression — see 00_decisions.md §D4
export type FmExpr =
  | { op: "exists";      field: string }
  | { op: "eq";          field: string; value: FmScalar }
  | { op: "neq";         field: string; value: FmScalar }
  | { op: "gt";          field: string; value: number }
  | { op: "gte";         field: string; value: number }
  | { op: "lt";          field: string; value: number }
  | { op: "lte";         field: string; value: number }
  | { op: "in";          field: string; values: FmScalar[] }
  | { op: "contains";    field: string; value: FmScalar }   // list field contains value
  | { op: "contains_all";field: string; values: FmScalar[] }
  | { op: "intersects";  field: string; values: FmScalar[] }
  | { op: "regex";       field: string; pattern: string }   // against serialised string value
  | { op: "and";  operands: FmExpr[] }
  | { op: "or";   operands: FmExpr[] }
  | { op: "not";  operand:  FmExpr }
```

### 3. Implement in `NavigationService.ts`

**`frontmatterGet({ path })`**

- Resolve file — throw `not_found` if absent.
- Return `{ path, fields: app.metadataCache.getFileCache(file)?.frontmatter ?? {} }`.
- Surface exactly what `MetadataCache` parsed — no re-coercion (PRD §3.3 "what Obsidian sees"). Where Obsidian's YAML parsing is ambiguous (a scalar that looks like a date), the navigation layer returns the same ambiguity.

**`queryFrontmatter({ expr, fields?, max_results, cursor? })`**

- `fields`: optional list of field names to include in each hit's `fields` map. Default: all fields. Lets callers reduce response size when they only care about specific fields.
- Iterate `app.vault.getMarkdownFiles()`. For each, get frontmatter from cache.
- Implement `evalFmExpr(expr: FmExpr, fm: Record<string, FmValue>): boolean`:
  - `exists`: field key is present in `fm`.
  - `eq` / `neq`: strict equality after type coercion to the field's actual type.
  - `gt` / `gte` / `lt` / `lte`: numeric comparisons; throw `invalid_query` if field value is not numeric.
  - `in`: `values.includes(fieldValue)`.
  - `contains`: field is an array and includes `value`; or field is a string and includes `value` as substring.
  - `contains_all`: all values present in list field.
  - `intersects`: at least one value in common between `values` and list field.
  - `regex`: `new RegExp(pattern).test(String(fieldValue))`; throw `invalid_query` on invalid pattern.
  - `and` / `or` / `not`: recurse.
- Depth cap 8, max 20 leaf nodes — throw `invalid_query` if exceeded.
- Return `PagedResult<FmQueryHit>`.

### 4. Register tools in `navigation-tools.ts`

- **`vault_frontmatter_get`** — params: `{ path: string }`. Returns all frontmatter fields for one note.
- **`vault_query_frontmatter`** — params: `{ expr: FmExpr; fields?: string[]; max_results: number; cursor?: string }`. Boolean predicate query over the vault.

Include the `FmExpr` type definition inline in the `vault_query_frontmatter` JSON schema description, same as `TagExpr` in task 05. The agent must be able to construct predicates from the schema alone.

## Acceptance

1. `npm run build` — no type errors.
2. Ask: "Get the frontmatter of `project.md`." — agent calls `vault_frontmatter_get`, returns structured field map.
3. Ask: "Find all notes where `status` is `draft`." — agent calls `vault_query_frontmatter` with `{ op: "eq", field: "status", value: "draft" }`.
4. Ask: "Find notes with `priority >= 2` and the `tags` list containing `research`." — agent constructs an AND expression and calls `vault_query_frontmatter`.
5. Verify that an `exists` predicate for a non-existent field returns zero hits (not an error).
6. Verify that an invalid regex pattern returns an `invalid_query` error.

## Files touched

- `packages/plugin/src/navigation/types.ts`
- `packages/plugin/src/navigation/NavigationService.ts`
- `packages/shared/src/navigation-rpc.ts`
- `packages/agency/extensions/navigation-tools.ts`

## Out of scope

Tag queries (task 05). Although frontmatter `tags:` is a frontmatter field, the tag query surface in task 05 handles it with Obsidian's tag semantics (nested matching, prefix match). `vault_query_frontmatter` treats `tags` as a plain list field — the `contains` predicate does exact-value matching, not prefix matching.

## Depends on

Task 01.

## Notes

`MetadataCache.getFileCache(file)?.frontmatter` may be `null` for notes with no frontmatter block — treat as empty `{}`, not an error. The YAML parser Obsidian uses has known quirks with date-like strings (ISO dates may be returned as `Date` objects or strings depending on the YAML library version). Surface whatever the cache returns; do not attempt to normalise further. Callers should use `regex` predicate against the serialised string if they need to match date fields by pattern.
