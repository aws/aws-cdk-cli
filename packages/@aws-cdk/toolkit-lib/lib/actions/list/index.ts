import type { StackSelector } from '../../api/cloud-assembly';

export interface ListOptions {
  /**
   * Select the stacks
   */
  readonly stacks?: StackSelector;

  /**
   * Cancel the synth operation
   *
   * @default - No ability to abort
   */
  readonly abort?: AbortSignal;
}
