import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';

export interface StackDestroy {
  /**
   * Uniquely identifies this marker amongst concurrent messages
   *
   * This is an otherwise meaningless identifier.
   */
  readonly marker: string;
  /**
   * The stacks that will be destroyed
   */
  readonly stacks: CloudFormationStackArtifact[];
}

export interface StackDestroyProgress {
  /**
   * Uniquely identifies this marker amongst concurrent messages
   *
   * This is an otherwise meaningless identifier.
   */
  readonly marker: string;
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
