import type * as cxapi from '@aws-cdk/cx-api';

export interface BootstrapEnvironmentProgress {
  /**
   * Uniquely identifies this marker amongst concurrent messages
   *
   * This is an otherwise meaningless identifier.
   */
  readonly marker: string;
  /**
   * The total number of environments being deployed
   */
  readonly total: number;
  /**
   * The count of the environment currently bootstrapped
   *
   * This is counting value, not an identifier.
   */
  readonly current: number;
  /**
   * The environment that's currently being bootstrapped
   */
  readonly environment: cxapi.Environment;
}
