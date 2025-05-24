import type { CloudFormationResource, CloudFormationStack } from './cloudformation';
import { ToolkitError } from '../../toolkit/toolkit-error';

/**
 * An immutable directed graph of resources from multiple CloudFormation stacks.
 */
export class ResourceGraph {
  private readonly edges: Record<string, Set<string>> = {};
  private readonly reverseEdges: Record<string, Set<string>> = {};
  private readonly _sortedNodes: string[] = [];

  constructor(stacks: Omit<CloudFormationStack, 'environment'>[]) {
    const exports: { [p: string]: { stackName: string; value: any } } = Object.fromEntries(
      stacks.flatMap((s) =>
        Object.values(s.template.Outputs ?? {})
          .filter((o) => o.Export != null && typeof o.Export.Name === 'string')
          .map(
            (o) =>
              [o.Export.Name, { stackName: s.stackName, value: o.Value }] as [
                string,
                {
                  stackName: string;
                  value: any;
                },
              ],
          ),
      ),
    );

    const resources = Object.fromEntries(
      stacks.flatMap((s) =>
        Object.entries(s.template.Resources ?? {}).map(
          ([id, res]) => [`${s.stackName}.${id}`, res] as [string, CloudFormationResource],
        ),
      ),
    );

    // 1. Build adjacency lists
    for (const id of Object.keys(resources)) {
      this.edges[id] = new Set();
      this.reverseEdges[id] = new Set();
    }

    // 2. Detect dependencies by searching for Ref/Fn::GetAtt
    const findDependencies = (stackName: string, value: any): string[] => {
      if (!value || typeof value !== 'object') return [];
      if (Array.isArray(value)) {
        return value.flatMap((res) => findDependencies(stackName, res));
      }
      if ('Ref' in value) {
        return [`${stackName}.${value.Ref}`];
      }
      if ('Fn::GetAtt' in value) {
        const refTarget = Array.isArray(value['Fn::GetAtt'])
          ? value['Fn::GetAtt'][0]
          : value['Fn::GetAtt'].split('.')[0];
        return [`${stackName}.${refTarget}`];
      }
      if ('Fn::ImportValue' in value) {
        const exp = exports[value['Fn::ImportValue']];
        const v = exp.value;
        if ('Fn::GetAtt' in v) {
          const id = Array.isArray(v['Fn::GetAtt']) ? v['Fn::GetAtt'][0] : v['Fn::GetAtt'].split('.')[0];
          return [`${exp.stackName}.${id}`];
        }
        if ('Ref' in v) {
          return [`${exp.stackName}.${v.Ref}`];
        }
        throw new ToolkitError(`Unrecognized export value: ${JSON.stringify(value)}`);
      }
      const result: string[] = [];
      if ('DependsOn' in value) {
        if (Array.isArray(value.DependsOn)) {
          result.push(...value.DependsOn.map((r: string) => `${stackName}.${r}`));
        } else {
          result.push(`${stackName}.${value.DependsOn}`);
        }
      }
      result.push(...Object.values(value).flatMap((res) => findDependencies(stackName, res)));
      return result;
    };

    for (const [id, res] of Object.entries(resources)) {
      const stackName = id.split('.')[0];
      const deps = findDependencies(stackName, res || {});
      for (const dep of deps) {
        if (dep in resources && dep !== id) {
          this.edges[id].add(dep);
          this.reverseEdges[dep].add(id);
        }
      }
    }

    // 3. Topological sort
    const outDegree = Object.keys(this.edges).reduce((acc, k) => {
      acc[k] = this.edges[k].size;
      return acc;
    }, {} as Record<string, number>);

    const queue = Object.keys(outDegree).filter((k) => outDegree[k] === 0);
    // const order: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      this._sortedNodes.push(node);
      for (const nxt of this.reverseEdges[node]) {
        outDegree[nxt]--;
        if (outDegree[nxt] === 0) {
          queue.push(nxt);
        }
      }
    }
  }

  /**
   * Returns the sorted nodes in topological order.
   */
  get sortedNodes(): string[] {
    return this._sortedNodes;
  }

  public inNeighbors(node: string): string[] {
    if (!(node in this.edges)) {
      throw new ToolkitError(`Node ${node} not found in the graph`);
    }
    return Array.from(this.reverseEdges[node] || []);
  }

  public outNeighbors(node: string): string[] {
    if (!(node in this.edges)) {
      throw new ToolkitError(`Node ${node} not found in the graph`);
    }
    return Array.from(this.edges[node] || []);
  }
}
