import type * as cxapi from '@aws-cdk/cx-api';
import type { MappingGroup } from '..';
import type { SdkProvider } from '../../../api/aws-auth/sdk-provider';
import { groupStacks, RefactoringContext } from '../../../api/refactoring';
import { ToolkitError } from '../../../toolkit/toolkit-error';

export function parseMappingGroups(s: string) {
  const mappingGroups = doParse();

  // Validate that there are no duplicate destinations.
  // By construction, there are no duplicate sources, already.
  for (let group of mappingGroups) {
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

  return mappingGroups;

  function doParse(): MappingGroup[] {
    const content = JSON.parse(s);
    if (content.environments || !Array.isArray(content.environments)) {
      return content.environments;
    } else {
      throw new ToolkitError("Expected an 'environments' array");
    }
  }
}

interface EnvironmentSpecificMappings {
  readonly environment: cxapi.Environment;
  readonly mappings: Record<string, string>;
}

export async function mappingsByEnvironment(
  stackArtifacts: cxapi.CloudFormationStackArtifact[],
  sdkProvider: SdkProvider,
  ignoreModifications?: boolean,
): Promise<EnvironmentSpecificMappings[]> {
  const groups = await groupStacks(sdkProvider, stackArtifacts, []);
  return groups.map((group) => {
    const context = new RefactoringContext({
      ...group,
      ignoreModifications,
    });
    return {
      environment: context.environment,
      mappings: Object.fromEntries(
        context.mappings.map((m) => [m.source.toLocationString(), m.destination.toLocationString()]),
      ),
    };
  });
}

