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
}
