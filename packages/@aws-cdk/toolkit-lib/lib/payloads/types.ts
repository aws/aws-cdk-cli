import type * as cxapi from '@aws-cdk/cloud-assembly-api';

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
 * A payload identifying a single stacks
 */
export interface SingleStack {
  /**
   * A single stack
   */
  readonly stack: cxapi.CloudFormationStackArtifact;
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
 * Operation information that *definitely* took time, and *maybe* produced an error
 */
export interface Operation extends Duration {
  /**
   * Optionally, an error that occurred
   */
  readonly error?: Error;
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
   * @default - No concurrency
   */
  readonly concurrency?: number;
}

/**
 * A generic request for data
 */
export interface DataRequest {
  /**
   * An optional description of the expected response
   * Provides additional details on what the response can be.
   * This can be treated as a direct instruction to end-users when prompting for input.
   */
  responseDescription?: string;
}

export interface ContextProviderMessageSource {
  /**
   * The name of the context provider sending the message
   */
  readonly provider: string;
}
