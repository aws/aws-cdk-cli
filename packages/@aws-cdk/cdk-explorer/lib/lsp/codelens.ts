import { pathToFileURL } from 'url';
import type { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import { type CodeLens, type Command, type Range } from 'vscode-languageserver/node';
import { resourceTarget, type ResourceTarget } from './template-locator';
import type { ConstructNode } from '../core/assembly-reader';
import type { SourceLocation } from '../core/source-resolver';

/** Command the client registers to open a resource in its template. */
export const OPEN_RESOURCE_COMMAND = 'cdkExplorer.openResource';

/**
 * Build CodeLens entries for a single source file. For every construct whose
 * sourceLocation matches fileUri, group by line and emit one lens per line
 * summarising the CFN resources produced there.
 */
export function codeLensesForFile(index: ConstructIndex<ConstructNode>, fileUri: string): CodeLens[] {
  const matches = [...index]
    .filter((node) => isResourceOnFile(node, fileUri))
    .map((node) => ({ line: node.sourceLocation.line, node }));

  // Multiple resources can map to one line when an L2 construct fans out
  // (e.g. an L2 producing a primary resource + auxiliary resources).
  return [...groupBy(matches, (m) => m.line)].map(([line, group]) => ({
    range: lineRange(line),
    command: commandFor(group.map((m) => m.node)),
  }));
}

interface ResourceLensInfo {
  readonly logicalId: string;
  readonly cfnType: string;
}

/** One selectable resource in a lens: a display label and where to open it. */
export interface ResourceChoice {
  readonly label: string;
  readonly target: ResourceTarget;
}

/**
 * Builds the lens command for the resources on one line. The command carries an
 * array of resolvable resource choices; the client opens the only one directly
 * or shows a picker when several share a line (an L2 fanning out). Resources
 * whose target cannot be resolved are dropped, and a line where none resolve
 * stays title-only (empty command = no-op click).
 */
function commandFor(nodes: readonly ResourceConstruct[]): Command {
  const title = titleFor(nodes.map((n) => ({ logicalId: n.logicalId, cfnType: n.type })));
  const choices = nodes
    .map((node) => ({ label: `${node.type}  ${node.logicalId}`, target: resourceTarget(node) }))
    .filter((choice): choice is ResourceChoice => choice.target !== undefined);
  if (choices.length === 0) {
    return { title, command: '' };
  }
  return { title, command: OPEN_RESOURCE_COMMAND, arguments: [choices] };
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
export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
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
