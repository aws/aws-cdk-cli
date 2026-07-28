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

  /**
   * Whether to use express mode to destroy the stack(s)
   *
   * @default false
   */
  readonly express?: boolean;

  /**
   * Time in milliseconds to wait between polling CloudFormation for stack events while monitoring stack operations and waiting for stack stabilization.
   *
   * Increase this value to reduce the number of `DescribeStackEvents`/`DescribeStacks` calls,
   * e.g. when many concurrent stack operations are hitting CloudFormation API rate limits.
   *
   * @default 2000
   */
  readonly stackEventPollingInterval?: number;
}
