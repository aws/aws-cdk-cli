import type { Environment } from '@aws-cdk/cx-api';
import type { CloudFormationStack } from './cloudformation';
import { ResourceLocation, ResourceMapping } from './cloudformation';
import { computeResourceDigests } from './digest';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { equalSets } from '../../util/sets';

/**
 * Represents a set of possible moves of a resource from one location
 * to another. In the ideal case, there is only one source and only one
 * destination.
 */
type ResourceMove = [ResourceLocation[], ResourceLocation[]];

export interface RefactoringContextOptions {
  environment: Environment;
  localStacks: CloudFormationStack[];
  deployedStacks: CloudFormationStack[];
  overrides?: ResourceMapping[];
  ignoreModifications?: boolean;
}

/**
 * Encapsulates the information for refactoring resources in a single environment.
 */
export class RefactoringContext {
  private readonly _mappings: ResourceMapping[] = [];
  private readonly ambiguousMoves: ResourceMove[] = [];
  public readonly environment: Environment;

  constructor(props: RefactoringContextOptions) {
    this.environment = props.environment;
    const moves = resourceMoves(props.deployedStacks, props.localStacks, props.ignoreModifications);
    const [nonAmbiguousMoves, ambiguousMoves] = partitionByAmbiguity(props.overrides ?? [], moves);
    this.ambiguousMoves = ambiguousMoves;
    this._mappings = resourceMappings(nonAmbiguousMoves);
  }

  public get ambiguousPaths(): [string[], string[]][] {
    return this.ambiguousMoves.map(([a, b]) => [convert(a), convert(b)]);

    function convert(locations: ResourceLocation[]): string[] {
      return locations.map((l) => l.toPath());
    }
  }

  public get mappings(): ResourceMapping[] {
    return this._mappings;
  }
}

function resourceMoves(
  before: CloudFormationStack[],
  after: CloudFormationStack[],
  ignoreModifications: boolean = false,
): ResourceMove[] {
  const digestsBefore = resourceDigests(before);
  const digestsAfter = resourceDigests(after);

  const stackNames = (stacks: CloudFormationStack[]) =>
    stacks
      .map((s) => s.stackName)
      .sort()
      .join(', ');
  if (!(ignoreModifications || isomorphic(digestsBefore, digestsAfter))) {
    const message = [
      'A refactor operation cannot add, remove or update resources. Only resource moves and renames are allowed. ',
      "Run 'cdk diff' to compare the local templates to the deployed stacks.\n",
      `Deployed stacks: ${stackNames(before)}`,
      `Local stacks: ${stackNames(after)}`,
    ];

    throw new ToolkitError(message.join('\n'));
  }

  return Object.values(removeUnmovedResources(zip(digestsBefore, digestsAfter)));
}

/**
 * Whether two sets of resources have the same elements (uniquely identified by the digest), and
 * each element is in the same number of locations. The locations themselves may be different.
 */
function isomorphic(a: Record<string, ResourceLocation[]>, b: Record<string, ResourceLocation[]>): boolean {
  const sameKeys = equalSets(new Set(Object.keys(a)), new Set(Object.keys(b)));
  return sameKeys && Object.entries(a).every(([digest, locations]) => locations.length === b[digest].length);
}

function removeUnmovedResources(moves: Record<string, ResourceMove>): Record<string, ResourceMove> {
  const result: Record<string, ResourceMove> = {};
  for (const [hash, [before, after]] of Object.entries(moves)) {
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
 * producing a resource move
 */
function zip(
  m1: Record<string, ResourceLocation[]>,
  m2: Record<string, ResourceLocation[]>,
): Record<string, ResourceMove> {
  const result: Record<string, ResourceMove> = {};

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
function resourceDigests(stacks: CloudFormationStack[]): Record<string, ResourceLocation[]> {
  // index stacks by name
  const stacksByName = new Map<string, CloudFormationStack>();
  for (const stack of stacks) {
    stacksByName.set(stack.stackName, stack);
  }

  const digests = computeResourceDigests(stacks);

  return groupByKey(
    Object.entries(digests).map(([loc, digest]) => {
      const [stackName, logicalId] = loc.split('.');
      const location: ResourceLocation = new ResourceLocation(stacksByName.get(stackName)!, logicalId);
      return [digest, location];
    }),
  );

  function groupByKey<A>(entries: [string, A][]): Record<string, A[]> {
    const result: Record<string, A[]> = {};

    for (const [key, value] of entries) {
      if (key in result) {
        result[key].push(value);
      } else {
        result[key] = [value];
      }
    }

    return result;
  }
}

function isAmbiguousMove(move: ResourceMove): boolean {
  const [pre, post] = move;

  // A move is considered ambiguous if two conditions are met:
  //  1. Both sides have at least one element (otherwise, it's just addition or deletion)
  //  2. At least one side has more than one element
  return pre.length > 0 && post.length > 0 && (pre.length > 1 || post.length > 1);
}

function resourceMappings(movements: ResourceMove[]): ResourceMapping[] {
  return movements
    .filter(([pre, post]) => pre.length === 1 && post.length === 1 && !pre[0].equalTo(post[0]))
    .map(([pre, post]) => new ResourceMapping(pre[0], post[0]));
}

/**
 * Partitions a list of moves into non-ambiguous and ambiguous moves.
 * @param overrides - The list of overrides to disambiguate moves
 * @param moves - a pair of lists of moves. First: non-ambiguous, second: ambiguous
 */
function partitionByAmbiguity(overrides: ResourceMapping[], moves: ResourceMove[]): [ResourceMove[], ResourceMove[]] {
  const ambiguous: ResourceMove[] = [];
  const nonAmbiguous: ResourceMove[] = [];

  for (let move of moves) {
    if (!isAmbiguousMove(move)) {
      nonAmbiguous.push(move);
    } else {
      for (const override of overrides) {
        const resolvedMove = resolve(override, move);
        if (resolvedMove != null) {
          nonAmbiguous.push(resolvedMove);
          move = remove(override, move);
        }
      }
      // One last chance to be non-ambiguous
      if (!isAmbiguousMove(move)) {
        nonAmbiguous.push(move);
      } else {
        ambiguous.push(move);
      }
    }
  }

  function resolve(override: ResourceMapping, move: ResourceMove): ResourceMove | undefined {
    const [pre, post] = move;
    const source = pre.find((loc) => loc.equalTo(override.source));
    const destination = post.find((loc) => loc.equalTo(override.destination));
    return (source && destination) ? [[source], [destination]] : undefined;
  }

  function remove(override: ResourceMapping, move: ResourceMove): ResourceMove {
    const [pre, post] = move;
    return [
      pre.filter(loc => !loc.equalTo(override.source)),
      post.filter(loc => !loc.equalTo(override.destination)),
    ];
  }

  return [nonAmbiguous, ambiguous];
}
