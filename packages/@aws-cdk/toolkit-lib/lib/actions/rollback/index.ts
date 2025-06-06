import type { StackSelector } from '../../api/cloud-assembly';

export interface RollbackOptions {
  /**
   * Criteria for selecting stacks to rollback
   *
   * @defaultValue - all stacks
   */
  readonly stacks?: StackSelector;

  /**
   * Role to pass to CloudFormation for deployment
   *
   * @defaultValue - Default stack role
   */
  readonly roleArn?: string;

  /**
   * Whether to automatically orphan resources that failed the rollback or not
   *
   * @defaultValue false
   */
  readonly orphanFailedResources?: boolean;

  /**
   * Logical IDs of resources to orphan
   *
   * These resources will be skipped from the roll back.
   * Specify this property to orphan resources that can't be successfully rolled back.
   * We recommend that you troubleshoot resources before skipping them.
   * After the rollback is complete, the state of the skipped resources will be inconsistent with
   * the state of the resources in the stack. Before performing another stack update,
   * you must update the stack or resources to be consistent with each other. If you don't
   * subsequent stack updates might fail, and the stack will become unrecoverable.
   *
   * @defaultValue - No resources are orphaned
   */
  readonly orphanLogicalIds?: string[];

  /**
   * Whether to validate the version of the bootstrap stack permissions
   *
   * @defaultValue true
   */
  readonly validateBootstrapStackVersion?: boolean;
}
