import type { StackSelector } from '../../api/cloud-assembly';

export interface DestroyOptions {
  /**
   * Criteria for selecting stacks to deploy
   *
   * @default - All stacks
   */
  readonly stacks?: StackSelector;

  /**
   * The arn of the IAM role to use for the stack destroy operation
   */
  readonly roleArn?: string;

  /**
   * Skip waiting for the stack to finish deleting
   */
  readonly skipAwaitDeletion?: boolean;
}
