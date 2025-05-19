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
}
