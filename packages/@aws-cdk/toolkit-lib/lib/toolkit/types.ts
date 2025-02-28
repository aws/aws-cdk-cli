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
