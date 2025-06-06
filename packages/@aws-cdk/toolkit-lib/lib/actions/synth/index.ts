import type { StackSelector } from '../../api/cloud-assembly';

export interface SynthOptions {
  /**
   * Select the stacks
   */
  readonly stacks?: StackSelector;

  /**
   * After synthesis, validate stacks with the "validateOnSynth" attribute set (can also be controlled with CDK_VALIDATION)
   * @defaultValue true
   */
  readonly validateStacks?: boolean;
}
