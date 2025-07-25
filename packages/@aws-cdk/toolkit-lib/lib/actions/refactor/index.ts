import type * as cxapi from '@aws-cdk/cx-api';
import type { StackSelector } from '../../api';
import type { SdkProvider } from '../../api/aws-auth/sdk-provider';
import type { ExcludeList } from '../../api/refactoring';
import { groupStacks, InMemoryExcludeList, NeverExclude, RefactoringContext } from '../../api/refactoring';
import { ToolkitError } from '../../toolkit/toolkit-error';

type MappingType = 'auto' | 'explicit';

/**
 * The source of the resource mappings to be used for refactoring.
 */
export class MappingSource {
  /**
   * The mapping will be automatically generated based on a comparison of
   * the deployed stacks and the local stacks.
   *
   * @param exclude - A list of resource locations to exclude from the mapping.
   */
  public static auto(exclude: string[] = []): MappingSource {
    const excludeList = new InMemoryExcludeList(exclude);
    return new MappingSource('auto', [], excludeList);
  }

  /**
   * An explicitly provided list of mappings, which will be used for refactoring.
   */
  public static explicit(groups: MappingGroup[]): MappingSource {
    return new MappingSource('explicit', groups, new NeverExclude());
  }

  /**
   * An explicitly provided list of mappings, which will be used for refactoring,
   * but in reverse, that is, the source locations will become the destination
   * locations and vice versa.
   */
  public static reverse(groups: MappingGroup[]): MappingSource {
    const reverseGroups = groups.map((group) => ({
      ...group,
      resources: Object.fromEntries(Object.entries(group.resources).map(([src, dst]) => [dst, src])),
    }));

    return MappingSource.explicit(reverseGroups);
  }

  /**
   * @internal
   */
  public readonly source: MappingType;

  /**
   * @internal
   */
  public readonly groups: MappingGroup[];

  /**
   * @internal
   */
  public readonly exclude: ExcludeList;

  private constructor(source: MappingType, groups: MappingGroup[], exclude: ExcludeList) {
    this.source = source;
    this.groups = groups;
    this.exclude = exclude;
  }
}

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

  /**
   * List of patterns for filtering local stacks. If no patterns are passed,
   * then all stacks, except the bootstrap stacks are considered. If you want
   * to consider all stacks (including bootstrap stacks), pass the wildcard
   * '*'.
   */
  localStacks?: string[];

  /**
   * List of patterns for filtering deployed stacks. If no patterns are passed,
   * then all stacks, except the bootstrap stacks are considered. If you want
   * to consider all stacks (including bootstrap stacks), pass the wildcard
   * '*'.
   */
  deployedStacks?: string[];

  /**
   * Whether to do the refactor without prompting the user for confirmation.
   */
  force?: boolean;

  /**
   * Role to assume in the target environment before performing the refactor.
   */
  roleArn?: string;
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
