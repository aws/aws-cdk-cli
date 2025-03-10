import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';

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
