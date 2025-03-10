import type { StackSelector } from '../../cloud-assembly/stack-selector';

export interface StackSelectionDetails {
  /**
   * Uniquely identifies this marker amongst concurrent messages
   *
   * This is an otherwise meaningless identifier.
   */
  readonly marker: string;

  /**
   * The selected stacks, if any
   */
  readonly stacks: StackSelector;
}
