function canonicaliseHeading(heading: string): string {
  return heading.trim().replace(/\s+/g, " ");
}

export function toSectionId(path: string, heading: string): string {
  return `${path}#${canonicaliseHeading(heading)}`;
}

export function toBlockId(path: string, blockId: string): string {
  return `${path}#^${blockId}`;
}

export function toLineId(path: string, line: number): string {
  return `${path}#L${line}`;
}

export interface ParsedNavId {
  path: string;
  fragment?: string;
  synthetic?: boolean;
}

export function parseNavId(id: string): ParsedNavId {
  const hashIdx = id.indexOf("#");
  if (hashIdx === -1) return { path: id };

  const path = id.slice(0, hashIdx);
  const fragment = id.slice(hashIdx + 1);

  // #L<n> is a synthetic line reference, not a real Obsidian anchor.
  const synthetic = /^L\d+$/.test(fragment);
  return { path, fragment, synthetic };
}
