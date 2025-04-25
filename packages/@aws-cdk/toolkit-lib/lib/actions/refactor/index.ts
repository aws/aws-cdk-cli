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
   * The absolute path to a file that contains a list of
   * resources to skip during the refactor. The file should
   * be in JSON format and contain an array of _destination_
   * logical IDs, that is, the logical IDs of the resources
   * as they would be after the refactor.
   */
  skipFile?: string;
}
