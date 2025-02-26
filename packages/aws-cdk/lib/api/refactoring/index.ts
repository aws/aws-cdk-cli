import * as crypto from 'crypto';
import { createHash } from 'node:crypto';
import { BootstrapRole } from '@aws-cdk/cloud-assembly-schema';
import type * as cxapi from '@aws-cdk/cx-api';
import { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import {
  ListStacksCommandOutput,
  ResourceLocation,
  ResourceMapping,
  StackSummary,
} from '@aws-sdk/client-cloudformation';
import { deserialize } from '../../util';
import { SdkProvider } from '../aws-auth';
import { Mode } from '../plugin';

interface CloudFormationTemplate {
  Resources?: {
    [logicalId: string]: {
      Type: string;
      Properties?: any;
    };
  };
}

export interface CloudFormationStack {
  readonly environment: cxapi.Environment;
  readonly stackName: string;
  readonly template: CloudFormationTemplate;
}

export class AmbiguityError extends Error {
  constructor(public readonly pairs: [ResourceLocation[], ResourceLocation[]][]) {
    super(`Ambiguous pairs: ${JSON.stringify(pairs)}`);
  }
}

export interface TypedMapping extends ResourceMapping {
  // Type of the mapped resource
  readonly type: string;
}

export function typedMappings(before: CloudFormationStack[], after: CloudFormationStack[]): TypedMapping[] {
  return computeMappings(
    removeCommonResources(zip(buildRecord(before.flatMap(index)), buildRecord(after.flatMap(index)))),
  ).map((m) => {
    const location = m.Source; // could be m.Destination as well
    const stack = before.find((s) => s.stackName === location?.StackName);
    const resource = stack?.template.Resources?.[location?.LogicalResourceId ?? ''].Type;
    return {
      ...m,
      type: resource ?? 'Unknown',
    };
  });
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

function computeMappings(x: Record<string, [ResourceLocation[], ResourceLocation[]]>): ResourceMapping[] {
  const ambiguousPairs = Object.values(x)
    .filter(([before, after]) => before.length > 0 && after.length > 0)
    .filter(([before, after]) => before.length > 1 || after.length > 1);
  if (ambiguousPairs.length > 0) {
    throw new AmbiguityError(ambiguousPairs);
  }

  return Object.values(x)
    .filter(
      ([before, after]) =>
        before.length === 1 &&
        after.length === 1 &&
        (before[0].LogicalResourceId !== after[0].LogicalResourceId || before[0].StackName !== after[0].StackName),
    )
    .map(([before, after]) => ({
      Source: before[0],
      Destination: after[0],
    }));
}

function removeCommonResources(
  m: Record<string, [ResourceLocation[], ResourceLocation[]]>,
): Record<string, [ResourceLocation[], ResourceLocation[]]> {
  const result: Record<string, [ResourceLocation[], ResourceLocation[]]> = {};
  for (const [hash, [before, after]] of Object.entries(m)) {
    const common = before.filter((b) => after.some((a) => eq(a, b)));
    result[hash] = [
      before.filter((b) => !common.some((c) => eq(b, c))),
      after.filter((a) => !common.some((c) => eq(a, c))),
    ];
  }

  function eq(a: ResourceLocation, b: ResourceLocation): boolean {
    return a.LogicalResourceId === b.LogicalResourceId && a.StackName === b.StackName;
  }

  return result;
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

function index(stack: CloudFormationStack): [string, ResourceLocation][] {
  const digests = computeResourceDigests(stack.template);

  return Object.entries(digests).map(([logicalId, digest]) => {
    const location: ResourceLocation = {
      StackName: stack.stackName,
      LogicalResourceId: logicalId,
    };
    return [digest, location];
  });
}

export async function detectLocationChanges(stacks: CloudFormationStackArtifact[], sdkProvider: SdkProvider): Promise<TypedMapping[]> {
  const stackGroups: Map<string, [CloudFormationStack[], CloudFormationStack[]]> = new Map();

  // Group stacks by environment
  for (const stack of stacks) {
    const environment = stack.environment;
    const key = hashObject(environment);
    if (stackGroups.has(key)) {
      stackGroups.get(key)![1].push(stack);
    } else {
      // The first time we see an environment, we need to fetch all stacks deployed to it.
      // TODO This lookup role is not being resolved correctly.
      const before = await getDeployedStacks(sdkProvider, environment, stack.lookupRole);
      stackGroups.set(key, [before, [stack]]);
    }
  }

  const result: TypedMapping[] = [];
  for (const [_, [before, after]] of stackGroups) {
    result.push(...typedMappings(before, after));
  }
  return result;
}

async function getDeployedStacks(
  sdkProvider: SdkProvider,
  environment: cxapi.Environment,
  lookupRole?: BootstrapRole,
): Promise<CloudFormationStack[]> {
  const cfn = (
    await sdkProvider.forEnvironment(environment, Mode.ForReading, {
      assumeRoleArn: lookupRole?.arn,
    })
  ).sdk.cloudFormation();

  // TODO Paginate
  const listCommandOutput: ListStacksCommandOutput = await cfn.listStacks({
    // TODO check if this is the right set of statuses
    StackStatusFilter: ['CREATE_COMPLETE', 'UPDATE_COMPLETE'],
  });

  const normalize = async (summary: StackSummary) => {
    const templateCommandOutput = await cfn.getTemplate({ StackName: summary.StackName! });
    const template = deserialize(templateCommandOutput.TemplateBody ?? '{}');
    return {
      environment,
      stackName: summary.StackName!,
      template,
    };
  };

  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  return Promise.all((listCommandOutput.StackSummaries ?? []).map(normalize));
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
        Object.keys(value).sort().forEach(key => {
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
