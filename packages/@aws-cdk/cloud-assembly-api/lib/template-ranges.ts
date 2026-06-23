import { parse, type Pointers } from 'json-source-map';

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
 * CloudFormation template. The range covers the value `{ ... }` under
 * `Resources/<logicalId>`, so `JSON.parse(text.slice(start, end))` returns the
 * resource object.
 *
 * Returns `undefined` when the text is not valid JSON, or when there is no such
 * resource.
 */
export function resolveResourceRange(templateText: string, logicalId: string): OffsetRange | undefined {
  const pointers = parsePointers(templateText);
  const mapping = pointers?.[`/Resources/${escapePointerSegment(logicalId)}`];
  if (mapping === undefined) {
    return undefined;
  }
  return { start: mapping.value.pos, end: mapping.valueEnd.pos };
}

/** A resource's block range plus the range of each of its top-level properties. */
export interface ResourceRanges {
  /** The resource's value block `{ ... }` (value-only, like {@link resolveResourceRange}). */
  readonly block: OffsetRange;
  /** Each top-level property keyed by name, covering the whole `"Key": value` entry. */
  readonly properties: Record<string, OffsetRange>;
}

/**
 * Resolves, in a single parse, a resource's block range and the range of each
 * of its top-level properties. Property ranges span `"Key": value` so a
 * navigation lands on the named property.
 *
 * Returns `undefined` when the text is not valid JSON or there is no such resource.
 */
export function resolveResourceRanges(templateText: string, logicalId: string): ResourceRanges | undefined {
  const pointers = parsePointers(templateText);
  if (pointers === undefined) {
    return undefined;
  }
  const escaped = escapePointerSegment(logicalId);
  const blockMapping = pointers[`/Resources/${escaped}`];
  if (blockMapping === undefined) {
    return undefined;
  }

  const properties: Record<string, OffsetRange> = {};
  for (const [pointer, mapping] of Object.entries(pointers)) {
    // This resource's top-level properties only; a matched member always has a key.
    const match = /^\/Resources\/([^/]+)\/Properties\/([^/]+)$/.exec(pointer);
    if (match === null || match[1] !== escaped || mapping.key === undefined) {
      continue;
    }
    properties[unescapePointerSegment(match[2])] = { start: mapping.key.pos, end: mapping.valueEnd.pos };
  }

  return { block: { start: blockMapping.value.pos, end: blockMapping.valueEnd.pos }, properties };
}

/**
 * The inverse of `resolveResourceRange`: given a character offset into a
 * template's text, returns the logical id of the resource whose block contains
 * that offset, for linking a position in the template back to its construct.
 *
 * Returns `undefined` when the text is not valid JSON, or when the offset is not
 * inside any `Resources/<logicalId>` block (for example whitespace, the
 * `Resources` key, or another top-level section).
 */
export function resolveLogicalIdAtOffset(templateText: string, offset: number): string | undefined {
  const pointers = parsePointers(templateText);
  if (pointers === undefined) {
    return undefined;
  }
  for (const [pointer, mapping] of Object.entries(pointers)) {
    // Match only top-level resources (`/Resources/<id>`), not nested property
    // pointers like `/Resources/<id>/Properties/...`.
    const match = /^\/Resources\/([^/]+)$/.exec(pointer);
    if (match && offset >= mapping.value.pos && offset < mapping.valueEnd.pos) {
      return unescapePointerSegment(match[1]);
    }
  }
  return undefined;
}

/** Parse the template into its JSON-pointer map, or `undefined` if it is not valid JSON. */
function parsePointers(templateText: string): Pointers | undefined {
  try {
    return parse(templateText).pointers;
  } catch {
    return undefined;
  }
}

/** Escape a single path segment for use in a JSON pointer. */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Reverse of `escapePointerSegment`. */
function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}
