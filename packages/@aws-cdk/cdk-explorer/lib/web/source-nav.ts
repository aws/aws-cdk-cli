import type { WebConstructNode } from './protocol';

/**
 * A construct anchored to a line in a source file, paired with the template
 * coordinates needed to navigate to its resource. Produced by
 * {@link buildSourceAnchorIndex} and consumed by {@link findConstructAtLine}.
 */
export interface SourceAnchor {
  /** The construct's source line (its creation line). */
  readonly line: number;
  /** The construct that owns this line. */
  readonly node: WebConstructNode;
}

/**
 * Build a per-file index of the constructs that can be navigated from source to
 * template, each file's anchors sorted by line ascending.
 *
 * Only constructs carrying both a source location and template coordinates
 * (`templateFile` + `logicalId`) are indexed, since those are exactly the ones
 * a source-to-template navigation can resolve to a template resource. The tree
 * is walked depth-first; ties on the same line keep tree order.
 */
export function buildSourceAnchorIndex(tree: readonly WebConstructNode[]): Map<string, SourceAnchor[]> {
  const byFile = new Map<string, SourceAnchor[]>();

  const walk = (nodes: readonly WebConstructNode[]): void => {
    for (const node of nodes) {
      const loc = node.sourceLocation;
      if (loc && node.templateFile && node.logicalId) {
        const anchors = byFile.get(loc.file);
        if (anchors) {
          anchors.push({ line: loc.line, node });
        } else {
          byFile.set(loc.file, [{ line: loc.line, node }]);
        }
      }
      walk(node.children);
    }
  };
  walk(tree);

  for (const anchors of byFile.values()) {
    anchors.sort((a, b) => a.line - b.line);
  }
  return byFile;
}

/**
 * Resolve which construct a source line belongs to: the one whose definition is
 * nearest at or above `line`. Source anchors are single lines (a construct's
 * creation line), not ranges, so a construct is treated as owning every line
 * from its definition down to the next construct's. Returns `undefined` when
 * `line` sits above the first construct in the file, or when there are no
 * anchors.
 *
 * When several constructs share the nearest line (a parent and its synthesized
 * children are all anchored to the single `new Xyz(...)` line), the top-most one
 * wins, since that is the construct the user actually authored on that line. The
 * depth-first pre-order of {@link buildSourceAnchorIndex} places it first, so on
 * a tie we keep the earliest match rather than overwriting it.
 *
 * `anchors` must be sorted by line ascending, as produced by
 * {@link buildSourceAnchorIndex}.
 */
export function findConstructAtLine(
  anchors: readonly SourceAnchor[] | undefined,
  line: number,
): WebConstructNode | undefined {
  if (!anchors) {
    return undefined;
  }
  let match: WebConstructNode | undefined;
  let matchLine = -Infinity;
  for (const anchor of anchors) {
    if (anchor.line > line) {
      break;
    }
    // Anchors are line-ascending, so a strictly greater line is a nearer owner;
    // an equal line is a same-line child, which must not displace its parent.
    if (anchor.line > matchLine) {
      match = anchor.node;
      matchLine = anchor.line;
    }
  }
  return match;
}
