import type { StackSelector } from '../../api';

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
  readonly overrides?: MappingGroup[];

  /**
   * Criteria for selecting stacks to compare with the deployed stacks in the
   * target environment.
   */
  readonly stacks?: StackSelector;

  /**
   * A list of names of additional deployed stacks to be included in the comparison.
   */
  readonly additionalStackNames?: string[];
}

export interface MappingGroup {
  /**
   * The account ID of the environment in which the mapping is valid.
   */
  readonly account: string;

  /**
   * The region of the environment in which the mapping is valid.
   */
  readonly region: string;

  /**
   * A collection of resource mappings, where each key is the source location
   * and the value is the destination location. Locations must be in the format
   * `StackName.LogicalId`. The source must refer to a location where there is
   * a resource currently deployed, while the destination must refer to a
   * location that is not already occupied by any resource.
   *
   */
  readonly resources: {
    readonly [key: string]: string;
  };
}
