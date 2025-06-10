import type { Environment } from '@aws-cdk/cx-api';
import type { CloudFormationStack } from './cloudformation';
import { ResourceLocation, ResourceMapping } from './cloudformation';
import { computeResourceDigests } from './digest';
import { ToolkitError } from '../../toolkit/toolkit-error';
import type { SDK } from '../aws-auth/sdk';
import type { SdkProvider } from '../aws-auth/sdk-provider';
import { Mode } from '../plugin';
import { generateStackDefinitions } from './stack-definitions';
import { EnvironmentResourcesRegistry } from '../environment';
import type { IoHelper } from '../io/private';

/**
 * Represents a set of possible moves of a resource from one location
 * to another. In the ideal case, there is only one source and only one
 * destination.
 */
type ResourceMove = [ResourceLocation[], ResourceLocation[]];

export interface RefactorManagerOptions {
  environment: Environment;
  localStacks: CloudFormationStack[];
  deployedStacks: CloudFormationStack[];
  mappings?: ResourceMapping[];
  filteredStacks?: CloudFormationStack[];
}

/**
 * Encapsulates the information for refactoring resources in a single environment.
 */
export class RefactoringContext {
  public readonly environment: Environment;
  private readonly _mappings: ResourceMapping[] = [];
  private readonly ambiguousMoves: ResourceMove[] = [];
  private readonly localStacks: CloudFormationStack[];
  private readonly deployedStacks: CloudFormationStack[];

  constructor(props: RefactorManagerOptions) {
    this.environment = props.environment;
    this.localStacks = props.localStacks;
    this.deployedStacks = props.deployedStacks;

    if (props.mappings != null) {
      this._mappings = props.mappings;
    } else {
      const moves = resourceMoves(props.deployedStacks, props.localStacks);
      this.ambiguousMoves = moves.filter(isAmbiguousMove);
      const nonAmbiguousMoves = moves.filter((move) => !isAmbiguousMove(move));
      this._mappings = resourceMappings(nonAmbiguousMoves, props.filteredStacks);
    }
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

  public async execute(sdkProvider: SdkProvider, ioHelper: IoHelper): Promise<void> {
    if (this.mappings.length === 0) {
      return;
    }

    const sdk = (await sdkProvider.forEnvironment(this.environment, Mode.ForWriting)).sdk;

    await this.checkBootstrapVersion(sdk, ioHelper);

    const cfn = sdk.cloudFormation();
    const mappings = this.mappings;

    const input = {
      EnableStackCreation: true,
      ResourceMappings: mappings.map((m) => m.toCloudFormation()),
      StackDefinitions: generateStackDefinitions(mappings, this.deployedStacks, this.localStacks),
    };
    const refactor = await cfn.createStackRefactor(input);

    await cfn.waitUntilStackRefactorCreateComplete({
      StackRefactorId: refactor.StackRefactorId,
    });

    await cfn.executeStackRefactor({
      StackRefactorId: refactor.StackRefactorId,
    });

    await cfn.waitUntilStackRefactorExecuteComplete({
      StackRefactorId: refactor.StackRefactorId,
    });
  }

  private async checkBootstrapVersion(sdk: SDK, ioHelper: IoHelper) {
    const environmentResourcesRegistry = new EnvironmentResourcesRegistry();
    const envResources = environmentResourcesRegistry.for(this.environment, sdk, ioHelper);
    let bootstrapVersion: number | undefined = undefined;
    try {
      // Try to get the bootstrap version
      bootstrapVersion = (await envResources.lookupToolkit()).version;
    } catch (e) {
      // But if we can't, keep going. Maybe we can still succeed.
    }
    if (bootstrapVersion != null && bootstrapVersion < 28) {
      throw new ToolkitError(
        `The CDK toolkit stack in environment aws://${this.environment.account}/${this.environment.region} doesn't support refactoring. Please run 'cdk bootstrap' to update it.`,
      );
    }
  }
}

function resourceMoves(before: CloudFormationStack[], after: CloudFormationStack[]): ResourceMove[] {
  return Object.values(
    removeUnmovedResources(zip(groupByKey(resourceDigests(before)), groupByKey(resourceDigests(after)))),
  );
}

function removeUnmovedResources(m: Record<string, ResourceMove>): Record<string, ResourceMove> {
  const result: Record<string, ResourceMove> = {};
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

/**
 * Computes a list of pairs [digest, location] for each resource in the stack.
 */
function resourceDigests(stacks: CloudFormationStack[]): [string, ResourceLocation][] {
  // index stacks by name
  const stacksByName = new Map<string, CloudFormationStack>();
  for (const stack of stacks) {
    stacksByName.set(stack.stackName, stack);
  }

  const digests = computeResourceDigests(stacks);

  return Object.entries(digests).map(([loc, digest]) => {
    const [stackName, logicalId] = loc.split('.');
    const location: ResourceLocation = new ResourceLocation(stacksByName.get(stackName)!, logicalId);
    return [digest, location];
  });
}

function isAmbiguousMove(move: ResourceMove): boolean {
  const [pre, post] = move;

  // A move is considered ambiguous if two conditions are met:
  //  1. Both sides have at least one element (otherwise, it's just addition or deletion)
  //  2. At least one side has more than one element
  return pre.length > 0 && post.length > 0 && (pre.length > 1 || post.length > 1);
}

function resourceMappings(movements: ResourceMove[], stacks?: CloudFormationStack[]): ResourceMapping[] {
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
