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
