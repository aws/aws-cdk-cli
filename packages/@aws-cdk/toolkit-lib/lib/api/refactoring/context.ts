import { DefaultAwsClient, type IAws } from '@aws-cdk/cdk-assets-lib';
import type { Environment } from '@aws-cdk/cloud-assembly-api';
import { EnvironmentPlaceholders } from '@aws-cdk/cloud-assembly-api';
import type { StackDefinition } from '@aws-sdk/client-cloudformation';
import type { CloudFormationStack } from './cloudformation';
import { ResourceLocation, ResourceMapping } from './cloudformation';
import type { GraphDirection } from './digest';
import { computeResourceDigests } from './digest';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { equalSets, setDiff } from '../../util/sets';
import type { SDK } from '../aws-auth/sdk';
import type { SdkProvider } from '../aws-auth/sdk-provider';
import { EnvironmentResourcesRegistry } from '../environment';
import type { IoHelper } from '../io/private';
import { Mode } from '../plugin';

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
  assumeRoleArn?: string;
  ignoreModifications?: boolean;
}

/**
 * Encapsulates the information for refactoring resources in a single environment.
 */
export class RefactoringContext {
  private readonly _mappings: ResourceMapping[] = [];
  private readonly ambiguousMoves: ResourceMove[] = [];
  private readonly localStacks: CloudFormationStack[];
  private readonly assumeRoleArn?: string;
  public readonly environment: Environment;

  constructor(props: RefactoringContextOptions) {
    this.environment = props.environment;
    const moves = resourceMoves(props.deployedStacks, props.localStacks, 'direct', props.ignoreModifications);
    const additionalOverrides = structuralOverrides(props.deployedStacks, props.localStacks);
    const overrides = (props.overrides ?? []).concat(additionalOverrides);
    const [nonAmbiguousMoves, ambiguousMoves] = partitionByAmbiguity(overrides, moves);
    this.ambiguousMoves = ambiguousMoves;
    this.localStacks = props.localStacks;
    this.assumeRoleArn = props.assumeRoleArn;

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

  public async execute(stackDefinitions: StackDefinition[], sdkProvider: SdkProvider, ioHelper: IoHelper): Promise<void> {
    if (this.mappings.length === 0) {
      return;
    }

    const assumeRoleArn = this.assumeRoleArn ?? await this.findRoleToAssume(sdkProvider);
    const sdk = (
      await sdkProvider.forEnvironment(this.environment, Mode.ForWriting, {
        assumeRoleArn,
      })
    ).sdk;

    await this.checkBootstrapVersion(sdk, ioHelper);

    const cfn = sdk.cloudFormation();
    const mappings = this.mappings;

    const input = {
      ResourceMappings: mappings.map((m) => m.toCloudFormation()),
      StackDefinitions: stackDefinitions,
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
      const environment = `aws://${this.environment.account}/${this.environment.region}`;
      throw new ToolkitError(
        `The CDK toolkit stack in environment ${environment} doesn't support refactoring. Please run 'cdk bootstrap ${environment}' to update it.`,
      );
    }
  }

  private async findRoleToAssume(sdkProvider: SdkProvider): Promise < string | undefined > {
    // To execute a refactor, we need the deployment role ARN for the given
    // environment. Most toolkit commands get the information about which roles to
    // assume from the cloud assembly (and ultimately from the CDK framework). Refactor
    // is different because it is not the application/framework that dictates what the
    // toolkit should do, but it is the toolkit itself that has to figure it out.
    //
    // Nevertheless, the cloud assembly is the most reliable source for this kind of
    // information. For the deployment role ARN, in particular, what we do here
    // is look at all the stacks for a given environment in the cloud assembly and
    // extract the deployment role ARN that is common to all of them. If no role is
    // found, we go ahead without assuming a role. If there is more than one role,
    // we consider that an invariant was violated, and throw an error.

    const env = this.environment;
    const roleArns = new Set(
      this.localStacks
        .filter((s) => s.environment.account === env.account && s.environment.region === env.region)
        .map((s) => s.assumeRoleArn),
    );

    if (roleArns.size === 0) {
      return undefined;
    }

    if (roleArns.size !== 1) {
      // Unlikely to happen. But if it does, we can't proceed
      throw new ToolkitError(
        `Multiple stacks in environment aws://${env.account}/${env.region} have different deployment role ARNs. Cannot proceed.`,
      );
    }

    const arn = Array.from(roleArns)[0];
    if (arn != null) {
      const resolvedEnv = await sdkProvider.resolveEnvironment(env);
      const region = resolvedEnv.region;
      return (await replaceAwsPlaceholders({ region, assumeRoleArn: arn }, new DefaultAwsClient())).assumeRoleArn;
    }

    // If we couldn't find a role ARN, we can proceed without assuming a role.
    // Maybe the default credentials have permissions to do what we need.
    return undefined;
  }
}

/**
 * Generates an automatic list of overrides that can be deduced from the structure of the opposite resource graph.
 * Suppose we have the following resource graph:
 *
 *     A --> B
 *     C --> D
 *
 * such that B and D are identical, but A is different from C. Then digest(B) = digest(D). If both resources are moved,
 * we have an ambiguity. But if we reverse the arrows:
 *
 *     A <-- B
 *     C <-- D
 *
 * then digest(B) ≠ digest(D), because they now have different dependencies. If we compute the mappings from this
 * opposite graph, we can use them as a set of overrides to disambiguate the original moves.
 *
 */
function structuralOverrides(deployedStacks: CloudFormationStack[], localStacks: CloudFormationStack[]): ResourceMapping[] {
  const moves = resourceMoves(deployedStacks, localStacks, 'opposite', true);
  const [nonAmbiguousMoves] = partitionByAmbiguity([], moves);
  return resourceMappings(nonAmbiguousMoves);
}

function resourceMoves(
  before: CloudFormationStack[],
  after: CloudFormationStack[],
  direction: GraphDirection = 'direct',
  ignoreModifications: boolean = false): ResourceMove[] {
  const digestsBefore = resourceDigests(before, direction);
  const digestsAfter = resourceDigests(after, direction);

  if (!(ignoreModifications || isomorphic(digestsBefore, digestsAfter))) {
    const message = ['A refactor operation cannot add, remove or update resources. Only resource moves and renames are allowed.'];

    const difference = (a: Record<string, ResourceLocation[]>, b: Record<string, ResourceLocation[]>) => {
      return Array.from(setDiff(new Set(Object.keys(a)), new Set(Object.keys(b)))).flatMap(k => a[k]!)
        .map(x => `  - ${x.toPath()}`)
        .sort()
        .join('\n');
    };

    const stackNames = (stacks: CloudFormationStack[]) =>
      stacks.length === 0
        ? 'NONE'
        : stacks
          .map((s) => s.stackName)
          .sort()
          .join(', ');

    const onlyDeployed = difference(digestsBefore, digestsAfter);
    const onlyLocal = difference(digestsAfter, digestsBefore);

    if (onlyDeployed.length > 0) {
      message.push(`The following resources are present only in the AWS environment:\n${onlyDeployed}`);
    }

    if (onlyLocal.length > 0) {
      message.push(`\nThe following resources are present only in your CDK application:\n${onlyLocal}`);
    }

    message.push('');
    message.push('The following stacks were used in the comparison:');
    message.push( `  - Deployed: ${stackNames(before)}`);
    message.push( `  - Local: ${stackNames(after)}`);
    message.push('');
    message.push('Hint: by default, only deployed stacks that have the same name as a local stack are included.');
    message.push('If you want to include additional deployed stacks for comparison, re-run the command with the option \'--additional-stack-name=<STACK>\' for each stack.');

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
function resourceDigests(stacks: CloudFormationStack[], direction: GraphDirection): Record<string, ResourceLocation[]> {
  // index stacks by name
  const stacksByName = new Map<string, CloudFormationStack>();
  for (const stack of stacks) {
    stacksByName.set(stack.stackName, stack);
  }

  const digests = computeResourceDigests(stacks, direction);

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

/**
 * Replace the {ACCOUNT} and {REGION} placeholders in all strings found in a complex object.
 *
 * Duplicated between cdk-assets and aws-cdk CLI because we don't have a good single place to put it
 * (they're nominally independent tools).
 */
export async function replaceAwsPlaceholders<A extends { region?: string }>(
  object: A,
  aws: IAws,
): Promise<A> {
  let partition = async () => {
    const p = await aws.discoverPartition();
    partition = () => Promise.resolve(p);
    return p;
  };

  let account = async () => {
    const a = await aws.discoverCurrentAccount();
    account = () => Promise.resolve(a);
    return a;
  };

  return EnvironmentPlaceholders.replaceAsync(object, {
    async region() {
      return object.region ?? aws.discoverDefaultRegion();
    },
    async accountId() {
      return (await account()).accountId;
    },
    async partition() {
      return partition();
    },
  });
}

