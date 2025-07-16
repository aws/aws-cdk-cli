import type { MappingGroup } from '..';
import type { MappingType } from './mapping-helpers';
import type { ExcludeList } from '../../../api/refactoring';
import { InMemoryExcludeList, NeverExclude } from '../../../api/refactoring';

/**
 * The source of the resource mappings to be used for refactoring.
 *
 * @TODO unused
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
