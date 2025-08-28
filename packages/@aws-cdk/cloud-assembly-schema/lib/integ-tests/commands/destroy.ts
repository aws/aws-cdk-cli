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
   * Skip waiting for the stack to finish deleting
   *
   * @default false
   */
  readonly skipAwaitDeletion?: boolean;
}
