import type { StackSelector } from '../../api/cloud-assembly';
import type { ExcludeList } from '../../api/refactoring';
import { InMemoryExcludeList, NeverExclude } from '../../api/refactoring';

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
   * Criteria for selecting stacks to deploy
   *
   * @default - All stacks
   */
  stacks?: StackSelector;

  /**
   * How the toolkit should obtain the mappings
   */
  mappingSource?: MappingSource;

  /**
   * Whether to do the refactor without prompting the user for confirmation.
   */
  force?: boolean;
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
