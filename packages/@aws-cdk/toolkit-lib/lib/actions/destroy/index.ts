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
   * Maximum number of simultaneous destroys (dependency permitting) to execute.
   *
   * @default 1
   */
  readonly concurrency?: number;
}
