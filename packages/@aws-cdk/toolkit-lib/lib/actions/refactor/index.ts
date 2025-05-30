import type { ExcludeList } from '../../api';
import { InMemoryExcludeList, NeverExclude } from '../../api';
import type { StackSelector } from '../../api/cloud-assembly';
import type { ResourceLocation } from '../../api/refactoring/cloudformation';

export type MappingType = 'auto' | 'explicit';

export class MappingSource {
  public static auto(exclude: string[] = []): MappingSource {
    const excludeList = new InMemoryExcludeList(exclude);
    return new MappingSource('auto', [], excludeList);
  }

  public static explicit(groups: MappingGroup[]): MappingSource {
    return new MappingSource('explicit', groups, new NeverExclude());
  }

  public static reverse(groups: MappingGroup[]): MappingSource {
    const reverseGroups = groups.map((group) => ({
      ...group,
      resources: Object.fromEntries(Object.entries(group.resources).map(([src, dst]) => [dst, src])),
    }));

    return new MappingSource('explicit', reverseGroups, new NeverExclude());
  }

  public readonly source: MappingType;
  public readonly groups: MappingGroup[];
  public readonly exclude: ExcludeList;

  constructor(source: MappingType, groups: MappingGroup[], exclude: ExcludeList) {
    this.source = source;
    this.groups = groups;
    this.exclude = exclude;
  }

  public isAllowed(location: ResourceLocation): boolean {
    return !this.exclude.isExcluded(location);
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
   * @default - all stacks
   */
  stacks?: StackSelector;

  /**
   * How the toolkit should obtain the mappings
   */
  mappingSource?: MappingSource;
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
