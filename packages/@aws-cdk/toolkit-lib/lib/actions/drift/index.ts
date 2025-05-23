import type { StackSelector } from '../../api/cloud-assembly';

export interface DriftOptions {
  /**
   * Criteria for selecting stacks to check for drift
   */
  readonly stacks: StackSelector;
}

export interface FormattedDrift {
  /**
   * Resources that have not changed
   */
  readonly unchanged?: string;

  /**
   * Resources that were not checked for drift
   */
  readonly unchecked?: string;

  /**
   * Resources with drift
   */
  readonly modified?: string;

  /**
   * Resources that have been deleted (drift)
   */
  readonly deleted?: string;

  /**
   * The header, containing the stack name
   */
  readonly stackHeader?: string;

  /**
   * The final results (summary) of the drift results
   */
  readonly finalResult?: string;
}

export interface DriftCommandResult {
  /**
   * Number of resources with drift
   */
  readonly numResourcesWithDrift?: number;

  /**
   * How many resources were not checked for drift
   */
  readonly numResourcesUnchecked?: number;

  /**
   * Complete formatted drift
   */
  readonly formattedDrift: string;
}
