import { findNodeAtLocation, findNodeAtOffset, getNodePath, parseTree, type Node } from 'jsonc-parser';

/**
 * A character-offset range into a template's text, as a half-open interval
 * `[start, end)`. Framework-neutral on purpose: consumers map offsets to their
 * own position model (for example the LSP via `TextDocument.positionAt`), which
 * keeps this package free of editor types and of the UTF-16 column subtlety.
 */
export interface OffsetRange {
  /** Start offset, a 0-based character index, inclusive. */
  readonly start: number;
  /** End offset, a 0-based character index, exclusive. */
  readonly end: number;
}

/**
 * Resolves the character range of a resource's value block inside a synthesized
 * CloudFormation template. The range covers the value node `{ ... }` under
 * `Resources/<logicalId>`, so `JSON.parse(text.slice(start, end))` returns the
 * resource object.
 *
 * Returns `undefined` when the text cannot be parsed into a JSON tree, or when
 * `logicalId` is not a resource under `Resources`. Uses a position-aware parse
 * rather than a line scan because real templates contain literal braces and
 * escaped quotes inside string values (for example `Fn::Sub` placeholders),
 * which defeats naive brace matching.
 */
export function resolveResourceRange(templateText: string, logicalId: string): OffsetRange | undefined {
  const root = parseTree(templateText);
  if (root === undefined) {
    return undefined;
  }
  const blockNode = findNodeAtLocation(root, ['Resources', logicalId]);
  return blockNode === undefined ? undefined : rangeOf(blockNode);
}

/**
 * The inverse of `resolveResourceRange`: given a character offset into a
 * template's text, returns the logical id of the resource whose block contains
 * that offset, for linking a position in the template back to its construct.
 *
 * Returns `undefined` when the text cannot be parsed, or when the offset is not
 * inside any `Resources/<logicalId>` block (for example whitespace, the
 * top-level `Resources` key, or another top-level section).
 */
export function resolveLogicalIdAtOffset(templateText: string, offset: number): string | undefined {
  const root = parseTree(templateText);
  if (root === undefined) {
    return undefined;
  }
  const node = findNodeAtOffset(root, offset);
  if (node === undefined) {
    return undefined;
  }
  // The path of any node inside a resource is ['Resources', <logicalId>, ...].
  // path[1] is always a key here; the typeof narrows getNodePath's string|number union.
  const path = getNodePath(node);
  if (path.length >= 2 && path[0] === 'Resources' && typeof path[1] === 'string') {
    return path[1];
  }
  return undefined;
}

/** The character range covered by a parsed node. */
function rangeOf(node: Node): OffsetRange {
  return { start: node.offset, end: node.offset + node.length };
}
