import type { ITemplateDiff, Move, ResourceImpact } from '@aws-cdk/cloudformation-diff';
import type { Duration, SingleStack } from './types';

/**
 * Different types of permission related changes in a diff
 */
export enum PermissionChangeType {
  /**
   * No permission changes
   */
  NONE = 'none',

  /**
   * Permissions are broadening
   */
  BROADENING = 'broadening',

  /**
   * Permissions are changed but not broadening
   */
  NON_BROADENING = 'non-broadening',
}

/**
 * A resource change that replaces, deletes or orphans an existing physical resource
 */
export interface DestructiveChange {
  /**
   * The name of the stack (or nested stack) that contains the resource
   */
  readonly stackName: string;

  /**
   * The logical ID of the resource
   */
  readonly logicalId: string;

  /**
   * The CloudFormation resource type, if known
   */
  readonly resourceType?: string;

  /**
   * The construct path of the resource
   *
   * @default - no construct path is known for the resource
   */
  readonly constructPath?: string;

  /**
   * The impact of the change on the existing physical resource
   */
  readonly impact: ResourceImpact;

  /**
   * Where the resource was moved to, if the change was detected as a move between stacks
   *
   * A deployment still destroys or orphans the resource unless it is moved with `cdk refactor` first.
   *
   * @default - the resource was not moved
   */
  readonly move?: Move;
}

/**
 * The diff formatted as different types of output
 */
export interface FormattedDiff {
  /**
   * The stack diff formatted as a string
   */
  readonly diff: string;
  /**
   * The security diff formatted as a string, if any
   */
  readonly security?: string;
}

/**
 * Diff information for a single stack
 */
export interface StackDiff extends SingleStack {
  /**
   * Total number of stacks that have changes
   * Can be higher than `1` if the stack has nested stacks.
   */
  readonly numStacksWithChanges: number;

  /**
   * Total number of stacks that have security-related changes.
   * Can be higher than `1` if the stack has nested stacks.
   */
  readonly numStacksWithSecurityChanges: number;

  /**
   * Structural diff of the stack
   * Can include more than a single diff if the stack has nested stacks.
   */
  readonly diffs: { [name: string]: ITemplateDiff };

  /**
   * The formatted diff
   */
  readonly formattedDiff: FormattedDiff;

  /**
   * Does the diff contain changes to permissions and what kind
   */
  readonly permissionChanges: PermissionChangeType;

  /**
   * The changes that replace, delete or orphan an existing resource, including in nested stacks
   */
  readonly destructiveChanges: DestructiveChange[];
}

/**
 * Output of the diff command
 */
export interface DiffResult extends Duration {
  /**
   * Total number of stacks that have changes
   */
  readonly numStacksWithChanges: number;
  /**
   * Total number of stacks that have security-related changes
   */
  readonly numStacksWithSecurityChanges: number;
  /**
   * Structural diff of all selected stacks
   */
  readonly diffs: { [name: string]: ITemplateDiff };
}
