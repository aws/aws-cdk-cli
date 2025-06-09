import type { TypedMapping } from '@aws-cdk/cloudformation-diff';
import {
  formatAmbiguousMappings as fmtAmbiguousMappings,
  formatMappingsHeader as fmtMappingsHeader,
  formatTypedMappings as fmtTypedMappings,
  formatAmbiguitySectionHeader as fmtAmbiguitySectionHeader,
} from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSummary } from '@aws-sdk/client-cloudformation';
import { deserializeStructure } from '../../util';
import type { SdkProvider } from '../aws-auth/private';
import { Mode } from '../plugin';
import { StringWriteStream } from '../streams';
import type { CloudFormationStack } from './cloudformation';
import { ResourceLocation, ResourceMapping } from './cloudformation';
import type { MappingGroup } from '../../actions';
import { ToolkitError } from '../../toolkit/toolkit-error';

export * from './exclude';

export async function usePrescribedMappings(
  mappingGroups: MappingGroup[],
  sdkProvider: SdkProvider,
): Promise<ResourceMapping[]> {
  interface StackGroup extends MappingGroup {
    stacks: CloudFormationStack[];
  }

  const stackGroups: StackGroup[] = [];
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

export function formatMappingsHeader(): string {
  return formatToStream(fmtMappingsHeader);
}

export function formatTypedMappings(environment: cxapi.Environment, mappings: TypedMapping[]): string {
  return formatToStream((stream) => {
    const env = `aws://${environment.account}/${environment.region}`;
    fmtTypedMappings(stream, mappings, env);
  });
}

export function formatAmbiguitySectionHeader(): string {
  return formatToStream(fmtAmbiguitySectionHeader);
}

export function formatAmbiguousMappings(environment: cxapi.Environment, paths: [string[], string[]][]): string {
  return formatToStream((stream) => {
    const env = `aws://${environment.account}/${environment.region}`;
    fmtAmbiguousMappings(stream, paths, env);
  });
}

function formatToStream(cb: (stream: NodeJS.WritableStream) => void): string {
  const stream = new StringWriteStream();
  cb(stream);
  return stream.toString();
}
