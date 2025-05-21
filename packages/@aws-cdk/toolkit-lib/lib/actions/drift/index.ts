import type { StackSelector } from '../../api/cloud-assembly';

export interface DriftOptions {
  /**
   * Criteria for selecting stacks to check for drift
   */
  readonly stacks: StackSelector;

  /**
   * Whether to fail with exit code 1 if drift is detected
   *
   * @default false
   */
  readonly fail?: boolean;
}

export interface DriftResult {
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
