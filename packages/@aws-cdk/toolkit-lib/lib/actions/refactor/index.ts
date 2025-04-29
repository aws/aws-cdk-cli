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
   * The absolute path to a file that contains a list of resources to
   * skip during the refactor. The file should be in JSON format and
   * contain an array of _destination_ locations that should be skipped,
   * i.e., the location to which a resource would be moved if the
   * refactor were to happen.
   *
   * The format of the locations in the file can be either:
   *
   * - Stack name and logical ID (e.g. `Stack1.MyQueue`)
   * - A construct path (e.g. `Stack1/Foo/Bar/Resource`).
   */
  skipFile?: string;
}
