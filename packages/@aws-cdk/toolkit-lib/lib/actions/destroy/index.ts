import type { StackSelector } from '../../api/cloud-assembly';

export interface DestroyOptions {
  /**
   * Criteria for selecting stacks to deploy
   *
   * @defaultValue - all stacks
   */
  readonly stacks?: StackSelector;

  /**
   * The arn of the IAM role to use for the stack destroy operation
   */
  readonly roleArn?: string;
}
