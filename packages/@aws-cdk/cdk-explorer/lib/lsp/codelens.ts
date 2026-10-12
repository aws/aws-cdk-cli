import { type CodeLens, type Command, type Range } from 'vscode-languageserver/node';
import { COMMAND_DISABLE_AUTO_SYNTH, COMMAND_ENABLE_AUTO_SYNTH, COMMAND_SYNTH_NOW } from './commands';
import { resourceTarget, type ResourceTarget } from './template-locator';
import { type AssemblyResourceNode, isResourceNode, type AssemblyIndexWithSourceLocations } from '../core/assembly-index-with-source-locations';

/** Command the client registers to open a resource in its template. */
export const OPEN_RESOURCE_COMMAND = 'cdkExplorer.openResource';

/**
 * Build CodeLens entries for a single source file. Returns an empty array if
 * no CDK resources in the index map to `fileUri`.
 *
 * When resources are found, two header lenses are prepended at line 0:
 * - `autoSynthEnabled = false`: "↻ Synth now" + "▶ Enable auto-synth"
 * - `autoSynthEnabled = true`: "⏹ Disable auto-synth" (saves trigger synth)
 *
 * The remaining lenses are one per source line, each summarising the CFN
 * resources produced there (multiple L2 fan-out resources are grouped).
 *
 * @param autoSynthEnabled - current toggle state; controls which header lenses appear
 */
export async function codeLensesForFile(
  index: AssemblyIndexWithSourceLocations,
  assemblyDir: string,
  filePath: string,
  autoSynthEnabled: boolean,
): Promise<CodeLens[]> {
  const matches = index.constructsInSourceFile(filePath)
    .filter(([_, x]) => isResourceNode(x))
    .map(([line, node]) => ({ line, node: node as AssemblyResourceNode }));

  // Multiple resources can map to one line when an L2 construct fans out
  // (e.g. an L2 producing a primary resource + auxiliary resources). Resolve
  // sequentially so the number of concurrent reads never grows with app size.
  const l1Lenses: CodeLens[] = [];
  for (const [line, group] of groupBy(matches, (m) => m.line)) {
    l1Lenses.push({
      range: lineRange(line),
      command: await commandFor(assemblyDir, group.map((m) => m.node)),
    });
  }

  if (l1Lenses.length === 0) return [];

  const header0: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  // When auto-synth is off, show "Synth now" + "Enable auto-synth".
  // When auto-synth is on, show only "Disable auto-synth" (saves handle synth).
  const headerLenses: CodeLens[] = autoSynthEnabled
    ? [{ range: header0, command: { title: '⏹ Disable auto-synth', command: COMMAND_DISABLE_AUTO_SYNTH } }]
    : [
      { range: header0, command: { title: '↻ Synth now', command: COMMAND_SYNTH_NOW } },
      { range: header0, command: { title: '▶ Enable auto-synth', command: COMMAND_ENABLE_AUTO_SYNTH } },
    ];
  return [...headerLenses, ...l1Lenses];
}

/**
 * One selectable resource on a lens, shaped as a VS Code QuickPick item so the
 * client renders it directly: `label` is the CFN type, `description` the
 * developer-facing construct name.
 */
interface ResourceChoice {
  readonly label: string;
  readonly description: string;
  readonly target: ResourceTarget;
}

/**
 * Builds the lens command for one line's resources: resolvable choices the
 * client opens directly (one) or via a picker (several). Unresolvable resources
 * are dropped; a line where none resolve stays title-only.
 */
async function commandFor(assemblyDir: string, nodes: readonly AssemblyResourceNode[]): Promise<Command> {
  const title = titleFor(nodes);
  const choices: ResourceChoice[] = [];
  for (const node of nodes) {
    const target = await resourceTarget(assemblyDir, node);
    if (target !== undefined) {
      choices.push({ label: node.cfnResource.type, description: friendlyName(node.constructPath), target });
    }
  }
  if (choices.length === 0) {
    return { title, command: '' };
  }
  return { title, command: OPEN_RESOURCE_COMMAND, arguments: [choices] };
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

function titleFor(resources: readonly AssemblyResourceNode[]): string {
  if (resources.length === 1) {
    return `Creates ${resources[0].cfnResource.type}`;
  }
  const types = resources.map((r) => r.cfnResource.type).join(', ');
  return `Creates ${resources.length} resources: ${types}`;
}

/** Developer-facing construct name: the construct path without the synthetic CfnResource leaf. */
function friendlyName(constructPath: string): string {
  const segments = constructPath.split('/');
  const leaf = segments[segments.length - 1];
  if (segments.length > 1 && (leaf === 'Resource' || leaf === 'Default')) {
    segments.pop();
  }
  return segments.join('/');
}
