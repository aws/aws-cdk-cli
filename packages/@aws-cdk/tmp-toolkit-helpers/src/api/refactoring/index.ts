import * as crypto from 'crypto';
import { createHash } from 'node:crypto';
import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
import {
  formatTypedMappings as fmtTypedMappings,
  formatAmbiguousMappings as fmtAmbiguousMappings,
} from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSummary } from '@aws-sdk/client-cloudformation';
import { deserializeStructure } from '../../util';
import type { SdkProvider } from '../aws-auth';
import { Mode } from '../plugin';
import { StringWriteStream } from '../streams';

interface CloudFormationTemplate {
  Resources?: {
    [logicalId: string]: {
      Type: string;
      Properties?: any;
      Metadata?: Record<string, any>;
    };
  };
}

export interface BasicStack {
  readonly environment: cxapi.Environment;
  readonly stackName: string;
  readonly template: CloudFormationTemplate;
}

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
  constructor(readonly stack: BasicStack, readonly logicalResourceId?: string) {
  }

  public toPath(): string {
    const stack = this.stack;
    const resource = stack.template.Resources?.[this.logicalResourceId ?? ''];
    const result = resource?.Metadata?.['aws:cdk:path'];

    if (result != null) {
      return result;
    }

    // If the path is not available, we can use stack name and logical ID
    return `${stack.stackName}.${this.logicalResourceId}`;
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
      type: this.getType(this.source),
      sourcePath: this.source.toPath(),
      destinationPath: this.destination.toPath(),
    };
  }

  private getType(location: ResourceLocation): string {
    const resource = location.stack.template.Resources?.[location.logicalResourceId ?? ''];
    return resource?.Type ?? 'Unknown';
  }
}

function buildRecord(entries: [string, ResourceLocation][]): Record<string, ResourceLocation[]> {
  const result: Record<string, ResourceLocation[]> = {};

  for (const [hash, location] of entries) {
    if (hash in result) {
      result[hash].push(location);
    } else {
      result[hash] = [location];
    }
  }

  return result;
}

export function computeMappings(before: BasicStack[], after: BasicStack[]): ResourceMapping[] {
  const pairs = removeCommonResources(zip(buildRecord(before.flatMap(index)), buildRecord(after.flatMap(index))));

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

function removeCommonResources(
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
function index(stack: BasicStack): [string, ResourceLocation][] {
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
  stacks: BasicStack[],
  sdkProvider: SdkProvider,
): Promise<ResourceMapping[]> {
  const stackGroups: Map<string, [BasicStack[], BasicStack[]]> = new Map();

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

async function getDeployedStacks(sdkProvider: SdkProvider, environment: cxapi.Environment): Promise<BasicStack[]> {
  const cfn = (await sdkProvider.forEnvironment(environment, Mode.ForReading)).sdk.cloudFormation();
  const summaries: StackSummary[] = [];
  await paginateSdkCall(async (nextToken) => {
    const output = await cfn.listStacks({
      StackStatusFilter: [
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
        'IMPORT_COMPLETE',
        'ROLLBACK_COMPLETE',
      ],
      NextToken: nextToken,
    });

    summaries.push(...(output.StackSummaries ?? []));
    return output.NextToken;
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

/**
 * Computes the digest for each resource in the template.
 */
export function computeResourceDigests(template: CloudFormationTemplate): Record<string, string> {
  const resources = template.Resources || {};
  const graph: Record<string, Set<string>> = {};
  const reverseGraph: Record<string, Set<string>> = {};

  // 1. Build adjacency lists
  for (const id of Object.keys(resources)) {
    graph[id] = new Set();
    reverseGraph[id] = new Set();
  }

  // 2. Detect dependencies by searching for Ref/Fn::GetAtt
  const findDependencies = (value: any): string[] => {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
      return value.flatMap(findDependencies);
    }
    if ('Ref' in value) {
      return [value.Ref];
    }
    if ('Fn::GetAtt' in value) {
      const refTarget = Array.isArray(value['Fn::GetAtt']) ? value['Fn::GetAtt'][0] : value['Fn::GetAtt'].split('.')[0];
      return [refTarget];
    }
    return Object.values(value).flatMap(findDependencies);
  };

  for (const [id, res] of Object.entries(resources)) {
    const deps = findDependencies(res.Properties || {});
    for (const dep of deps) {
      if (dep in resources && dep !== id) {
        graph[id].add(dep);
        reverseGraph[dep].add(id);
      }
    }
  }

  // 3. Topological sort
  const inDegree = Object.keys(graph).reduce((acc, k) => {
    acc[k] = graph[k].size;
    return acc;
  }, {} as Record<string, number>);

  const queue = Object.keys(inDegree).filter((k) => inDegree[k] === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const nxt of reverseGraph[node]) {
      inDegree[nxt]--;
      if (inDegree[nxt] === 0) {
        queue.push(nxt);
      }
    }
  }

  // 4. Compute digests in sorted order
  const result: Record<string, string> = {};
  for (const id of order) {
    const resource = resources[id];
    const depDigests = Array.from(graph[id]).map((d) => result[d]);
    const propsWithoutRefs = JSON.stringify(stripReferences(stripConstructPath(resource.Properties)));
    const toHash = resource.Type + propsWithoutRefs + depDigests.join('');
    result[id] = crypto.createHash('sha256').update(toHash).digest('hex');
  }

  return result;
}

function hashObject(obj: any): string {
  const hash = createHash('sha256');

  function addToHash(value: any) {
    if (typeof value === 'object') {
      if (value == null) {
        addToHash('null');
      } else if (Array.isArray(value)) {
        value.forEach(addToHash);
      } else {
        Object.keys(value)
          .sort()
          .forEach((key) => {
            hash.update(key);
            addToHash(value[key]);
          });
      }
    } else {
      hash.update(typeof value + value.toString());
    }
  }

  addToHash(obj);
  return hash.digest('hex');
}

/**
 * Removes sub-properties containing Ref or Fn::GetAtt to avoid hashing
 * references themselves but keeps the property structure.
 */
function stripReferences(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(stripReferences);
  }
  if ('Ref' in value) {
    return { __cloud_ref__: 'Ref' };
  }
  if ('Fn::GetAtt' in value) {
    return { __cloud_ref__: 'Fn::GetAtt' };
  }
  const result: any = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = stripReferences(v);
  }
  return result;
}

function stripConstructPath(resource: any): any {
  if (resource?.Metadata?.['aws:cdk:path'] == null) {
    return resource;
  }

  const copy = JSON.parse(JSON.stringify(resource));
  delete copy.Metadata['aws:cdk:path'];
  return copy;
}

async function paginateSdkCall(cb: (nextToken?: string) => Promise<string | undefined>) {
  let finished = false;
  let nextToken: string | undefined;
  while (!finished) {
    nextToken = await cb(nextToken);
    if (nextToken === undefined) {
      finished = true;
    }
  }
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
