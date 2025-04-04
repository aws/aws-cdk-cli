/**
 * Result interface for toolkit.deploy operation
 */
export interface DeployResult {
  /**
   * Map of deployed stacks by artifact ID.
   */
  readonly stacks: DeployedStack[];
}

/**
 * Information about a deployed stack
 */
export interface DeployedStack {
  /**
   * The name of the deployed stack
   *
   * A stack name is unique inside its environment, but not unique globally.
   */
  readonly stackName: string;

  /**
   * The environment where the stack was deployed
   *
   * This environment is always concrete, because even though the CDK app's
   * stack may be region-agnostic, in order to be deployed it will have to have
   * been specialized.
   */
  readonly environment: Environment;

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
   * The ARN of the deployed stack
   */
  readonly stackArn: string;

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
export interface DeployedStack {
  /**
   * The name of the deployed stack
   *
   * A stack name is unique inside its environment, but not unique globally.
   */
  readonly stackName: string;

  /**
   * The environment where the stack was deployed
   *
   * This environment is always concrete, because even though the CDK app's
   * stack may be region-agnostic, in order to be deployed it will have to have
   * been specialized.
   */
  readonly environment: Environment;

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
   * The ARN of the deployed stack
   */
  readonly stackArn: string;

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
export interface DestroyedStack {
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
   * The ARN of the stack that was destroyed, if any.
   *
   * If the stack didn't exist to begin with, the operation will succeed but
   * this value will be undefined.
   */
  readonly stackArn?: string;
}
/**
 * Result interface for toolkit.deploy operation
 */
export interface DeployResult {
  /**
   * Map of deployed stacks by artifact ID.
   */
  readonly stacks: DeployedStack[];
}

/**
 * Information about a deployed stack
 */
export interface DeployedStack {
  /**
   * The name of the deployed stack
   *
   * A stack name is unique inside its environment, but not unique globally.
   */
  readonly stackName: string;

  /**
   * The environment where the stack was deployed
   *
   * This environment is always concrete, because even though the CDK app's
   * stack may be region-agnostic, in order to be deployed it will have to have
   * been specialized.
   */
  readonly environment: Environment;

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
   * The ARN of the deployed stack
   */
  readonly stackArn: string;

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
export interface DeployedStack {
  /**
   * The name of the deployed stack
   *
   * A stack name is unique inside its environment, but not unique globally.
   */
  readonly stackName: string;

  /**
   * The environment where the stack was deployed
   *
   * This environment is always concrete, because even though the CDK app's
   * stack may be region-agnostic, in order to be deployed it will have to have
   * been specialized.
   */
  readonly environment: Environment;

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
   * The ARN of the deployed stack
   */
  readonly stackArn: string;

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
