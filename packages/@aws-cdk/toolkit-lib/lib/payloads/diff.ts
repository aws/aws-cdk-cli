import type { ITemplateDiff } from '@aws-cdk/cloudformation-diff';
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
   * Structural diff of all selected stacks
   */
  readonly diffs: { [name: string]: ITemplateDiff };
}
