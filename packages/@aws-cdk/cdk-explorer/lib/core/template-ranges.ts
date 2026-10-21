import { findNodeAtLocation, parseTree, type Node, type ParseError } from 'jsonc-parser';

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

/** A template member's block range plus the range of each of its top-level properties. */
export interface ResourceRanges {
  /** The member's value block `{ ... }`, so `JSON.parse(text.slice(start, end))` returns it. */
  readonly block: OffsetRange;
  /**
   * Each top-level property keyed by name, covering the whole `"Key": value`
   * entry. Only resources have properties; empty for other sections.
   */
  readonly properties: Record<string, OffsetRange>;
}

/**
 * A template parsed once into a queryable range index. Every lookup below is a
 * view on that one index, so a caller resolving several logical ids (for example
 * a hover over a multi-resource construct) pays the parse cost once.
 */
export interface TemplateRanges {
  /** The logical id's value-block range, or `undefined` if there is no such member. */
  block(logicalId: string): OffsetRange | undefined;
  /** The logical id's block plus its top-level property ranges, or `undefined` if absent. */
  resource(logicalId: string): ResourceRanges | undefined;
  /** The logical id whose block contains `offset`, or `undefined` if none does. */
  logicalIdAt(offset: number): string | undefined;
}

/**
 * Parse a template once into a {@link TemplateRanges} index.
 *
 * A logical id is looked up across all top-level sections, so a `Parameter` or
 * an `Output` resolves as well as a `Resource`. Every lookup, forward and
 * reverse, reads the same index, so they cannot disagree about what a logical
 * id covers.
 *
 * Lookups on a template that is not valid JSON all come back empty
 * (`undefined`), rather than a wrong range.
 */
export function indexTemplateRanges(templateText: string): TemplateRanges {
  const root = parseTemplate(templateText);
  const index = root === undefined ? undefined : buildIndex(root);

  return {
    block: (logicalId) => index?.[logicalId]?.block,
    resource: (logicalId) => index?.[logicalId],
    logicalIdAt: (offset) => {
      for (const [logicalId, ranges] of Object.entries(index ?? {})) {
        if (offset >= ranges.block.start && offset < ranges.block.end) {
          return logicalId;
        }
      }
      return undefined;
    },
  };
}

/**
 * Resolves the character range of a logical id's value block inside a
 * synthesized CloudFormation template, so that
 * `JSON.parse(text.slice(start, end))` returns that resource.
 *
 * Returns `undefined` when the text is not valid JSON, or when there is no such
 * logical id.
 */
export function resolveResourceRange(templateText: string, logicalId: string): OffsetRange | undefined {
  return indexTemplateRanges(templateText).block(logicalId);
}

/**
 * The inverse of `resolveResourceRange`: given a character offset into a
 * template's text, returns the logical id whose block contains that offset, for
 * linking a position in the template back to its construct.
 *
 * Returns `undefined` when the text is not valid JSON, or when the offset is not
 * inside any logical id's block (for example whitespace, or the `Resources` key
 * itself).
 */
export function resolveLogicalIdAtOffset(templateText: string, offset: number): string | undefined {
  return indexTemplateRanges(templateText).logicalIdAt(offset);
}

/**
 * Index every top-level section's members by logical id. This is the only place
 * that locates anything; all lookups are views on its result.
 */
function buildIndex(root: Node): Record<string, ResourceRanges> {
  const index: Record<string, ResourceRanges> = {};
  const resourceIds = new Set<string>();

  for (const [section, sectionValue] of members(root)) {
    const isResources = section === 'Resources';
    for (const [logicalId, value] of members(sectionValue)) {
      // On a collision (a Parameter named after a Resource, say) the resource
      // wins: that is what a caller holding a logical id means by it.
      if (!isResources && resourceIds.has(logicalId)) {
        continue;
      }
      index[logicalId] = {
        block: nodeRange(value),
        properties: isResources ? memberRanges(findNodeAtLocation(value, ['Properties'])) : {},
      };
      if (isResources) {
        resourceIds.add(logicalId);
      }
    }
  }

  return index;
}

/**
 * Parse the template into its syntax tree, or `undefined` if it is not valid
 * JSON. jsonc-parser is a recovering parser, so we reject anything that reported
 * an error: a malformed template must yield no range rather than a wrong one.
 * Synthesized templates are always strict JSON, hence no comments or trailing
 * commas either.
 */
function parseTemplate(templateText: string): Node | undefined {
  const errors: ParseError[] = [];
  const root = parseTree(templateText, errors, { disallowComments: true, allowTrailingComma: false });
  return errors.length > 0 ? undefined : root;
}

function nodeRange(node: Node): OffsetRange {
  return { start: node.offset, end: node.offset + node.length };
}

/**
 * The members of an object node as `[name, valueNode]` pairs, in document
 * order. Anything that is not an object (or is absent) has no members.
 */
function members(node: Node | undefined): Array<[string, Node]> {
  if (node?.type !== 'object') {
    return [];
  }
  return (node.children ?? []).flatMap((property): Array<[string, Node]> => {
    const [key, value] = property.children ?? [];
    // A `property` node always has both, except mid-edit in a recovering parse
    // (which we already rejected), so this narrows the type.
    return key === undefined || value === undefined ? [] : [[key.value as string, value]];
  });
}

/** Each member of an object node keyed by name, ranged over the whole `"Key": value` entry. */
function memberRanges(node: Node | undefined): Record<string, OffsetRange> {
  if (node?.type !== 'object') {
    return {};
  }
  const ranges: Record<string, OffsetRange> = {};
  for (const property of node.children ?? []) {
    const key = property.children?.[0];
    if (key !== undefined) {
      ranges[key.value as string] = nodeRange(property);
    }
  }
  return ranges;
}
