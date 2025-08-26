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
   * Whether or not to wait for the stack to finish deleting
   * This functionality does not work for stacks which have dependent stacks
   */
  readonly noWait?: boolean;
}
