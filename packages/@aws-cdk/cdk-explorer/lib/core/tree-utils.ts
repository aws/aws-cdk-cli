import type { ConstructNode } from './assembly-reader';

/** Flatten a construct tree into a Map keyed by node.path for O(1) lookups. */
export function indexNodesByPath(tree: readonly ConstructNode[]): Map<string, ConstructNode> {
  const index = new Map<string, ConstructNode>();
  walk(tree, index);
  return index;
}

function walk(nodes: readonly ConstructNode[], out: Map<string, ConstructNode>): void {
  for (const node of nodes) {
    out.set(node.path, node);
    if (node.children.length > 0) walk(node.children, out);
  }
}
