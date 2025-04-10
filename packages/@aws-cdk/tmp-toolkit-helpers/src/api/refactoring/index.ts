import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
import {
  formatAmbiguousMappings as fmtAmbiguousMappings,
  formatTypedMappings as fmtTypedMappings,
} from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSummary } from '@aws-sdk/client-cloudformation';
import { deserializeStructure } from '../../util';
import type { SdkProvider } from '../aws-auth';
import { Mode } from '../plugin';
import { StringWriteStream } from '../streams';
import type { CloudFormationStack } from './cloudformation';
import { computeResourceDigests, hashObject } from './digest';

export class AmbiguityError extends Error {
  constructor(public readonly pairs: [ResourceLocation[], ResourceLocation[]][]) {
    super('Ambiguous resource mappings');
  }

  public paths(): [string[], string[]][] {
    return this.pairs.map(([a, b]) => [convert(a), convert(b)]);

    function convert(locations: ResourceLocation[]): string[] {
      return locations.map((l) => l.toPath());
    }
  }
}

/**
 * This class mirrors the `ResourceLocation` interface from CloudFormation,
 * but is richer, since it has a reference to the stack object, rather than
 * merely the stack name.
 */
export class ResourceLocation {
  constructor(readonly stack: CloudFormationStack, readonly logicalResourceId: string) {
  }

  public toPath(): string {
    const stack = this.stack;
    const resource = stack.template.Resources?.[this.logicalResourceId];
    const result = resource?.Metadata?.['aws:cdk:path'];

    if (result != null) {
      return result;
    }

    // If the path is not available, we can use stack name and logical ID
    return `${stack.stackName}.${this.logicalResourceId}`;
  }

  public getType(): string {
    const resource = this.stack.template.Resources?.[this.logicalResourceId ?? ''];
    return resource?.Type ?? 'Unknown';
  }
}

/**
 * A mapping between a source and a destination location.
 */
export class ResourceMapping {
  constructor(public readonly source: ResourceLocation, public readonly destination: ResourceLocation) {
  }

  public toTypedMapping(): TypedMapping {
    return {
      // the type is the same in both source and destination,
      // so we can use either one
      type: this.source.getType(),
      sourcePath: this.source.toPath(),
      destinationPath: this.destination.toPath(),
    };
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

export function computeMappings(before: CloudFormationStack[], after: CloudFormationStack[]): ResourceMapping[] {
  const pairs = removeUnmovedResources(
    zip(groupByKey(before.flatMap(resourceDigests)), groupByKey(after.flatMap(resourceDigests))),
  );

  // A mapping is considered ambiguous if these two conditions are met:
  //  1. Both sides have at least one element (otherwise, it's just addition or deletion)
  //  2. At least one side has more than one element
  const ambiguousPairs = Object.values(pairs)
    .filter(([pre, post]) => pre.length > 0 && post.length > 0)
    .filter(([pre, post]) => pre.length > 1 || post.length > 1);

  if (ambiguousPairs.length > 0) {
    throw new AmbiguityError(ambiguousPairs);
  }

  return Object.values(pairs)
    .filter(([pre, post]) => pre.length === 1 && post.length === 1 && !equalLocations(pre[0], post[0]))
    .map(([pre, post]) => new ResourceMapping(pre[0], post[0]));
}

function removeUnmovedResources(
  m: Record<string, [ResourceLocation[], ResourceLocation[]]>,
): Record<string, [ResourceLocation[], ResourceLocation[]]> {
  const result: Record<string, [ResourceLocation[], ResourceLocation[]]> = {};
  for (const [hash, [before, after]] of Object.entries(m)) {
    const common = before.filter((b) => after.some((a) => equalLocations(a, b)));
    result[hash] = [
      before.filter((b) => !common.some((c) => equalLocations(b, c))),
      after.filter((a) => !common.some((c) => equalLocations(a, c))),
    ];
  }

  return result;
}

function equalLocations(a: ResourceLocation, b: ResourceLocation): boolean {
  return a.logicalResourceId === b.logicalResourceId && a.stack.stackName === b.stack.stackName;
}

/**
 * For each hash, identifying a single resource, zip the two lists of locations,
 * to produce a pair of arrays of locations, in the same order as the parameters.
 */
function zip(
  m1: Record<string, ResourceLocation[]>,
  m2: Record<string, ResourceLocation[]>,
): Record<string, [ResourceLocation[], ResourceLocation[]]> {
  const result: Record<string, [ResourceLocation[], ResourceLocation[]]> = {};

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
 * Detects refactor mappings by comparing the stacks in the given environment
 * with the stacks deployed to the same environment.
 *
 * @param stacks - The stacks to compare.
 * @param sdkProvider - The SDK provider to use for fetching deployed stacks.
 * @returns A promise that resolves to an array of resource mappings.
 */
export async function detectRefactorMappings(
  stacks: CloudFormationStack[],
  sdkProvider: SdkProvider,
): Promise<ResourceMapping[]> {
  const stackGroups: Map<string, [CloudFormationStack[], CloudFormationStack[]]> = new Map();

  // Group stacks by environment
  for (const stack of stacks) {
    const environment = stack.environment;
    const key = hashObject(environment);
    if (stackGroups.has(key)) {
      stackGroups.get(key)![1].push(stack);
    } else {
      // The first time we see an environment, we need to fetch all stacks deployed to it.
      const before = await getDeployedStacks(sdkProvider, environment);
      stackGroups.set(key, [before, [stack]]);
    }
  }

  const result: ResourceMapping[] = [];
  for (const [_, [before, after]] of stackGroups) {
    result.push(...computeMappings(before, after));
  }
  return result;
}

async function getDeployedStacks(sdkProvider: SdkProvider, environment: cxapi.Environment): Promise<CloudFormationStack[]> {
  const cfn = (await sdkProvider.forEnvironment(environment, Mode.ForReading)).sdk.cloudFormation();

  const summaries = await cfn.paginatedListStacks({
    StackStatusFilter: [
      'CREATE_COMPLETE',
      'UPDATE_COMPLETE',
      'UPDATE_ROLLBACK_COMPLETE',
      'IMPORT_COMPLETE',
      'ROLLBACK_COMPLETE',
    ],
  });

  const normalize = async (summary: StackSummary) => {
    const templateCommandOutput = await cfn.getTemplate({ StackName: summary.StackName! });
    const template = deserializeStructure(templateCommandOutput.TemplateBody ?? '{}');
    return {
      environment,
      stackName: summary.StackName!,
      template,
    };
  };

  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  return Promise.all(summaries.map(normalize));
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
