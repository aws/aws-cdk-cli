/**
 * Properties that describe a physically deployed stack
 */
export interface PhysicalStack<Arn extends 'arnRequired' | 'arnOptional' = 'arnRequired'> {
  /**
   * The name of the stack
   *
   * A stack name is unique inside its environment, but not unique globally.
   */
  readonly stackName: string;

  /**
   * The environment of the stack
   *
   * This environment is always concrete, because even though the CDK app's
   * stack may be region-agnostic, in order to be deployed it will have to have
   * been specialized.
   */
  readonly environment: Environment;

  /**
   * The ARN of the stack
   */
  readonly stackArn: Arn extends 'arnOptional' ? string | undefined : string;
}

/**
 * Result interface for toolkit.deploy operation
 */
export interface DeployResult {
  /**
   * List of stacks deployed by this operation
   */
  readonly stacks: DeployedStack[];
}

/**
 * Information about a deployed stack
 */
export interface DeployedStack extends PhysicalStack {
  /**
   * Hierarchical identifier
   *
   * This uniquely identifies the stack inside the CDK app.
   *
   * In practice this will be the stack's construct path, but unfortunately the
   * Cloud Assembly contract doesn't require or guarantee that.
   */
  readonly hierarchicalId: string;

  /**
   * The outputs of the deployed CloudFormation stack
   */
  readonly outputs: { [key: string]: string };
}

/**
 * An environment, which is an (account, region) pair
 */
export interface Environment {
  /**
   * The account number
   */
  readonly account: string;

  /**
   * The region number
   */
  readonly region: string;
}

/**
 * Result interface for toolkit.destroy operation
 */
export interface DestroyResult {
  /**
   * List of stacks destroyed by this operation
   */
  readonly stacks: DestroyedStack[];
}

/**
 * A stack targeted by a destroy operation
 */
export interface DestroyedStack extends PhysicalStack<'arnOptional'> {
  /**
   * Whether the stack existed to begin with
   *
   * If `!stackExisted`, the stack didn't exist, wasn't deleted, and `stackArn`
   * will be `undefined`.
   */
  readonly stackExisted: boolean;
}

/**
 * Result interface for toolkit.rollback operation
 */
export interface RollbackResult {
  /**
   * List of stacks rolled back by this operation
   */
  readonly stacks: RolledBackStack[];
}

/**
 * A stack targeted by a rollback operation
 */
export interface RolledBackStack extends PhysicalStack {
  /**
   * What operation we did for this stack
   *
   * Either: we did roll it back, or we didn't need to roll it back because
   * it was already stable.
   */
  readonly result: StackRollbackResult;
}

export type StackRollbackResult = 'rolled-back' | 'already-stable';

export interface FeatureFlag {
  readonly module: string;
  readonly name: string;
  readonly recommendedValue: unknown;
  readonly userValue?: unknown;
  readonly explanation?: string;
  readonly unconfiguredBehavesLike?: { v2?: any };
}
