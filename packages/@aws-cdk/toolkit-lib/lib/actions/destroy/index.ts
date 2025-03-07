import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';
import type { StackSelector } from '../../api/cloud-assembly';

export interface DestroyOptions {
  /**
   * Criteria for selecting stacks to deploy
   */
  readonly stacks: StackSelector;

  /**
   * The arn of the IAM role to use
   */
  readonly roleArn?: string;

  /**
   * Change stack watcher output to CI mode.
   *
   * @deprecated has no effect, please implement in IoHost instead
   */
  readonly ci?: boolean;
}

export interface StackDestroyProgress {
  /**
   * The total number of stacks being destroyed
   */
  readonly total: number;
  /**
   * The count of the stack currently attempted to be destroyed
   *
   * This is counting value, not an identifier.
   */
  readonly current: number;
  /**
   * The stack that's currently being destroyed
   */
  readonly stack: CloudFormationStackArtifact;
}
