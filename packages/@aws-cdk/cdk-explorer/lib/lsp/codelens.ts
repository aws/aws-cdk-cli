import { pathToFileURL } from 'url';
import type { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import { type CodeLens, type Range } from 'vscode-languageserver/node';
import type { ConstructNode } from '../core/assembly-reader';
import type { SourceLocation } from '../core/source-resolver';

/**
 * Build CodeLens entries for a single source file. For every construct whose
 * sourceLocation matches fileUri, group by line and emit one lens per line
 * summarising the CFN resources produced there.
 */
export function codeLensesForFile(index: ConstructIndex<ConstructNode>, fileUri: string): CodeLens[] {
  const matches = [...index]
    .filter((node) => isResourceOnFile(node, fileUri))
    .map((node) => ({
      line: node.sourceLocation.line,
      resource: { logicalId: node.logicalId, cfnType: node.type },
    }));

  // Multiple resources can map to one line when an L2 construct fans out
  // (e.g. an L2 producing a primary resource + auxiliary resources).
  // Empty command name = title-only lens; click does nothing for now.
  return [...groupBy(matches, (m) => m.line)].map(([line, group]) => ({
    range: lineRange(line),
    command: { title: titleFor(group.map((m) => m.resource)), command: '' },
  }));
}

interface ResourceLensInfo {
  readonly logicalId: string;
  readonly cfnType: string;
}

/** A construct that produces a CFN resource and carries a source location. */
interface ResourceConstruct extends ConstructNode {
  readonly sourceLocation: SourceLocation;
  readonly logicalId: string;
  readonly type: string;
}

/**
 * A node gets a lens only if it maps to a CFN resource (has logicalId + type)
 * and has a source location in the requested file. Wrapper nodes and non-TS
 * constructs are excluded.
 */
function isResourceOnFile(node: ConstructNode, fileUri: string): node is ResourceConstruct {
  return (
    node.sourceLocation !== undefined &&
    node.logicalId !== undefined &&
    node.type !== undefined &&
    pathToFileURL(node.sourceLocation.file).toString() === fileUri
  );
}

/** Group items by a derived key, preserving first-seen order. */
function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
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
