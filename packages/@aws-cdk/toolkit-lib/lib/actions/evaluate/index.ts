import type { StackSelector } from '../../api/cloud-assembly';

export interface EvaluateOptions {
  /**
   * Select the stacks to evaluate
   *
   * @default - All stacks
   */
  readonly stacks?: StackSelector;

  /**
   * Name of the toolkit stack, used to access the stacks' environments
   *
   * @default "CDKToolkit"
   */
  readonly toolkitStackName?: string;

  /**
   * Maximum number of stacks to evaluate in parallel
   *
   * @default 10
   */
  readonly concurrency?: number;

  /**
   * Cancel the synth operation
   *
   * @default - No ability to abort
   */
  readonly abort?: AbortSignal;
}

/**
 * An expression in a stack template that could not be evaluated against the deployed stack
 */
export interface UnresolvedExpression {
  /**
   * Location of the expression in the template, e.g. `Resources.MyBucket.Properties.BucketName`
   */
  readonly path: string;

  /**
   * The intrinsic function that could not be evaluated, e.g. `Fn::GetAtt`
   */
  readonly intrinsic: string;

  /**
   * Why the expression could not be evaluated
   */
  readonly reason: string;
}

/**
 * A stack template evaluated against the deployed stack
 */
export interface EvaluatedStack {
  /**
   * The name of the stack
   */
  readonly stackName: string;

  /**
   * The hierarchical id of the stack in the cloud assembly
   *
   * For a nested stack, the hierarchical id of its parent followed by the nested stack's logical id.
   */
  readonly hierarchicalId: string;

  /**
   * The deployed stack's id (its ARN)
   */
  readonly stackId: string;

  /**
   * The physical id of each deployed resource in the stack, by logical id
   */
  readonly physicalResourceIds: { [logicalId: string]: string };

  /**
   * The stack's template, with every expression in `Resources` and `Outputs` that could be
   * evaluated against the deployed stack replaced by its value
   *
   * Expressions that could not be evaluated are left in place, and listed in `unresolved`.
   */
  readonly template: { [key: string]: any };

  /**
   * Expressions that could not be evaluated
   */
  readonly unresolved: UnresolvedExpression[];

  /**
   * The stack's deployed CDK-managed nested stacks, evaluated the same way, by logical id
   *
   * A nested stack gets the parameter values its parent passes, as evaluated in the parent.
   *
   * @default - the stack has no nested stacks
   */
  readonly nestedStacks?: { [logicalId: string]: EvaluatedStack };
}

/**
 * Result of the evaluate action
 */
export interface EvaluateResult {
  /**
   * The evaluated stacks
   */
  readonly stacks: EvaluatedStack[];

  /**
   * Names of the selected stacks that are not deployed (including stacks whose creation failed or never ran), and so were not evaluated
   */
  readonly notDeployed: string[];
}
