import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
import {
  formatAmbiguousMappings as fmtAmbiguousMappings,
  formatEnvironmentSectionHeader as fmtEnvironmentSectionHeader,
  formatTypedMappings as fmtTypedMappings,
} from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSummary } from '@aws-sdk/client-cloudformation';
import { deserializeStructure, indexBy } from '../../util';
import type { SdkProvider } from '../aws-auth/private';
import { Mode } from '../plugin';
import { StringWriteStream } from '../streams';
import type { CloudFormationStack } from './cloudformation';
import { ResourceLocation, ResourceMapping } from './cloudformation';
import { hashObject } from './digest';
import type { MappingGroup } from '../../actions';
import { ToolkitError } from '../../toolkit/toolkit-error';

export * from './exclude';
export * from './context';

interface StackGroup {
  environment: cxapi.Environment;
  localStacks: CloudFormationStack[];
  deployedStacks: CloudFormationStack[];
}

export async function usePrescribedMappings(
  mappingGroups: MappingGroup[],
  sdkProvider: SdkProvider,
): Promise<ResourceMapping[]> {
  interface MappingGroupWithStacks extends MappingGroup {
    stacks: CloudFormationStack[];
  }

  const stackGroups: MappingGroupWithStacks[] = [];
  for (const group of mappingGroups) {
    stackGroups.push({
      ...group,
      stacks: await getDeployedStacks(sdkProvider, environmentOf(group)),
    });
  }

  // Validate that there are no duplicate destinations
  for (let group of stackGroups) {
    const destinations = new Set<string>();

    for (const destination of Object.values(group.resources)) {
      if (destinations.has(destination)) {
        throw new ToolkitError(
          `Duplicate destination resource '${destination}' in environment ${group.account}/${group.region}`,
        );
      }
      destinations.add(destination);
    }
  }

  const result: ResourceMapping[] = [];
  for (const group of stackGroups) {
    for (const [source, destination] of Object.entries(group.resources)) {
      if (!inUse(source, group.stacks)) {
        throw new ToolkitError(`Source resource '${source}' does not exist in environment ${group.account}/${group.region}`);
      }

      if (inUse(destination, group.stacks)) {
        throw new ToolkitError(
          `Destination resource '${destination}' already in use in environment ${group.account}/${group.region}`,
        );
      }

      const environment = environmentOf(group);
      const src = makeLocation(source, environment, group.stacks);
      const dst = makeLocation(destination, environment);
      result.push(new ResourceMapping(src, dst));
    }
  }
  return result;

  function inUse(location: string, stacks: CloudFormationStack[]): boolean {
    const [stackName, logicalId] = location.split('.');
    if (stackName == null || logicalId == null) {
      throw new ToolkitError(`Invalid location '${location}'`);
    }
    const stack = stacks.find((s) => s.stackName === stackName);
    return stack != null && stack.template.Resources?.[logicalId] != null;
  }

  function environmentOf(group: MappingGroup) {
    return {
      account: group.account,
      region: group.region,
      name: '',
    };
  }

  function makeLocation(
    loc: string,
    environment: cxapi.Environment,
    stacks: CloudFormationStack[] = [],
  ): ResourceLocation {
    const [stackName, logicalId] = loc.split('.');
    const stack = stacks.find((s) => s.stackName === stackName);

    return new ResourceLocation(
      {
        stackName,
        environment,
        template: stack?.template ?? {},
      },
      logicalId,
    );
  }
}

export async function getDeployedStacks(
  sdkProvider: SdkProvider,
  environment: cxapi.Environment,
): Promise<CloudFormationStack[]> {
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

export function formatEnvironmentSectionHeader(environment: cxapi.Environment) {
  const env = `aws://${environment.account}/${environment.region}`;
  return formatToStream(stream => fmtEnvironmentSectionHeader(stream, env));
}

export function formatTypedMappings(mappings: TypedMapping[]): string {
  return formatToStream((stream) => fmtTypedMappings(stream, mappings));
}

export function formatAmbiguousMappings(paths: [string[], string[]][]): string {
  return formatToStream((stream) => fmtAmbiguousMappings(stream, paths));
}

function formatToStream(cb: (stream: NodeJS.WritableStream) => void): string {
  const stream = new StringWriteStream();
  cb(stream);
  return stream.toString();
}

/**
 * Returns a list of stack groups, each containing the local stacks and the deployed stacks that match the given patterns.
 */
export async function groupStacks(sdkProvider: SdkProvider, localStacks: CloudFormationStack[], additionalStackNames: string[]) {
  const environments: Map<string, cxapi.Environment> = new Map();

  for (const stack of localStacks) {
    const environment = await sdkProvider.resolveEnvironment(stack.environment);
    const key = hashObject(environment);
    environments.set(key, environment);
  }

  const localByEnvironment = await indexBy(localStacks,
    async (s) => hashObject(await sdkProvider.resolveEnvironment(s.environment)),
  );

  const groups: StackGroup[] = [];
  for (let key of localByEnvironment.keys()) {
    const environment = environments.get(key)!;
    const allDeployedStacks = await getDeployedStacks(sdkProvider, environment);
    const local = localByEnvironment.get(key)!;
    const hasLocalCounterpart = (s: CloudFormationStack) => local.some((l) => l.stackName === s.stackName);
    const wasExplicitlyProvided = (s: CloudFormationStack) => additionalStackNames.includes(s.stackName);

    groups.push({
      environment,
      deployedStacks: allDeployedStacks.filter(s => hasLocalCounterpart(s) || wasExplicitlyProvided(s)),
      localStacks: local,
    });
  }

  return groups;
}
