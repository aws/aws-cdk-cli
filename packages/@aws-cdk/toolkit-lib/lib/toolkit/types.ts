import { PermissionChangeType } from '../actions/diff/private';
import { SuccessfulDeployStackResult as _SuccessfulDeployStackResult } from '../api/aws-cdk';

/**
 * Assembly data returned in the payload of an IO Message.
 */
export interface AssemblyData {
  /**
   * The path to the assembly directory
   */
  readonly assemblyDirectory: string;

  /**
   * The number of stacks actioned on
   */
  readonly stacksCount: number;

  /**
   * The stack IDs
   */
  readonly stackIds: string[];
}

/**
 * A successful deploy stack result. Intentionally exposed in toolkit-lib so documentation
 * can be generated from this interface.
 */
export interface SuccessfulDeployStackResult extends _SuccessfulDeployStackResult {
}

/**
 * Stack data returned in the payload of an IO Message.
 */
export interface StackData {
  /**
   * The stack name
   */
  readonly stackName: string;

  /**
   * The stack ID
   */
  readonly hierarchicalId: string;

  /**
   * The stack template
   */
  readonly template: any;

  /**
   * The stack template converted to JSON format
   */
  readonly stringifiedJson: string;

  /**
   * The stack template converted to YAML format
   */
  readonly stringifiedYaml: string;
}

/**
 * Stack data returned in the payload of an IO Message.
 */
export interface StackAndAssemblyData extends AssemblyData {
  /**
   * Stack Data
   */
  readonly stack: StackData;
}

/**
 * Duration information returned in the payload of an IO Message.
 */
export interface Duration {
  /**
   * The duration of the action.
   */
  readonly duration: number;
}

/**
 * Generic payload of error IoMessages that pass on an instance of `Error`
 */
export interface ErrorPayload {
  /**
   * The error that occurred
   */
  readonly error: Error;
}

/**
 * Generic payload of a simple yes/no question.
 *
 * The expectation is that 'yes' means moving on,
 * and 'no' means aborting the current action.
 */
export interface ConfirmationRequest {
  /**
   * Some additional motivation for the confirmation that may be used as context for the user.
   */
  readonly motivation: string;
  /**
   * Number of on-going concurrent operations
   * If more than one operations is on-going, a client might decide that asking the user
   * for input is too complex, as the confirmation might not easily be attributed to a specific request.
   *
   * @default - no concurrency
   */
  readonly concurrency?: number;
}

/**
 * Payload for a yes/no confirmation in deploy. Includes information on
 * what kind of change is being made.
 */
export interface DeployConfirmationRequest extends ConfirmationRequest {
  /**
   * The type of change being made to the IAM permissions.
   */
  readonly permissionChangeType?: PermissionChangeType;
}
