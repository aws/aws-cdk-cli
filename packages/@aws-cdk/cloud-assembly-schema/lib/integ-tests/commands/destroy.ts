import type { DefaultCdkOptions } from './common';

/**
 * Options to use with cdk destroy
 */
export interface DestroyOptions extends DefaultCdkOptions {
  /**
   * Do not ask for permission before destroying stacks
   *
   * @default false
   */
  readonly force?: boolean;

  /**
   * Only destroy the given stack
   *
   * @default false
   */
  readonly exclusively?: boolean;

  /**
   * Whether or not to wait for the stack to finish deleting
   * This functionality does not work for stacks which have dependent stacks
   *
   * @default false
   */
  readonly noWait?: boolean;
}
