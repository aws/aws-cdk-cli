import type { StackSelector } from '../../api/cloud-assembly';

export interface SynthOptions {
  /**
   * Select the stacks
   */
  readonly stacks?: StackSelector;

  /**
   * After synthesis, validate stacks with the "validateOnSynth" attribute set (can also be controlled with CDK_VALIDATION)
   * @default true
   */
  readonly validateStacks?: boolean;
}

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
