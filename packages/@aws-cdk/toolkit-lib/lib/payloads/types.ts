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
 * The result of the online (CloudFormation change set) validation phase of the
 * `validate` action.
 *
 * This payload is only emitted when online validation actually runs. `duration`
 * times the online phase and `counters` describe only its outcome. Offline
 * validation runs during synthesis and its counters are reported separately.
 */
export interface OnlineValidationResult extends Duration {
  /**
   * Counters describing the outcome of the online validation phase.
   *
   * @default - no counters
   */
  readonly counters?: Record<string, number>;

  /**
   * Set when the online validation engine could not run at all.
   *
   * Online validation finding template problems is not an error; this is only
   * set when the validation itself could not be performed (for example, when
   * the CloudFormation calls failed for every selected stack).
   *
   * @default - online validation ran
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
