import type * as cxapi from '@aws-cdk/cloud-assembly-api';

export interface StackDestroy {
  /**
   * The stacks that will be destroyed
   */
  readonly stacks: cxapi.CloudFormationStackArtifact[];
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
  readonly stack: cxapi.CloudFormationStackArtifact;
}
