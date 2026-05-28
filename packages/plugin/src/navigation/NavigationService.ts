import { App, TFile, TFolder } from "obsidian";
import type { NavOp } from "@educator-agency/shared";
import { NavError } from "./errors";
import type { BlockRef, FileMetadata, FolderEntry, HeadingNode, HeadingSearchHit, NoteFileMetadata, PagedResult } from "./types";

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
  constructor(private app: App) {}

  async execute(op: NavOp, params: unknown): Promise<unknown> {
    switch (op) {
      case "file_metadata":   return this.fileMetadata(params as FileMetadataParams);
      case "folder_list":     return this.folderList(params as FolderListParams);
      case "note_list":       return this.noteList(params as NoteListParams);
      case "attachment_list":  return this.attachmentList(params as AttachmentListParams);
      case "heading_outline":  return this.headingOutline(params as HeadingOutlineParams);
      case "block_resolve":    return this.blockResolve(params as BlockResolveParams);
      case "heading_search":   return this.headingSearch(params as HeadingSearchParams);
      default: throw new NavError("invalid_query", `Unknown op: ${op}`);
    }
  }

  private fileMetadata(params: FileMetadataParams): FileMetadata {
    const { path } = params;
    if (!path) throw new NavError("invalid_query", "Missing path parameter");

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) throw new NavError("not_found", `File not found: ${path}`);
    if (!(file instanceof TFile)) {
      throw new NavError("invalid_query", `Path is a folder, not a file: ${path}`);
    }

    return fileMetadataFromTFile(file);
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

  private async headingOutline(params: HeadingOutlineParams): Promise<{ path: string; outline: HeadingNode[] }> {
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

    return { path, outline: roots };
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

  private headingSearch(params: HeadingSearchParams): PagedResult<HeadingSearchHit> {
    const { query, matchType = "substring", max_results, cursor } = params;

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
}
