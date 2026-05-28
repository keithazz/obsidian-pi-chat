export interface NavResultMeta {
  cacheAge?: number   // ms since MetadataCache last processed the primary queried file(s)
}

export interface FileMetadata {
  path: string;
  name: string;
  parent: string;
  type: "note" | "attachment";
  created: number;
  modified: number;
  size: number;
}

export interface NoteFileMetadata extends FileMetadata {
  linkCountIn: number;
  linkCountOut: number;
}

export interface FolderEntry extends FileMetadata {
  childCount?: number;
}

export interface PagedResult<T> {
  items: T[];
  total?: number;
  nextCursor?: string;
  truncated: boolean;
}

export interface HeadingNode {
  level: number;
  text: string;
  line: number;
  endLine: number;
  id: string;
  children: HeadingNode[];
}

export interface BlockRef {
  blockId: string;
  id: string;
  line: number;
  headingContext?: string;
}

export interface HeadingSearchHit {
  notePath: string;
  heading: string;
  level: number;
  line: number;
  id: string;
}

export type FrontmatterInclude = "raw" | "parsed" | "omit"

export interface NoteReadResult extends NavResultMeta {
  path: string;
  content: string;
  frontmatter?: string | Record<string, unknown>;
  lineCount: number;
}

export interface SectionReadResult extends NavResultMeta {
  path: string;
  heading: string;
  startLine: number;
  endLine: number;
  content: string;
}

export interface BlockReadResult extends NavResultMeta {
  path: string;
  blockId: string;
  content: string;
  headingContext?: string;
}

export interface LinesReadResult extends NavResultMeta {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
}

export type { TagExpr, TagMatch, FmExpr, FmScalar } from "@educator-agency/shared"

export type FmValue = FmScalar | FmScalar[]

export interface FrontmatterResult extends NavResultMeta {
  path: string
  fields: Record<string, FmValue>
}

export interface FmQueryHit {
  path: string
  fields: Record<string, FmValue>
  modified: number
}

export type TagSource = "frontmatter" | "inline"

export interface TagEntry {
  tag: string
  instanceCount: number
  noteCount: number
}

export interface TagInstance {
  notePath: string
  source: TagSource
  line?: number
}

export interface NoteTagResult {
  path: string
  tags: Array<{ tag: string; source: TagSource; line?: number }>
  modified: number
}

export type SearchField = "body" | "headings" | "frontmatter" | "code_blocks" | "path"
export type SearchSort  = "mtime_desc" | "mtime_asc" | "link_count_desc" | "path_asc"

export interface SearchMatch {
  notePath: string
  line: number
  field: SearchField
  matchedText: string
  contextBefore: string
  contextAfter: string
}

export interface SearchResult {
  items: SearchMatch[]
  total?: number
  nextCursor?: string
  truncated: boolean
  timedOut: boolean
}

export type LinkType = "wikilink" | "markdown" | "embed"
export type LinkDirection = "incoming" | "outgoing" | "both"
export type EdgeType = "link" | "embed" | "both"

export interface LinkEntry {
  sourcePath: string
  targetPath: string
  type: LinkType
  resolved: boolean
  originalText: string
  line: number
  headingContext?: string
}

export interface UnresolvedTarget {
  target: string
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
