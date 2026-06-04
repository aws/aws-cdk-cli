import { pathToFileURL } from 'url';
import { type CodeLens, type Range } from 'vscode-languageserver/node';
import type { ConstructNode } from '../core/assembly-reader';

/**
 * Build CodeLens entries for a single source file. For every construct whose
 * sourceLocation matches fileUri, group by line and emit one lens per line
 * summarising the CFN resources produced there.
 */
export function codeLensesForFile(tree: readonly ConstructNode[], fileUri: string): CodeLens[] {
  const matches: Array<{ line: number; resource: ResourceLensInfo }> = [];
  walk(tree, (node) => {
    if (!node.sourceLocation) return;
    // Skip wrapper nodes (no logicalId/type) — only the CFN resources have a lens.
    if (!node.logicalId || !node.type) return;
    if (pathToFileURL(node.sourceLocation.file).toString() !== fileUri) return;

    matches.push({
      line: node.sourceLocation.line,
      resource: { logicalId: node.logicalId, cfnType: node.type },
    });
  });

  // Multiple resources can map to one line when an L2 construct fans out
  // (e.g. an L2 producing a primary resource + auxiliary resources).
  const byLine = new Map<number, ResourceLensInfo[]>();
  for (const m of matches) {
    const list = byLine.get(m.line);
    if (list) list.push(m.resource);
    else byLine.set(m.line, [m.resource]);
  }

  const lenses: CodeLens[] = [];
  for (const [line, resources] of byLine) {
    // Empty command name = title-only lens; click does nothing for now.
    lenses.push({
      range: lineRange(line),
      command: { title: titleFor(resources), command: '' },
    });
  }
  return lenses;
}

interface ResourceLensInfo {
  readonly logicalId: string;
  readonly cfnType: string;
}

function lineRange(line1Based: number): Range {
  // LSP positions are 0-based. The editor renders the lens above this line.
  const line = Math.max(0, line1Based - 1);
  return { start: { line, character: 0 }, end: { line, character: 0 } };
}

function titleFor(resources: readonly ResourceLensInfo[]): string {
  if (resources.length === 1) {
    const r = resources[0];
    return `Creates: ${r.cfnType} [logical: ${r.logicalId}]`;
  }
  const ids = resources.map((r) => r.logicalId).join(', ');
  return `${resources.length} resources: ${ids}`;
}

function walk(nodes: readonly ConstructNode[], visit: (node: ConstructNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children.length > 0) walk(node.children, visit);
  }
}
