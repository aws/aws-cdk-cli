import * as cxapi from '@aws-cdk/cloud-assembly-api';
import { WorkGraph } from './work-graph';
import { DeploymentState } from './work-graph-types';
import type { IoHelper } from '../io/private';

/**
 * Build a WorkGraph for destroy with reversed dependencies.
 *
 * In deploy order, if A depends on B, B is deployed first. For destroy,
 * the arrows are reversed: A must be destroyed before B.
 */
export function buildDestroyWorkGraph(stacks: cxapi.CloudFormationStackArtifact[], ioHelper: IoHelper): WorkGraph {
  const graph = new WorkGraph({}, ioHelper);
  const selectedIds = new Set(stacks.map((s) => s.id));

  for (const stack of stacks) {
    graph.addNodes({
      type: 'stack',
      id: stack.id,
      dependencies: new Set<string>(),
      stack,
      deploymentState: DeploymentState.PENDING,
      priority: 0,
    });
  }

  for (const stack of stacks) {
    for (const dep of stack.dependencies) {
      if (cxapi.CloudFormationStackArtifact.isCloudFormationStackArtifact(dep) && selectedIds.has(dep.id)) {
        graph.addDependency(dep.id, stack.id);
      }
    }
  }

  return graph;
}
