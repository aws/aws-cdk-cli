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

  /**
   * Abort the synthesis process if needed.
   *
   * If this is triggered, the synthesis process will be aborted with an exception.
   *
   * @default - No possibility to abort
   */
  readonly abort?: AbortSignal;
}
