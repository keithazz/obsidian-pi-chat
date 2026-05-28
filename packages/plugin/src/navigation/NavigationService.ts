import { App, TFile, TFolder } from "obsidian";
import type { NavOp } from "@educator-agency/shared";
import { NavError } from "./errors";
import type { BlockRef, BlockReadResult, EdgeType, FileMetadata, FmExpr, FmQueryHit, FmScalar, FmValue, FolderEntry, FrontmatterInclude, FrontmatterResult, GraphNode, GraphTraverseResult, HeadingNode, HeadingSearchHit, LinkDirection, LinkEntry, LinkType, LinesReadResult, NavResultMeta, NoteFileMetadata, NoteReadResult, NoteTagResult, PagedResult, SearchField, SearchMatch, SearchResult, SearchSort, SectionReadResult, TagEntry, TagExpr, TagSource, UnresolvedTarget } from "./types";

interface FileMetadataParams { path: string }

interface FolderListParams {
  path: string;
  cursor?: string;
  max_results: number;
}

interface NoteListParams {
  glob?: string;
  cursor?: string;
  max_results: number;
  sort?: "mtime_desc" | "mtime_asc" | "name_asc";
}

interface AttachmentListParams {
  folder?: string;
  cursor?: string;
  max_results: number;
}

interface HeadingOutlineParams { path: string }

interface BlockResolveParams {
  path: string;
  blockId?: string;
}

interface HeadingSearchParams {
  query: string;
  matchType?: "substring" | "exact" | "regex";
  max_results: number;
  cursor?: string;
}

interface NoteReadParams {
  path: string;
  frontmatter?: FrontmatterInclude;
}

interface SectionReadParams {
  path: string;
  heading: string;
}

interface BlockReadParams {
  path: string;
  blockId: string;
}

interface LinesReadParams {
  path: string;
  startLine: number;
  endLine: number;
}

interface BacklinksParams {
  path: string;
  types?: LinkType[];
  max_results: number;
  cursor?: string;
}

interface ForwardLinksParams {
  path: string;
  types?: LinkType[];
  includeUnresolved?: boolean;
  max_results: number;
  cursor?: string;
}

interface UnresolvedLinksParams {
  max_results: number;
  cursor?: string;
}

interface GraphTraverseParams {
  startPath: string;
  depth: number;
  direction?: LinkDirection;
  edgeTypes?: EdgeType;
  nodeCap?: number;
}

interface ListTagsParams {
  prefix?: string;
  max_results: number;
  cursor?: string;
}

interface NotesByTagParams {
  tag: string;
  match?: "exact" | "prefix";
  source?: TagSource;
  max_results: number;
  cursor?: string;
}

interface QueryTagsParams {
  expr: TagExpr;
  max_results: number;
  cursor?: string;
}

interface FrontmatterGetParams {
  path: string;
}

interface QueryFrontmatterParams {
  expr: FmExpr;
  fields?: string[];
  max_results: number;
  cursor?: string;
}

interface SearchParams {
  query: string;
  isRegex?: boolean;
  fields?: SearchField[];
  glob?: string;
  sort?: SearchSort;
  contextLines?: number;
  timeoutMs?: number;
  max_results: number;
  cursor?: string;
}

function globToRegex(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (pattern[i] === "/") i++;
    } else if (ch === "*") {
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    return parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10) || 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function toSectionId(path: string, heading: string): string {
  return `${path}#${heading.replace(/\s+/g, "-").toLowerCase()}`;
}

function toBlockId(path: string, blockId: string): string {
  return `${path}#^${blockId}`;
}

function fileMetadataFromTFile(file: TFile): FileMetadata {
  return {
    path: file.path,
    name: file.name,
    parent: file.parent?.path ?? "/",
    type: file.extension === "md" ? "note" : "attachment",
    created: file.stat.ctime,
    modified: file.stat.mtime,
    size: file.stat.size,
  };
}

export class NavigationService {
  private lastChanged = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cacheChangeHandler: (...data: any[]) => any;

  constructor(private app: App) {
    this.cacheChangeHandler = (file: TFile) => {
      this.lastChanged.set(file.path, Date.now());
    };
    this.app.metadataCache.on("changed", this.cacheChangeHandler);
  }

  destroy(): void {
    this.app.metadataCache.off("changed", this.cacheChangeHandler);
  }

  private cacheAgeFor(path: string): number | undefined {
    const t = this.lastChanged.get(path);
    return t !== undefined ? Date.now() - t : undefined;
  }

  async execute(op: NavOp, params: unknown): Promise<unknown> {
    switch (op) {
      case "file_metadata":   return this.fileMetadata(params as FileMetadataParams);
      case "folder_list":     return this.folderList(params as FolderListParams);
      case "note_list":       return this.noteList(params as NoteListParams);
      case "attachment_list":  return this.attachmentList(params as AttachmentListParams);
      case "heading_outline":  return this.headingOutline(params as HeadingOutlineParams);
      case "block_resolve":    return this.blockResolve(params as BlockResolveParams);
      case "heading_search":   return this.headingSearch(params as HeadingSearchParams);
      case "note_read":        return this.noteRead(params as NoteReadParams);
      case "section_read":     return this.sectionRead(params as SectionReadParams);
      case "block_read":       return this.blockRead(params as BlockReadParams);
      case "lines_read":       return this.linesRead(params as LinesReadParams);
      case "backlinks":        return this.backlinks(params as BacklinksParams);
      case "forward_links":    return this.forwardLinks(params as ForwardLinksParams);
      case "unresolved_links": return this.unresolvedLinks(params as UnresolvedLinksParams);
      case "graph_traverse":   return this.graphTraverse(params as GraphTraverseParams);
      case "list_tags":        return this.listTags(params as ListTagsParams);
      case "notes_by_tag":     return this.notesByTag(params as NotesByTagParams);
      case "query_tags":        return this.queryTags(params as QueryTagsParams);
      case "frontmatter_get":   return this.frontmatterGet(params as FrontmatterGetParams);
      case "query_frontmatter": return this.queryFrontmatter(params as QueryFrontmatterParams);
      case "search":            return this.search(params as SearchParams);
      case "settle_cache":      return this.settleCache(params as { path: string; timeoutMs?: number });
      default: throw new NavError("invalid_query", `Unknown op: ${op}`);
    }
  }

  private fileMetadata(params: FileMetadataParams): FileMetadata & NavResultMeta {
    const { path } = params;
    if (!path) throw new NavError("invalid_query", "Missing path parameter");

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new NavError("not_found", `File not found: ${path}`);
    if (!(file instanceof TFile)) {
      throw new NavError("invalid_query", `Path is a folder, not a file: ${path}`);
    }

    return { ...fileMetadataFromTFile(file), cacheAge: this.cacheAgeFor(path) };
  }

  private folderList(params: FolderListParams): PagedResult<FolderEntry> {
    const { path, cursor, max_results } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder) throw new NavError("not_found", `Folder not found: ${path}`);
    if (!(folder instanceof TFolder)) {
      throw new NavError("invalid_query", `Path is a file, not a folder: ${path}`);
    }

    const children = folder.children;
    const offset = decodeCursor(cursor);
    const page = children.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < children.length;

    const items: FolderEntry[] = page.map((child) => {
      if (child instanceof TFile) {
        return fileMetadataFromTFile(child) as FolderEntry;
      }
      const subFolder = child as TFolder;
      return {
        path: subFolder.path,
        name: subFolder.name,
        parent: subFolder.parent?.path ?? "/",
        type: "attachment" as const,
        created: 0,
        modified: 0,
        size: 0,
        childCount: subFolder.children.length,
      };
    });

    return {
      items,
      total: children.length,
      truncated,
      nextCursor: truncated ? encodeCursor(nextOffset) : undefined,
    };
  }

  private noteList(params: NoteListParams): PagedResult<NoteFileMetadata> {
    const { glob, cursor, max_results, sort = "mtime_desc" } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    let files = this.app.vault.getMarkdownFiles();

    if (glob) {
      const re = globToRegex(glob);
      files = files.filter((f) => re.test(f.path));
    }

    switch (sort) {
      case "mtime_asc":
        files.sort((a, b) => a.stat.mtime - b.stat.mtime);
        break;
      case "name_asc":
        files.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        files.sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    const resolvedLinks = this.app.metadataCache.resolvedLinks;

    // Build reverse index (target -> inbound count) once per call.
    const inboundCounts = new Map<string, number>();
    for (const [_src, targets] of Object.entries(resolvedLinks)) {
      for (const target of Object.keys(targets)) {
        inboundCounts.set(target, (inboundCounts.get(target) ?? 0) + 1);
      }
    }

    const total = files.length;
    const offset = decodeCursor(cursor);
    const page = files.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    const items: NoteFileMetadata[] = page.map((file) => ({
      ...fileMetadataFromTFile(file),
      type: "note" as const,
      linkCountIn: inboundCounts.get(file.path) ?? 0,
      linkCountOut: Object.keys(resolvedLinks[file.path] ?? {}).length,
    }));

    return { items, total, truncated, nextCursor: truncated ? encodeCursor(nextOffset) : undefined };
  }

  private attachmentList(params: AttachmentListParams): PagedResult<FileMetadata> {
    const { folder, cursor, max_results } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    const mdPaths = new Set(this.app.vault.getMarkdownFiles().map((f) => f.path));
    let files = this.app.vault.getFiles().filter((f) => !mdPaths.has(f.path));

    if (folder) {
      const prefix = folder.endsWith("/") ? folder : `${folder}/`;
      files = files.filter((f) => f.path.startsWith(prefix) || f.parent?.path === folder);
    }

    const total = files.length;
    const offset = decodeCursor(cursor);
    const page = files.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return {
      items: page.map(fileMetadataFromTFile),
      total,
      truncated,
      nextCursor: truncated ? encodeCursor(nextOffset) : undefined,
    };
  }

  private async headingOutline(params: HeadingOutlineParams): Promise<{ path: string; outline: HeadingNode[]; cacheAge?: number }> {
    const { path } = params;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new NavError("not_found", `File not found: ${path}`);

    const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];

    // Get total line count for computing the last heading's endLine.
    const content = await this.app.vault.read(file);
    const totalLines = content.split("\n").length - 1;

    const roots: HeadingNode[] = [];
    const stack: HeadingNode[] = [];

    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const nextSameOrHigher = headings.slice(i + 1).find((n) => n.level <= h.level);
      const endLine = nextSameOrHigher
        ? nextSameOrHigher.position.start.line - 1
        : totalLines;

      const node: HeadingNode = {
        level: h.level,
        text: h.heading,
        line: h.position.start.line,
        endLine,
        id: toSectionId(path, h.heading),
        children: [],
      };

      // Pop stack entries that are at same or deeper level.
      while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        roots.push(node);
      } else {
        stack[stack.length - 1].children.push(node);
      }
      stack.push(node);
    }

    return { path, outline: roots, cacheAge: this.cacheAgeFor(path) };
  }

  private async blockResolve(params: BlockResolveParams): Promise<{ path: string; blocks: BlockRef[] }> {
    const { path, blockId } = params;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new NavError("not_found", `File not found: ${path}`);

    const cache = this.app.metadataCache.getFileCache(file);
    const blocksMap = cache?.blocks ?? {};
    const headings = cache?.headings ?? [];

    function nearestHeading(line: number): string | undefined {
      let best: string | undefined;
      for (const h of headings) {
        if (h.position.start.line <= line) best = h.heading;
        else break;
      }
      return best;
    }

    if (blockId !== undefined) {
      const block = blocksMap[blockId];
      if (!block) throw new NavError("not_found", `Block ^${blockId} not found in ${path}`);
      const line = block.position.start.line;
      return {
        path,
        blocks: [{
          blockId,
          id: toBlockId(path, blockId),
          line,
          headingContext: nearestHeading(line),
        }],
      };
    }

    const blocks: BlockRef[] = Object.entries(blocksMap).map(([id, block]) => {
      const line = block.position.start.line;
      return {
        blockId: id,
        id: toBlockId(path, id),
        line,
        headingContext: nearestHeading(line),
      };
    });

    return { path, blocks };
  }

  private async noteRead(params: NoteReadParams): Promise<NoteReadResult> {
    const { path, frontmatter: fm = "raw" } = params;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new NavError("not_found", `File not found: ${path}`);

    const raw = await this.app.vault.read(file);
    const lines = raw.split("\n");

    let body = raw;
    let frontmatterValue: string | Record<string, unknown> | undefined;

    const hasFrontmatter = lines[0] === "---";
    if (hasFrontmatter) {
      const closeIdx = lines.slice(1).findIndex((l) => l === "---");
      if (closeIdx !== -1) {
        const fmLines = lines.slice(1, closeIdx + 1);
        const bodyLines = lines.slice(closeIdx + 2);
        body = bodyLines.join("\n");

        if (fm === "raw") {
          frontmatterValue = fmLines.join("\n");
        } else if (fm === "parsed") {
          frontmatterValue = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
        }
      }
    }

    return {
      path,
      content: body,
      ...(fm !== "omit" && frontmatterValue !== undefined ? { frontmatter: frontmatterValue } : {}),
      lineCount: lines.length,
      cacheAge: this.cacheAgeFor(path),
    };
  }

  private async sectionRead(params: SectionReadParams): Promise<SectionReadResult> {
    const { path, heading } = params;
    const outlineResult = await this.headingOutline({ path });

    function flatten(nodes: HeadingNode[]): HeadingNode[] {
      const out: HeadingNode[] = [];
      for (const n of nodes) { out.push(n); out.push(...flatten(n.children)); }
      return out;
    }

    const lower = heading.trim().toLowerCase();
    const matches = flatten(outlineResult.outline).filter((n) => n.text.trim().toLowerCase() === lower);

    if (matches.length === 0) throw new NavError("not_found", `No heading matching "${heading}" in ${path}`);
    if (matches.length > 1) throw new NavError("ambiguous", `Multiple headings match "${heading}" in ${path}: ${matches.map((m) => m.text).join(", ")}`);

    const node = matches[0];
    const file = this.app.vault.getAbstractFileByPath(path) as TFile;
    const lines = (await this.app.vault.read(file)).split("\n");
    const content = lines.slice(node.line, node.endLine + 1).join("\n");

    return { path, heading: node.text, startLine: node.line, endLine: node.endLine, content, cacheAge: this.cacheAgeFor(path) };
  }

  private async blockRead(params: BlockReadParams): Promise<BlockReadResult> {
    const { path, blockId } = params;
    const resolveResult = await this.blockResolve({ path, blockId });

    if (resolveResult.blocks.length === 0) throw new NavError("not_found", `Block ^${blockId} not found in ${path}`);

    const blockRef = resolveResult.blocks[0];
    const file = this.app.vault.getAbstractFileByPath(path) as TFile;
    const lines = (await this.app.vault.read(file)).split("\n");

    const start = blockRef.line;
    // Walk back to start of paragraph (non-blank line before this one)
    let paraStart = start;
    while (paraStart > 0 && lines[paraStart - 1].trim() !== "" && !lines[paraStart - 1].startsWith("#")) {
      paraStart--;
    }
    // Walk forward to end of paragraph (next blank line or heading)
    let paraEnd = start;
    while (paraEnd + 1 < lines.length && lines[paraEnd + 1].trim() !== "" && !lines[paraEnd + 1].startsWith("#")) {
      paraEnd++;
    }

    return {
      path,
      blockId,
      content: lines.slice(paraStart, paraEnd + 1).join("\n"),
      headingContext: blockRef.headingContext,
      cacheAge: this.cacheAgeFor(path),
    };
  }

  private async linesRead(params: LinesReadParams): Promise<LinesReadResult> {
    const { path, startLine, endLine } = params;
    if (startLine < 0) throw new NavError("invalid_query", "startLine must be >= 0");
    if (endLine < startLine) throw new NavError("invalid_query", "endLine must be >= startLine");
    if (endLine - startLine > 500) throw new NavError("invalid_query", "Line range exceeds 500-line cap");

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new NavError("not_found", `File not found: ${path}`);

    const lines = (await this.app.vault.read(file)).split("\n");
    const content = lines.slice(startLine, endLine + 1).join("\n");

    return { path, startLine, endLine, content, cacheAge: this.cacheAgeFor(path) };
  }

  private static normaliseTag(tag: string): string {
    return tag.replace(/^#/, "").toLowerCase();
  }

  private static normaliseFrontmatterTags(raw: unknown): string[] {
    if (!raw) return [];
    if (typeof raw === "string") return raw ? [raw] : [];
    if (Array.isArray(raw)) return (raw as unknown[]).flatMap((t) => typeof t === "string" ? [t] : []);
    return [];
  }

  private collectFileTags(file: TFile): { inline: Array<{ tag: string; line: number }>; frontmatter: string[] } {
    const cache = this.app.metadataCache.getFileCache(file);
    const inline = (cache?.tags ?? []).map((t) => ({
      tag: NavigationService.normaliseTag(t.tag),
      line: t.position.start.line,
    }));
    const frontmatter = NavigationService.normaliseFrontmatterTags(cache?.frontmatter?.["tags"]).map(NavigationService.normaliseTag);
    return { inline, frontmatter };
  }

  private listTags(params: ListTagsParams): PagedResult<TagEntry> {
    const { prefix, max_results, cursor } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");
    const normPrefix = prefix ? NavigationService.normaliseTag(prefix) : undefined;

    const tagMap = new Map<string, { instances: number; notes: Set<string> }>();

    for (const file of this.app.vault.getMarkdownFiles()) {
      const { inline, frontmatter } = this.collectFileTags(file);
      const seen = new Set<string>();

      for (const { tag } of inline) {
        const entry = tagMap.get(tag) ?? { instances: 0, notes: new Set() };
        entry.instances++;
        entry.notes.add(file.path);
        tagMap.set(tag, entry);
        seen.add(tag);
      }
      for (const tag of frontmatter) {
        const entry = tagMap.get(tag) ?? { instances: 0, notes: new Set() };
        if (!seen.has(tag)) entry.instances++;
        entry.notes.add(file.path);
        tagMap.set(tag, entry);
      }
    }

    let entries = [...tagMap.entries()].map(([tag, { instances, notes }]): TagEntry => ({
      tag,
      instanceCount: instances,
      noteCount: notes.size,
    }));

    if (normPrefix) {
      entries = entries.filter((e) => e.tag === normPrefix || e.tag.startsWith(normPrefix + "/"));
    }

    entries.sort((a, b) => b.instanceCount - a.instanceCount);

    const total = entries.length;
    const offset = decodeCursor(cursor);
    const page = entries.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return { items: page, total, truncated, nextCursor: truncated ? encodeCursor(nextOffset) : undefined };
  }

  private notesByTag(params: NotesByTagParams): PagedResult<NoteTagResult> {
    const { tag, match = "prefix", source, max_results, cursor } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");
    const normTag = NavigationService.normaliseTag(tag);

    const matchesTag = (t: string) =>
      match === "exact" ? t === normTag : (t === normTag || t.startsWith(normTag + "/"));

    const results: NoteTagResult[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const { inline, frontmatter } = this.collectFileTags(file);
      const tags: NoteTagResult["tags"] = [];

      if (!source || source === "inline") {
        for (const { tag: t, line } of inline) {
          if (matchesTag(t)) tags.push({ tag: t, source: "inline", line });
        }
      }
      if (!source || source === "frontmatter") {
        for (const t of frontmatter) {
          if (matchesTag(t)) tags.push({ tag: t, source: "frontmatter" });
        }
      }

      if (tags.length > 0) {
        results.push({ path: file.path, tags, modified: file.stat.mtime });
      }
    }

    results.sort((a, b) => b.modified - a.modified);

    const total = results.length;
    const offset = decodeCursor(cursor);
    const page = results.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return { items: page, total, truncated, nextCursor: truncated ? encodeCursor(nextOffset) : undefined };
  }

  private queryTags(params: QueryTagsParams): PagedResult<NoteTagResult> {
    const { expr, max_results, cursor } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    const leafCount = { count: 0 };
    NavigationService.validateTagExpr(expr, 0, leafCount);

    const results: NoteTagResult[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const { inline, frontmatter } = this.collectFileTags(file);
      const allTags = new Set([...inline.map((i) => i.tag), ...frontmatter]);

      if (NavigationService.evalTagExpr(expr, allTags)) {
        const tags: NoteTagResult["tags"] = [
          ...inline.map(({ tag, line }) => ({ tag, source: "inline" as const, line })),
          ...frontmatter.map((tag) => ({ tag, source: "frontmatter" as const })),
        ];
        results.push({ path: file.path, tags, modified: file.stat.mtime });
      }
    }

    results.sort((a, b) => b.modified - a.modified);

    const total = results.length;
    const offset = decodeCursor(cursor);
    const page = results.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return { items: page, total, truncated, nextCursor: truncated ? encodeCursor(nextOffset) : undefined };
  }

  private static validateTagExpr(expr: TagExpr, depth: number, leafCount: { count: number }): void {
    if (depth > 8) throw new NavError("invalid_query", "Tag expression exceeds maximum depth of 8");
    if (expr.op === "tag") {
      leafCount.count++;
      if (leafCount.count > 20) throw new NavError("invalid_query", "Tag expression exceeds maximum of 20 leaf nodes");
    } else if (expr.op === "and" || expr.op === "or") {
      for (const operand of expr.operands) NavigationService.validateTagExpr(operand, depth + 1, leafCount);
    } else if (expr.op === "not") {
      NavigationService.validateTagExpr(expr.operand, depth + 1, leafCount);
    } else {
      throw new NavError("invalid_query", "Invalid tag expression op");
    }
  }

  private static evalTagExpr(expr: TagExpr, noteTags: Set<string>): boolean {
    if (expr.op === "tag") {
      const q = NavigationService.normaliseTag(expr.value);
      const matchType = expr.match ?? "prefix";
      for (const tag of noteTags) {
        if (matchType === "exact" ? tag === q : (tag === q || tag.startsWith(q + "/"))) return true;
      }
      return false;
    } else if (expr.op === "and") {
      return expr.operands.every((op: TagExpr) => NavigationService.evalTagExpr(op, noteTags));
    } else if (expr.op === "or") {
      return expr.operands.some((op: TagExpr) => NavigationService.evalTagExpr(op, noteTags));
    } else {
      return !NavigationService.evalTagExpr(expr.operand, noteTags);
    }
  }

  private nearestHeadingForLine(headings: { position: { start: { line: number } }; heading: string }[], line: number): string | undefined {
    let best: string | undefined;
    for (const h of headings) {
      if (h.position.start.line <= line) best = h.heading;
      else break;
    }
    return best;
  }

  private backlinks(params: BacklinksParams): PagedResult<LinkEntry> {
    const { path, types, max_results, cursor } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new NavError("not_found", `File not found: ${path}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backlinksDict = (this.app.metadataCache as any).getBacklinksForFile(file) as { data: Record<string, Array<{ link: string; original: string; position: { start: { line: number } } }>> };
    const entries: LinkEntry[] = [];

    for (const [sourcePath, refs] of Object.entries(backlinksDict.data)) {
      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      const sourceCache = sourceFile instanceof TFile ? this.app.metadataCache.getFileCache(sourceFile) : null;
      const headings = sourceCache?.headings ?? [];

      for (const ref of refs) {
        const type: LinkType = ref.original.startsWith("!") ? "embed" : ref.original.startsWith("[[") ? "wikilink" : "markdown";
        if (types && !types.includes(type)) continue;

        entries.push({
          sourcePath,
          targetPath: path,
          type,
          resolved: true,
          originalText: ref.original,
          line: ref.position.start.line,
          headingContext: this.nearestHeadingForLine(headings, ref.position.start.line),
        });
      }
    }

    const total = entries.length;
    const offset = decodeCursor(cursor);
    const page = entries.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return { items: page, total, truncated, nextCursor: truncated ? encodeCursor(nextOffset) : undefined };
  }

  private forwardLinks(params: ForwardLinksParams): PagedResult<LinkEntry> {
    const { path, types, includeUnresolved = true, max_results, cursor } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new NavError("not_found", `File not found: ${path}`);

    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache?.headings ?? [];
    const entries: LinkEntry[] = [];

    const processRef = (ref: { link: string; original: string; position: { start: { line: number } } }, type: LinkType) => {
      const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(ref.link, path);
      const resolved = resolvedFile !== null;
      if (!includeUnresolved && !resolved) return;
      if (types && !types.includes(type)) return;

      entries.push({
        sourcePath: path,
        targetPath: resolvedFile?.path ?? ref.link,
        type,
        resolved,
        originalText: ref.original,
        line: ref.position.start.line,
        headingContext: this.nearestHeadingForLine(headings, ref.position.start.line),
      });
    };

    for (const link of (cache?.links ?? [])) {
      processRef(link, link.original.startsWith("[[") ? "wikilink" : "markdown");
    }
    for (const embed of (cache?.embeds ?? [])) {
      processRef(embed, "embed");
    }

    const total = entries.length;
    const offset = decodeCursor(cursor);
    const page = entries.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return { items: page, total, truncated, nextCursor: truncated ? encodeCursor(nextOffset) : undefined };
  }

  private unresolvedLinks(params: UnresolvedLinksParams): PagedResult<UnresolvedTarget> {
    const { max_results, cursor } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    const unresolvedLinksMap = this.app.metadataCache.unresolvedLinks;
    const targetMap = new Map<string, Array<{ path: string; line: number; type: LinkType }>>();

    for (const [sourcePath, targets] of Object.entries(unresolvedLinksMap)) {
      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile)) continue;

      const sourceCache = this.app.metadataCache.getFileCache(sourceFile);
      const allRefs = [...(sourceCache?.links ?? []), ...(sourceCache?.embeds ?? [])];

      for (const target of Object.keys(targets)) {
        if (!targetMap.has(target)) targetMap.set(target, []);
        const sources = targetMap.get(target)!;

        const matching = allRefs.filter((r) => r.link === target || r.link.split("#")[0] === target);
        if (matching.length > 0) {
          for (const ref of matching) {
            const type: LinkType = ref.original.startsWith("!") ? "embed" : ref.original.startsWith("[[") ? "wikilink" : "markdown";
            sources.push({ path: sourcePath, line: ref.position.start.line, type });
          }
        } else {
          sources.push({ path: sourcePath, line: 0, type: "wikilink" });
        }
      }
    }

    const sorted: UnresolvedTarget[] = [...targetMap.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([target, sources]) => ({ target, sources }));

    const total = sorted.length;
    const offset = decodeCursor(cursor);
    const page = sorted.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return { items: page, total, truncated, nextCursor: truncated ? encodeCursor(nextOffset) : undefined };
  }

  private getNeighborEdges(path: string, edgeTypes: EdgeType): { outgoing: LinkEntry[]; incoming: LinkEntry[] } {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return { outgoing: [], incoming: [] };

    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache?.headings ?? [];
    const includeLinks = edgeTypes === "link" || edgeTypes === "both";
    const includeEmbeds = edgeTypes === "embed" || edgeTypes === "both";
    const outgoing: LinkEntry[] = [];
    const incoming: LinkEntry[] = [];

    if (includeLinks) {
      for (const link of (cache?.links ?? [])) {
        const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(link.link, path);
        if (!resolvedFile) continue;
        outgoing.push({
          sourcePath: path,
          targetPath: resolvedFile.path,
          type: link.original.startsWith("[[") ? "wikilink" : "markdown",
          resolved: true,
          originalText: link.original,
          line: link.position.start.line,
          headingContext: this.nearestHeadingForLine(headings, link.position.start.line),
        });
      }
    }

    if (includeEmbeds) {
      for (const embed of (cache?.embeds ?? [])) {
        const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(embed.link, path);
        if (!resolvedFile) continue;
        outgoing.push({
          sourcePath: path,
          targetPath: resolvedFile.path,
          type: "embed",
          resolved: true,
          originalText: embed.original,
          line: embed.position.start.line,
          headingContext: this.nearestHeadingForLine(headings, embed.position.start.line),
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const backlinksDict = (this.app.metadataCache as any).getBacklinksForFile(file) as { data: Record<string, Array<{ link: string; original: string; position: { start: { line: number } } }>> };
    for (const [sourcePath, refs] of Object.entries(backlinksDict.data)) {
      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      const sourceHeadings = (sourceFile instanceof TFile ? this.app.metadataCache.getFileCache(sourceFile) : null)?.headings ?? [];

      for (const ref of refs) {
        const isEmbed = ref.original.startsWith("!");
        if (isEmbed && !includeEmbeds) continue;
        if (!isEmbed && !includeLinks) continue;

        incoming.push({
          sourcePath,
          targetPath: path,
          type: isEmbed ? "embed" : (ref.original.startsWith("[[") ? "wikilink" : "markdown"),
          resolved: true,
          originalText: ref.original,
          line: ref.position.start.line,
          headingContext: this.nearestHeadingForLine(sourceHeadings, ref.position.start.line),
        });
      }
    }

    return { outgoing, incoming };
  }

  private graphTraverse(params: GraphTraverseParams): GraphTraverseResult {
    const { startPath, depth, direction = "both", edgeTypes = "both", nodeCap = 100 } = params;

    if (depth < 1 || depth > 5) throw new NavError("invalid_query", "depth must be between 1 and 5");
    const cap = Math.min(nodeCap, 500);

    const startFile = this.app.vault.getAbstractFileByPath(startPath);
    if (!startFile || !(startFile instanceof TFile)) throw new NavError("not_found", `File not found: ${startPath}`);

    const nodeMap = new Map<string, GraphNode>();
    const edgeSet = new Set<string>();
    const allEdges: LinkEntry[] = [];

    nodeMap.set(startPath, { path: startPath, depth: 0 });
    let frontier = [startPath];
    let truncated = false;
    let truncatedAtDepth: number | undefined;
    let truncatedAtNodeCap = false;

    outer: for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];

      for (const currentPath of frontier) {
        const { outgoing, incoming } = this.getNeighborEdges(currentPath, edgeTypes);
        const candidates: LinkEntry[] = [];
        if (direction === "outgoing" || direction === "both") candidates.push(...outgoing);
        if (direction === "incoming" || direction === "both") candidates.push(...incoming);

        for (const edge of candidates) {
          const key = `${edge.sourcePath}->${edge.targetPath}@${edge.line}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            allEdges.push(edge);
          }

          const neighborPath = edge.sourcePath === currentPath ? edge.targetPath : edge.sourcePath;
          if (!nodeMap.has(neighborPath)) {
            if (nodeMap.size >= cap) {
              truncated = true;
              truncatedAtNodeCap = true;
              truncatedAtDepth = d + 1;
              break outer;
            }
            nodeMap.set(neighborPath, { path: neighborPath, depth: d + 1 });
            nextFrontier.push(neighborPath);
          }
        }
      }

      frontier = nextFrontier;
    }

    return {
      nodes: [...nodeMap.values()],
      edges: allEdges,
      truncated,
      ...(truncatedAtDepth !== undefined ? { truncatedAtDepth } : {}),
      ...(truncatedAtNodeCap ? { truncatedAtNodeCap } : {}),
    };
  }

  private frontmatterGet(params: FrontmatterGetParams): FrontmatterResult {
    const { path } = params;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) throw new NavError("not_found", `File not found: ${path}`);

    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    // Strip Obsidian internal keys
    const fields: Record<string, FmValue> = {};
    for (const [k, v] of Object.entries(fm)) {
      if (k === "position") continue;
      fields[k] = v as FmValue;
    }
    return { path, fields, cacheAge: this.cacheAgeFor(path) };
  }

  private queryFrontmatter(params: QueryFrontmatterParams): PagedResult<FmQueryHit> {
    const { expr, fields, max_results, cursor } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    const leafCount = { count: 0 };
    NavigationService.validateFmExpr(expr, 0, leafCount);

    const results: FmQueryHit[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const raw = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const fm: Record<string, FmValue> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k === "position") continue;
        fm[k] = v as FmValue;
      }

      if (!NavigationService.evalFmExpr(expr, fm)) continue;

      const hitFields: Record<string, FmValue> = fields
        ? Object.fromEntries(fields.filter((f) => f in fm).map((f) => [f, fm[f]]))
        : fm;

      results.push({ path: file.path, fields: hitFields, modified: file.stat.mtime });
    }

    results.sort((a, b) => b.modified - a.modified);

    const total = results.length;
    const offset = decodeCursor(cursor);
    const page = results.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return { items: page, total, truncated, nextCursor: truncated ? encodeCursor(nextOffset) : undefined };
  }

  private static validateFmExpr(expr: FmExpr, depth: number, leafCount: { count: number }): void {
    if (depth > 8) throw new NavError("invalid_query", "Frontmatter expression exceeds maximum depth of 8");
    if (expr.op === "and" || expr.op === "or") {
      for (const operand of expr.operands) NavigationService.validateFmExpr(operand, depth + 1, leafCount);
    } else if (expr.op === "not") {
      NavigationService.validateFmExpr(expr.operand, depth + 1, leafCount);
    } else {
      leafCount.count++;
      if (leafCount.count > 20) throw new NavError("invalid_query", "Frontmatter expression exceeds maximum of 20 leaf nodes");
      if (expr.op === "regex") {
        try { new RegExp(expr.pattern); } catch {
          throw new NavError("invalid_query", `Invalid regex pattern: ${expr.pattern}`);
        }
      }
    }
  }

  private static evalFmExpr(expr: FmExpr, fm: Record<string, FmValue>): boolean {
    switch (expr.op) {
      case "and": return expr.operands.every((e: FmExpr) => NavigationService.evalFmExpr(e, fm));
      case "or":  return expr.operands.some((e: FmExpr) => NavigationService.evalFmExpr(e, fm));
      case "not": return !NavigationService.evalFmExpr(expr.operand, fm);
      case "exists": return expr.field in fm;
      case "eq":  return fm[expr.field] === expr.value;
      case "neq": return fm[expr.field] !== expr.value;
      case "gt":  return typeof fm[expr.field] === "number" && (fm[expr.field] as number) > expr.value;
      case "gte": return typeof fm[expr.field] === "number" && (fm[expr.field] as number) >= expr.value;
      case "lt":  return typeof fm[expr.field] === "number" && (fm[expr.field] as number) < expr.value;
      case "lte": return typeof fm[expr.field] === "number" && (fm[expr.field] as number) <= expr.value;
      case "in":  return expr.values.includes(fm[expr.field] as FmScalar);
      case "contains": {
        const fv = fm[expr.field];
        if (Array.isArray(fv)) return fv.includes(expr.value);
        if (typeof fv === "string" && typeof expr.value === "string") return fv.includes(expr.value);
        return false;
      }
      case "contains_all": {
        const fv = fm[expr.field];
        if (!Array.isArray(fv)) return false;
        return expr.values.every((v: FmScalar) => fv.includes(v));
      }
      case "intersects": {
        const fv = fm[expr.field];
        if (!Array.isArray(fv)) return false;
        return expr.values.some((v: FmScalar) => fv.includes(v));
      }
      case "regex": {
        const fv = fm[expr.field];
        return new RegExp(expr.pattern).test(String(fv));
      }
      default: return false;
    }
  }

  private async search(params: SearchParams): Promise<SearchResult> {
    const {
      query,
      isRegex = false,
      fields = ["body", "headings"],
      glob,
      sort = "mtime_desc",
      contextLines = 2,
      timeoutMs = 5000,
      max_results,
      cursor,
    } = params;

    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    const clampedContext = Math.min(contextLines, 10);
    const clampedTimeout = Math.min(timeoutMs, 30000);

    let pattern: RegExp | null = null;
    if (isRegex) {
      try {
        pattern = new RegExp(query, "gm");
      } catch {
        throw new NavError("invalid_query", `Invalid regex: ${query}`);
      }
    }

    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    const inboundCounts = new Map<string, number>();
    for (const targets of Object.values(resolvedLinks)) {
      for (const target of Object.keys(targets)) {
        inboundCounts.set(target, (inboundCounts.get(target) ?? 0) + 1);
      }
    }

    let files = this.app.vault.getMarkdownFiles();

    if (glob) {
      const re = globToRegex(glob);
      files = files.filter((f) => re.test(f.path));
    }

    switch (sort) {
      case "mtime_asc":       files.sort((a, b) => a.stat.mtime - b.stat.mtime); break;
      case "link_count_desc": files.sort((a, b) => (inboundCounts.get(b.path) ?? 0) - (inboundCounts.get(a.path) ?? 0)); break;
      case "path_asc":        files.sort((a, b) => a.path.localeCompare(b.path)); break;
      default:                files.sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    const offset = decodeCursor(cursor);
    const candidates = files.slice(offset);

    const hits: SearchMatch[] = [];
    let truncated = false;
    let timedOut = false;
    const startTime = Date.now();
    let fileIdx = 0;

    const matchesQuery = (text: string): boolean =>
      pattern ? pattern.test(text) : text.includes(query);

    const resetPattern = () => { if (pattern) pattern.lastIndex = 0; };

    for (const file of candidates) {
      if (Date.now() - startTime > clampedTimeout) {
        timedOut = true;
        break;
      }

      if (fields.includes("path")) {
        resetPattern();
        if (matchesQuery(file.path)) {
          hits.push({ notePath: file.path, line: 0, field: "path", matchedText: file.path, contextBefore: "", contextAfter: "" });
          if (hits.length >= max_results) { truncated = true; break; }
        }
        if (!fields.some((f) => f !== "path")) { fileIdx++; continue; }
      }

      const content = await this.app.vault.read(file);
      const lines = content.split("\n");

      let inFrontmatter = false;
      let frontmatterClosed = false;
      let inCodeBlock = false;

      const classifyLine = (i: number): SearchField[] => {
        const line = lines[i];
        if (i === 0 && line === "---") { inFrontmatter = true; return []; }
        if (inFrontmatter && !frontmatterClosed) {
          if (line === "---") { frontmatterClosed = true; inFrontmatter = false; }
          return ["frontmatter"];
        }
        if (/^```/.test(line)) { inCodeBlock = !inCodeBlock; return []; }
        if (inCodeBlock) return ["code_blocks"];
        if (/^#{1,6} /.test(line)) return ["headings"];
        return ["body"];
      };

      // Reset stateful vars for each file
      inFrontmatter = false;
      frontmatterClosed = false;
      inCodeBlock = false;

      for (let i = 0; i < lines.length; i++) {
        const lineFields = classifyLine(i);
        const activeFields = lineFields.filter((f) => fields.includes(f));
        if (activeFields.length === 0) continue;

        resetPattern();
        if (!matchesQuery(lines[i])) continue;

        const field = activeFields[0];
        const before = lines.slice(Math.max(0, i - clampedContext), i).join("\n");
        const after  = lines.slice(i + 1, i + 1 + clampedContext).join("\n");

        hits.push({
          notePath: file.path,
          line: i,
          field,
          matchedText: lines[i],
          contextBefore: before,
          contextAfter: after,
        });

        if (hits.length >= max_results) { truncated = true; break; }
      }

      if (truncated) break;
      fileIdx++;
    }

    const hasMore = !timedOut && !truncated && (offset + fileIdx) < files.length;

    return {
      items: hits,
      truncated,
      timedOut,
      ...(hasMore ? { nextCursor: encodeCursor(offset + fileIdx) } : {}),
    };
  }

  private headingSearch(params: HeadingSearchParams): PagedResult<HeadingSearchHit> {
    const { query, matchType = "substring", max_results, cursor } = params;
    if (max_results == null) throw new NavError("invalid_query", "max_results is required");

    let matcher: (text: string) => boolean;
    if (matchType === "exact") {
      matcher = (t) => t === query;
    } else if (matchType === "regex") {
      let re: RegExp;
      try {
        re = new RegExp(query);
      } catch {
        throw new NavError("invalid_query", `Invalid regex: ${query}`);
      }
      matcher = (t) => re.test(t);
    } else {
      const lower = query.toLowerCase();
      matcher = (t) => t.toLowerCase().includes(lower);
    }

    const hits: HeadingSearchHit[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
      for (const h of headings) {
        if (matcher(h.heading)) {
          hits.push({
            notePath: file.path,
            heading: h.heading,
            level: h.level,
            line: h.position.start.line,
            id: toSectionId(file.path, h.heading),
          });
        }
      }
    }

    const total = hits.length;
    const offset = decodeCursor(cursor);
    const page = hits.slice(offset, offset + max_results);
    const nextOffset = offset + max_results;
    const truncated = nextOffset < total;

    return {
      items: page,
      total,
      truncated,
      nextCursor: truncated ? encodeCursor(nextOffset) : undefined,
    };
  }

  async settleCache({ path, timeoutMs = 5000 }: { path: string; timeoutMs?: number }): Promise<{ path: string; settledAt: number }> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new NavError("not_found", `No file at path: ${path}`);

    return new Promise<{ path: string; settledAt: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.app.metadataCache.off("changed", handler);
        reject(new NavError("timeout", `Cache did not update for ${path} within ${timeoutMs}ms`));
      }, timeoutMs);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler: (...data: any[]) => any = (changedFile: TFile) => {
        if (changedFile.path === path) {
          clearTimeout(timer);
          this.app.metadataCache.off("changed", handler);
          resolve({ path, settledAt: Date.now() });
        }
      };
      this.app.metadataCache.on("changed", handler);
    });
  }
}
