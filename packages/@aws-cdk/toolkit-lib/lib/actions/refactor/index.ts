import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSelector } from '../../api';
import type { SdkProvider } from '../../api/aws-auth/sdk-provider';
import { groupStacks, RefactoringContext } from '../../api/refactoring';
import { ToolkitError } from '../../toolkit/toolkit-error';

export interface RefactorOptions {
  /**
   * Whether to only show the proposed refactor, without applying it
   *
   * @default false
   */
  readonly dryRun?: boolean;

  /**
   * List of overrides to be applied to resolve possible ambiguities in the
   * computed list of mappings.
   */
  overrides?: MappingGroup[];

  /**
   * Criteria for selecting stacks to compare with the deployed stacks in the
   * target environment.
   */
  stacks?: StackSelector;

  /**
   * A list of names of additional deployed stacks to be included in the comparison.
   */
  additionalStackNames?: string[];
}

export interface MappingGroup {
  /**
   * The account ID of the environment in which the mapping is valid.
   */
  account: string;

  /**
   * The region of the environment in which the mapping is valid.
   */
  region: string;

  /**
   * A collection of resource mappings, where each key is the source location
   * and the value is the destination location. Locations must be in the format
   * `StackName.LogicalId`. The source must refer to a location where there is
   * a resource currently deployed, while the destination must refer to a
   * location that is not already occupied by any resource.
   *
   */
  resources: {
    [key: string]: string;
  };
}

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

export interface EnvironmentSpecificMappings {
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
