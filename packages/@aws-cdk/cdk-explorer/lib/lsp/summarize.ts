import type { AssemblyResourceNode } from '../core/assembly-index-with-source-locations';

/** Distinct CFN types shown in an auxiliary histogram before "+N more". */
const MAX_HISTOGRAM_TYPES = 6;

/** Group auxiliary resources by short CFN type, most common first, e.g. "8× Subnet". */
export function histogram(nodes: readonly AssemblyResourceNode[]): string {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const short = node.cfnResource.type.split('::').pop() ?? node.cfnResource.type;
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${count}× ${type}`);
  const shown = parts.slice(0, MAX_HISTOGRAM_TYPES);
  return shown.join(', ') + (parts.length > shown.length ? `, … +${parts.length - shown.length} more` : '');
}
