import type { DefaultCdkOptions } from '@aws-cdk/cloud-assembly-schema/lib/integ-tests';

/**
 * Options for cdk list
 */
export interface ListOptions extends DefaultCdkOptions {
  /**
   *Display environment information for each stack
   *
   * @default false
   */
  readonly long?: boolean;
}
