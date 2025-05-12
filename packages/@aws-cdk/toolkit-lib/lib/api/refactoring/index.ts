import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
import {
  formatAmbiguousMappings as fmtAmbiguousMappings,
  formatTypedMappings as fmtTypedMappings,
} from '@aws-cdk/cloudformation-diff';
import { StringWriteStream } from '../streams';
import type { CloudFormationStack } from './cloudformation';
import { ResourceLocation, ResourceMapping } from './cloudformation';
import { computeResourceDigests, hashObject } from './digest';
import { type ExcludeList, NeverExclude } from './exclude';
import type { StackRetriever } from './stack-retriever';

export * from './exclude';

/**
 * Represents a set of possible movements of a resource from one location
 * to another. In the ideal case, there is only one source and only one
 * destination.
 */
export type ResourceMovement = [ResourceLocation[], ResourceLocation[]];

export class AmbiguityError extends Error {
  constructor(public readonly movements: ResourceMovement[]) {
    super('Ambiguous resource mappings');
  }

  public paths(): [string[], string[]][] {
    return this.movements.map(([a, b]) => [convert(a), convert(b)]);

    function convert(locations: ResourceLocation[]): string[] {
      return locations.map((l) => l.toPath());
    }
  }
}

function groupByKey<A>(entries: [string, A][]): Record<string, A[]> {
  const result: Record<string, A[]> = {};

  for (const [hash, location] of entries) {
    if (hash in result) {
      result[hash].push(location);
    } else {
      result[hash] = [location];
    }
  }

  return result;
}

export function resourceMovements(before: CloudFormationStack[], after: CloudFormationStack[]): ResourceMovement[] {
  return Object.values(
    removeUnmovedResources(
      zip(groupByKey(before.flatMap(resourceDigests)), groupByKey(after.flatMap(resourceDigests))),
    ),
  );
}

export function ambiguousMovements(movements: ResourceMovement[]) {
  // A movement is considered ambiguous if these two conditions are met:
  //  1. Both sides have at least one element (otherwise, it's just addition or deletion)
  //  2. At least one side has more than one element
  return movements
    .filter(([pre, post]) => pre.length > 0 && post.length > 0)
    .filter(([pre, post]) => pre.length > 1 || post.length > 1);
}

/**
 * Converts a list of unambiguous resource movements into a list of resource mappings.
 *
 */
export function resourceMappings(
  movements: ResourceMovement[],
  stacks?: CloudFormationStack[],
): ResourceMapping[] {
  const stacksPredicate =
    stacks == null
      ? () => true
      : (m: ResourceMapping) => {
        // Any movement that involves one of the selected stacks (either moving from or to)
        // is considered a candidate for refactoring.
        const stackNames = [m.source.stack.stackName, m.destination.stack.stackName];
        return stacks.some((stack) => stackNames.includes(stack.stackName));
      };

  return movements
    .filter(([pre, post]) => pre.length === 1 && post.length === 1 && !pre[0].equalTo(post[0]))
    .map(([pre, post]) => new ResourceMapping(pre[0], post[0]))
    .filter(stacksPredicate);
}

function removeUnmovedResources(m: Record<string, ResourceMovement>): Record<string, ResourceMovement> {
  const result: Record<string, ResourceMovement> = {};
  for (const [hash, [before, after]] of Object.entries(m)) {
    const common = before.filter((b) => after.some((a) => a.equalTo(b)));
    result[hash] = [
      before.filter((b) => !common.some((c) => b.equalTo(c))),
      after.filter((a) => !common.some((c) => a.equalTo(c))),
    ];
  }

  return result;
}

/**
 * For each hash, identifying a single resource, zip the two lists of locations,
 * producing a resource movement
 */
function zip(
  m1: Record<string, ResourceLocation[]>,
  m2: Record<string, ResourceLocation[]>,
): Record<string, ResourceMovement> {
  const result: Record<string, ResourceMovement> = {};

  for (const [hash, locations] of Object.entries(m1)) {
    if (hash in m2) {
      result[hash] = [locations, m2[hash]];
    } else {
      result[hash] = [locations, []];
    }
  }

  for (const [hash, locations] of Object.entries(m2)) {
    if (!(hash in m1)) {
      result[hash] = [[], locations];
    }
  }

  return result;
}

/**
 * Computes a list of pairs [digest, location] for each resource in the stack.
 */
function resourceDigests(stack: CloudFormationStack): [string, ResourceLocation][] {
  const digests = computeResourceDigests(stack.template);

  return Object.entries(digests).map(([logicalId, digest]) => {
    const location: ResourceLocation = new ResourceLocation(stack, logicalId);
    return [digest, location];
  });
}

/**
 * Compares the deployed state to the cloud assembly state, and finds all resources
 * that were moved from one location (stack + logical ID) to another. The comparison
 * is done per environment.
 */
export async function findResourceMovements(
  stacks: CloudFormationStack[],
  stackRetriever: StackRetriever,
  exclude: ExcludeList = new NeverExclude(),
): Promise<ResourceMovement[]> {
  const stackGroups: Map<string, [CloudFormationStack[], CloudFormationStack[]]> = new Map();

  // Group stacks by environment
  for (const stack of stacks) {
    const environment = stack.environment;
    const key = hashObject(environment);
    if (stackGroups.has(key)) {
      stackGroups.get(key)![1].push(stack);
    } else {
      // The first time we see an environment, we need to fetch all stacks deployed to it.
      const before = await stackRetriever.getDeployedStacks(environment);
      stackGroups.set(key, [before, [stack]]);
    }
  }

  const result: ResourceMovement[] = [];
  for (const [_, [before, after]] of stackGroups) {
    result.push(...resourceMovements(before, after));
  }

  return result.filter(mov => {
    const after = mov[1];
    return after.every(l => !exclude.isExcluded(l));
  });
}

export function formatTypedMappings(mappings: TypedMapping[]): string {
  const stream = new StringWriteStream();
  fmtTypedMappings(stream, mappings);
  return stream.toString();
}

export function formatAmbiguousMappings(paths: [string[], string[]][]): string {
  const stream = new StringWriteStream();
  fmtAmbiguousMappings(stream, paths);
  return stream.toString();
}
