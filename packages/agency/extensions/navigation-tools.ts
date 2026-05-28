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
      max_results: Type.Number({ description: "Maximum number of items to return.", default: 50 }),
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
      max_results: Type.Number({ description: "Maximum number of notes to return.", default: 50 }),
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
      max_results: Type.Number({ description: "Maximum number of attachments to return.", default: 50 }),
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
      max_results: Type.Number({ description: "Maximum number of results to return.", default: 50 }),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor from a previous call." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = await queryPlugin("heading_search", params, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });
}
