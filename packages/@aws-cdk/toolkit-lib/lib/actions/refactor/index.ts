import type { StackSelector } from '../../api/cloud-assembly';

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
   * A list of resources that will not be part of the refactor.
   * Elements of this list must be the _destination_ locations
   * that should be excluded, i.e., the location to which a
   * resource would be moved if the refactor were to happen.
   *
   * The format of the locations in the file can be either:
   *
   * - Stack name and logical ID (e.g. `Stack1.MyQueue`)
   * - A construct path (e.g. `Stack1/Foo/Bar/Resource`).
   */
  exclude?: string[];

  /**
   * Whether to go ahead with the refactor, without asking for
   * confirmation.
   *
   * @default false
   */
  force?: boolean;

  /**
   * An explicit mapping to be used by the toolkit (as opposed to letting the
   * toolkit itself compute the mapping).
   */
  mappings?: MappingGroup[];

  /**
   * Modifies the behavior of the 'mappings' option by swapping source and
   * destination locations. This is useful when you want to undo a refactor
   * that was previously applied.
   */
  revert?: boolean;
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
