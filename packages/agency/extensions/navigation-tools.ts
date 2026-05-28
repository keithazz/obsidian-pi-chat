import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  encodeNavQuery,
  type NavOp,
  type NavResponse,
  type NavErrorKind,
} from "@educator-agency/shared";

class NavError extends Error {
  constructor(public kind: NavErrorKind, message: string) {
    super(message);
    this.name = "NavError";
  }
}

async function queryPlugin(op: NavOp, params: unknown, ctx: ExtensionContext): Promise<unknown> {
  if (!ctx.hasUI) throw new NavError("invalid_query", "No UI available for nav-query bridge");

  const queryId = randomUUID();
  const prefill = encodeNavQuery({ queryId, op, params });
  const raw = await ctx.ui.editor("AGENCY::nav-query", prefill);

  if (raw === undefined) throw new NavError("query_cancelled", "Bridge cancelled");

  const parsed: NavResponse = JSON.parse(raw);
  if (parsed.error) throw new NavError(parsed.error.kind, parsed.error.message);
  return parsed.result;
}

export function registerNavigationTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "vault_file_metadata",
    label: "Get file metadata",
    description: "Return metadata (path, type, size, timestamps) for a single vault file.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the file." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("file_metadata", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_folder_list",
    label: "List folder contents",
    description: "List the immediate children of a vault folder (files and subfolders).",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the folder." }),
      max_results: Type.Number({ description: "Maximum number of items to return." }),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("folder_list", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_note_list",
    label: "List notes",
    description: "List markdown notes in the vault, optionally filtered by glob and sorted.",
    parameters: Type.Object({
      max_results: Type.Number({ description: "Maximum number of notes to return." }),
      glob: Type.Optional(Type.String({ description: "Glob pattern to filter note paths." })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
      sort: Type.Optional(Type.Union([
        Type.Literal("mtime_desc"),
        Type.Literal("mtime_asc"),
        Type.Literal("name_asc"),
      ], { description: "Sort order. Defaults to mtime_desc." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("note_list", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_attachment_list",
    label: "List attachments",
    description: "List non-markdown files in the vault, optionally scoped to a folder.",
    parameters: Type.Object({
      max_results: Type.Number({ description: "Maximum number of attachments to return." }),
      folder: Type.Optional(Type.String({ description: "Vault-relative folder path to scope the listing." })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("attachment_list", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_heading_outline",
    label: "Get heading outline",
    description: "Return the nested heading tree for a note, including line ranges for each section.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("heading_outline", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_section_get",
    label: "Get section info",
    description: "Find a heading in a note and return its line range. Used to resolve section boundaries for vault_read_section.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note." }),
      heading: Type.String({ description: "Heading text to find (case-insensitive substring match)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { path, heading } = params as { path: string; heading: string };
      const outlineResult = await queryPlugin("heading_outline", { path }, ctx) as { path: string; outline: Array<{ text: string; line: number; endLine: number; id: string; level: number; children: unknown[] }> };

      function flattenOutline(nodes: typeof outlineResult.outline): typeof outlineResult.outline {
        const flat: typeof outlineResult.outline = [];
        for (const n of nodes) {
          flat.push(n);
          flat.push(...flattenOutline(n.children as typeof outlineResult.outline));
        }
        return flat;
      }

      const all = flattenOutline(outlineResult.outline);
      const lower = heading.toLowerCase();
      const matches = all.filter((n) => n.text.toLowerCase().includes(lower));

      if (matches.length === 0) throw new NavError("not_found", `No heading matching "${heading}" in ${path}`);
      if (matches.length > 1) throw new NavError("ambiguous", `Multiple headings match "${heading}" in ${path}: ${matches.map((m) => m.text).join(", ")}`);

      const m = matches[0];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ path, heading: m.text, startLine: m.line, endLine: m.endLine, id: m.id }, null, 2),
        }],
      };
    },
  });

  pi.registerTool({
    name: "vault_block_resolve",
    label: "Resolve block reference",
    description: "Look up a block reference (^block-id) in a note, or list all block IDs defined in the note.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note." }),
      blockId: Type.Optional(Type.String({ description: "Block ID to resolve (without the ^ caret). Omit to list all blocks." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("block_resolve", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_read",
    label: "Read note",
    description: "Read the full content of a note. Returns the body and optionally the frontmatter.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note." }),
      frontmatter: Type.Optional(Type.Union([
        Type.Literal("raw"),
        Type.Literal("parsed"),
        Type.Literal("omit"),
      ], { description: "How to include frontmatter: raw (default), parsed as object, or omit." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("note_read", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_read_section",
    label: "Read note section",
    description: "Read a specific section of a note by heading name. Returns only that section's lines.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note." }),
      heading: Type.String({ description: "Heading text to match (case-insensitive exact match)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("section_read", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_read_block",
    label: "Read block by ID",
    description: "Read the paragraph containing a block reference (^block-id) from a note.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note." }),
      blockId: Type.String({ description: "Block ID to read (without the ^ caret)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("block_read", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_read_lines",
    label: "Read line range",
    description: "Read a specific line range from a note (0-indexed, inclusive, max 500 lines).",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note." }),
      startLine: Type.Number({ description: "First line to read (0-indexed)." }),
      endLine: Type.Number({ description: "Last line to read (0-indexed, inclusive)." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("lines_read", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_backlinks",
    label: "Get backlinks",
    description: "Return all notes that link to a given note, with source location and link type.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the target note." }),
      types: Type.Optional(Type.Array(Type.Union([
        Type.Literal("wikilink"),
        Type.Literal("markdown"),
        Type.Literal("embed"),
      ]), { description: "Filter to specific link types. Defaults to all." })),
      max_results: Type.Number({ description: "Maximum number of entries to return." }),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("backlinks", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_forward_links",
    label: "Get forward links",
    description: "Return all links (and optionally unresolved links) that a note makes to other notes.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the source note." }),
      types: Type.Optional(Type.Array(Type.Union([
        Type.Literal("wikilink"),
        Type.Literal("markdown"),
        Type.Literal("embed"),
      ]), { description: "Filter to specific link types. Defaults to all." })),
      includeUnresolved: Type.Optional(Type.Boolean({ description: "Include links to non-existent notes. Defaults to true." })),
      max_results: Type.Number({ description: "Maximum number of entries to return." }),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("forward_links", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_unresolved_links",
    label: "List unresolved links",
    description: "List all unresolved link targets across the entire vault, grouped by target and sorted by number of sources.",
    parameters: Type.Object({
      max_results: Type.Number({ description: "Maximum number of unresolved targets to return." }),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("unresolved_links", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_graph_traverse",
    label: "Traverse link graph",
    description: "BFS-expand the link graph from a starting note up to a given depth, returning nodes and edges. depth must be 1–5.",
    parameters: Type.Object({
      startPath: Type.String({ description: "Vault-relative path to the starting note." }),
      depth: Type.Number({ description: "Number of hops to traverse (1–5)." }),
      direction: Type.Optional(Type.Union([
        Type.Literal("outgoing"),
        Type.Literal("incoming"),
        Type.Literal("both"),
      ], { description: "Which link directions to follow. Defaults to both." })),
      edgeTypes: Type.Optional(Type.Union([
        Type.Literal("link"),
        Type.Literal("embed"),
        Type.Literal("both"),
      ], { description: "Which edge types to include. Defaults to both." })),
      nodeCap: Type.Optional(Type.Number({ description: "Maximum nodes to return (default 100, max 500)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("graph_traverse", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_heading_search",
    label: "Search headings",
    description: "Search for headings across all notes in the vault.",
    parameters: Type.Object({
      query: Type.String({ description: "Search term." }),
      matchType: Type.Optional(Type.Union([
        Type.Literal("substring"),
        Type.Literal("exact"),
        Type.Literal("regex"),
      ], { description: "How to match: substring (default), exact, or regex." })),
      max_results: Type.Number({ description: "Maximum number of results to return." }),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("heading_search", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_list_tags",
    label: "List tags",
    description: "List all tags used in the vault, with instance and note counts. max_results is required.",
    parameters: Type.Object({
      max_results: Type.Number({ description: "Maximum number of tags to return." }),
      prefix: Type.Optional(Type.String({ description: "Filter to tags starting with this prefix (e.g. \"topic\" matches #topic and #topic/subtag)." })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("list_tags", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_notes_by_tag",
    label: "Notes by tag",
    description: "Find all notes containing a specific tag. max_results is required.",
    parameters: Type.Object({
      tag: Type.String({ description: "Tag to search for (with or without # prefix)." }),
      max_results: Type.Number({ description: "Maximum number of notes to return." }),
      match: Type.Optional(Type.Union([
        Type.Literal("exact"),
        Type.Literal("prefix"),
      ], { description: "exact: only this exact tag. prefix (default): tag and all subtags." })),
      source: Type.Optional(Type.Union([
        Type.Literal("frontmatter"),
        Type.Literal("inline"),
      ], { description: "Restrict to a specific tag source. Omit for both." })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("notes_by_tag", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_query_tags",
    label: "Query tags with expression",
    description: [
      "Find notes matching a boolean tag expression.",
      "expr is a JSON tree: leaf op=tag {op:\"tag\",value:\"topic\",match:\"prefix\"|\"exact\"};",
      "combinators op=and/or {op:\"and\",operands:[...]} or op=not {op:\"not\",operand:{...}}.",
      "Max depth 8, max 20 leaf nodes. max_results is required.",
    ].join(" "),
    parameters: Type.Object({
      expr: Type.Any({ description: "Tag expression tree." }),
      max_results: Type.Number({ description: "Maximum number of notes to return." }),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("query_tags", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_frontmatter_get",
    label: "Get frontmatter",
    description: "Return the parsed frontmatter fields for a single note.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("frontmatter_get", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_query_frontmatter",
    label: "Query frontmatter",
    description: [
      "Find notes whose frontmatter matches a boolean expression.",
      "Leaf ops: exists, eq, neq, gt, gte, lt, lte, in, contains, contains_all, intersects, regex.",
      "Combinators: and {operands:[]}, or {operands:[]}, not {operand:{}}.",
      "Max depth 8, max 20 leaves. max_results is required.",
    ].join(" "),
    parameters: Type.Object({
      expr: Type.Any({ description: "Frontmatter predicate tree." }),
      max_results: Type.Number({ description: "Maximum number of notes to return." }),
      fields: Type.Optional(Type.Array(Type.String(), { description: "Subset of frontmatter fields to include in results. Omit for all fields." })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("query_frontmatter", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_settle_cache",
    label: "Settle metadata cache",
    description: "Call this after writing to a note and before issuing navigation queries about that note. Returns when MetadataCache has processed the write. If the cache does not update within timeoutMs milliseconds (default 5000), returns a timeout error.",
    parameters: Type.Object({
      path: Type.String({ description: "Vault-relative path to the note to wait for." }),
      timeoutMs: Type.Optional(Type.Number({ description: "Maximum milliseconds to wait (default 5000)." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("settle_cache", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "vault_search",
    label: "Full-text search",
    description: [
      "Lexical (substring or regex) search over vault note content.",
      "max_results is REQUIRED — unbounded calls are rejected.",
      "Returns a SearchResult; if timedOut is true, results are partial — narrow the query or increase timeoutMs to get more.",
      "Pagination: pass the nextCursor from a previous response to continue scanning from where the last call left off.",
    ].join(" "),
    parameters: Type.Object({
      query: Type.String({ description: "Search string or regex pattern." }),
      max_results: Type.Number({ description: "Maximum number of matches to return. Required." }),
      isRegex: Type.Optional(Type.Boolean({ description: "Treat query as a regex. Defaults to false." })),
      fields: Type.Optional(Type.Array(
        Type.Union([
          Type.Literal("body"),
          Type.Literal("headings"),
          Type.Literal("frontmatter"),
          Type.Literal("code_blocks"),
          Type.Literal("path"),
        ]),
        { description: "Which fields to search. Defaults to [\"body\", \"headings\"]." },
      )),
      glob: Type.Optional(Type.String({ description: "Glob pattern to restrict which notes are scanned (e.g. \"projects/**\")." })),
      sort: Type.Optional(Type.Union([
        Type.Literal("mtime_desc"),
        Type.Literal("mtime_asc"),
        Type.Literal("link_count_desc"),
        Type.Literal("path_asc"),
      ], { description: "Sort order for the candidate file list before scanning. Defaults to mtime_desc." })),
      contextLines: Type.Optional(Type.Number({ description: "Lines of surrounding context per match (default 2, max 10)." })),
      timeoutMs: Type.Optional(Type.Number({ description: "Scan timeout in milliseconds (default 5000, max 30000)." })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("search", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });
}
