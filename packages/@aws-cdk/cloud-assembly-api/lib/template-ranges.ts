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
  return indexTemplateRanges(templateText)?.block(logicalId);
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
  return indexTemplateRanges(templateText)?.resource(logicalId);
}

/**
 * A template parsed once into a queryable range index, so a caller resolving
 * several resources (for example a hover over a multi-resource construct) pays
 * the parse cost once instead of per resource.
 */
export interface TemplateRanges {
  /** The resource's value-block range, or `undefined` if there is no such resource. */
  block(logicalId: string): OffsetRange | undefined;
  /** The resource's block plus its top-level property ranges, or `undefined` if absent. */
  resource(logicalId: string): ResourceRanges | undefined;
}

/**
 * Parse a template once into a {@link TemplateRanges} index. Returns `undefined`
 * when the text is not valid JSON. The single-resource {@link resolveResourceRange}
 * and {@link resolveResourceRanges} are thin wrappers over this.
 */
export function indexTemplateRanges(templateText: string): TemplateRanges | undefined {
  const pointers = parsePointers(templateText);
  if (pointers === undefined) {
    return undefined;
  }
  return {
    block: (logicalId) => blockRange(pointers, escapePointerSegment(logicalId)),
    resource: (logicalId) => {
      const escaped = escapePointerSegment(logicalId);
      const block = blockRange(pointers, escaped);
      return block === undefined ? undefined : { block, properties: propertyRanges(pointers, escaped) };
    },
  };
}

/** The value-block range of `/Resources/<escapedId>`, or `undefined` if absent. */
function blockRange(pointers: Pointers, escapedId: string): OffsetRange | undefined {
  const mapping = pointers[`/Resources/${escapedId}`];
  return mapping === undefined ? undefined : { start: mapping.value.pos, end: mapping.valueEnd.pos };
}

/** Key+value ranges of each top-level property of `/Resources/<escapedId>`. */
function propertyRanges(pointers: Pointers, escapedId: string): Record<string, OffsetRange> {
  const properties: Record<string, OffsetRange> = {};
  for (const [pointer, mapping] of Object.entries(pointers)) {
    // This resource's top-level properties only. json-source-map types the key
    // position as optional (absent for array items); a /Properties/<name> pointer
    // is always an object member, so this narrows the type, not an impossible case.
    const match = /^\/Resources\/([^/]+)\/Properties\/([^/]+)$/.exec(pointer);
    if (match === null || match[1] !== escapedId || mapping.key === undefined) {
      continue;
    }
    properties[unescapePointerSegment(match[2])] = { start: mapping.key.pos, end: mapping.valueEnd.pos };
  }
  return properties;
}

/**
 * Resolves block and property ranges for ALL resources in a single parse pass.
 * Equivalent to calling `resolveResourceRanges` per logical ID, but O(1) parses
 * instead of O(N).
 */
export function resolveAllResourceRanges(templateText: string): Record<string, ResourceRanges> | undefined {
  const pointers = parsePointers(templateText);
  if (pointers === undefined) {
    return undefined;
  }

  const result: Record<string, ResourceRanges> = {};
  const resourceProperties = new Map<string, Record<string, OffsetRange>>();

  for (const [pointer, mapping] of Object.entries(pointers)) {
    const resourceMatch = /^\/Resources\/([^/]+)$/.exec(pointer);
    if (resourceMatch) {
      const id = unescapePointerSegment(resourceMatch[1]);
      result[id] = { block: { start: mapping.value.pos, end: mapping.valueEnd.pos }, properties: {} };
      continue;
    }
    const propMatch = /^\/Resources\/([^/]+)\/Properties\/([^/]+)$/.exec(pointer);
    if (propMatch && mapping.key !== undefined) {
      const id = unescapePointerSegment(propMatch[1]);
      let props = resourceProperties.get(id);
      if (!props) {
        props = {};
        resourceProperties.set(id, props);
      }
      props[unescapePointerSegment(propMatch[2])] = { start: mapping.key.pos, end: mapping.valueEnd.pos };
    }
  }

  for (const [id, props] of resourceProperties) {
    if (result[id]) {
      result[id] = { block: result[id].block, properties: props };
    }
  }

  return result;
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
