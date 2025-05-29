import type { StackSelector } from '../../api/cloud-assembly';

export interface DriftOptions {
  /**
   * Select stacks to check for drift
   *
   * @default - all stacks
   */
  readonly stacks?: StackSelector;
}

/**
 * The different types of drift as formatted drift output
 *
 * A missing type implies no drift of this type.
 * If no drift was detected at all, all will be missing.
 */
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
}

/**
 * Combined drift for selected stacks of the app
 */
export interface DriftResult {
  /**
   * Number of resources with drift. If undefined, then an error occurred
   * and resources were not properly checked for drift.
   */
  readonly numResourcesWithDrift: number;

  /**
   * How many resources were not checked for drift. If undefined, then an
   * error occurred and resources were not properly checked for drift.
   */
  readonly numResourcesUnchecked: number;

  /**
   * Complete formatted drift
   */
  readonly formattedDrift: FormattedDrift;
}
