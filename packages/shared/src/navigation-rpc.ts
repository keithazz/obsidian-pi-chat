export type NavOp =
  | "file_metadata"
  | "folder_list"
  | "note_list"
  | "attachment_list"
  | "heading_outline"
  | "block_resolve"
  | "heading_search"
  | "note_read"
  | "section_read"
  | "block_read"
  | "lines_read"
  | "backlinks"
  | "forward_links"
  | "unresolved_links"
  | "graph_traverse"
  | "list_tags"
  | "notes_by_tag"
  | "query_tags"
  | "frontmatter_get"
  | "query_frontmatter"
  | "search"
  | "settle_cache";

export interface NavQuery {
  queryId: string;
  op: NavOp;
  params: unknown;
}

export type NavErrorKind =
  | "not_found"
  | "ambiguous"
  | "invalid_query"
  | "truncated"
  | "timeout"
  | "query_cancelled";

export interface NavError {
  kind: NavErrorKind;
  message: string;
}

export interface NavResponse {
  queryId: string;
  result?: unknown;
  error?: NavError;
}

export type FmScalar = string | number | boolean | null

export type FmExpr =
  | { op: "exists";       field: string }
  | { op: "eq";           field: string; value: FmScalar }
  | { op: "neq";          field: string; value: FmScalar }
  | { op: "gt";           field: string; value: number }
  | { op: "gte";          field: string; value: number }
  | { op: "lt";           field: string; value: number }
  | { op: "lte";          field: string; value: number }
  | { op: "in";           field: string; values: FmScalar[] }
  | { op: "contains";     field: string; value: FmScalar }
  | { op: "contains_all"; field: string; values: FmScalar[] }
  | { op: "intersects";   field: string; values: FmScalar[] }
  | { op: "regex";        field: string; pattern: string }
  | { op: "and";  operands: FmExpr[] }
  | { op: "or";   operands: FmExpr[] }
  | { op: "not";  operand:  FmExpr }

export type TagMatch = "exact" | "prefix"

export type TagExpr =
  | { op: "tag";  value: string; match?: TagMatch }
  | { op: "and";  operands: TagExpr[] }
  | { op: "or";   operands: TagExpr[] }
  | { op: "not";  operand:  TagExpr }

const NAV_QUERY_PREFIX = "AGENCY::nav-query::";

export function encodeNavQuery(q: NavQuery): string {
  return `${NAV_QUERY_PREFIX}${JSON.stringify(q)}`;
}

export function decodeNavQuery(s: string): NavQuery {
  return JSON.parse(s.slice(NAV_QUERY_PREFIX.length));
}
