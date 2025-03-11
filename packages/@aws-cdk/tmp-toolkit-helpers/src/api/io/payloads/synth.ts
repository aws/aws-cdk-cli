import type { StackSelector } from '../../cloud-assembly/stack-selector';

export interface StackSelectionDetails {
  /**
   * The selected stacks, if any
   */
  readonly stacks: StackSelector;
}
