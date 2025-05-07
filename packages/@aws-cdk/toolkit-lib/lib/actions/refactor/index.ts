import type * as cxapi from '@aws-cdk/cx-api';
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
   * An explicit mapping to be used by the toolkit (as opposed to
   * letting the toolkit itself compute the mapping). The `source`
   * and `destination` properties are resource locations in the
   * format `StackName.LogicalId`. The source must refer to a
   * location where there is a resource currently deployed, while
   * the destination must refer to a location that is not already
   * occupied by any resource.
   */
  mappings?: UserProvidedResourceMapping[];

  /**
   * Modifies the behavior of the 'mappings' option by swapping source and
   * destination locations. This is useful when you want to undo a refactor
   * that was previously applied.
   */
  revert?: boolean;
}

/**
 * Explicit mapping of a resource from one location to another, within a
 * given environment.
 */
export interface UserProvidedResourceMapping {
  /**
   * The source resource location, in the format `StackName.LogicalId`.
   */
  source: string;

  /**
   * The destination resource location, in the format `StackName.LogicalId`.
   */
  destination: string;

  /**
   * The environment in which the mapping is valid.
   */
  environment: cxapi.Environment;
}
