import type * as cxapi from '@aws-cdk/cloud-assembly-api';

const TOOLKIT_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.ToolkitError');
const AUTHENTICATION_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.AuthenticationError');
const DEPLOYMENT_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.DeploymentError');
const ASSEMBLY_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.AssemblyError');
const CONTEXT_PROVIDER_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.ContextProviderError');
const NO_RESULTS_FOUND_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.NoResultsFoundError');

/**
 * Represents a general toolkit error in the AWS CDK Toolkit.
 */
export class ToolkitError extends Error {
  /**
   * Determines if a given error is an instance of ToolkitError.
   */
  public static isToolkitError(x: any): x is ToolkitError {
    return x !== null && typeof(x) === 'object' && TOOLKIT_ERROR_SYMBOL in x;
  }

  /**
   * Determines if a given error is an instance of AuthenticationError.
   */
  public static isAuthenticationError(x: any): x is AuthenticationError {
    return ToolkitError.isToolkitError(x) && AUTHENTICATION_ERROR_SYMBOL in x;
  }

  /**
   * Determines if a given error is an instance of DeploymentError.
   */
  public static isDeploymentError(x: any): x is DeploymentError {
    return ToolkitError.isToolkitError(x) && DEPLOYMENT_ERROR_SYMBOL in x;
  }

  /**
   * Determines if a given error is an instance of AssemblyError.
   */
  public static isAssemblyError(x: any): x is AssemblyError {
    return ToolkitError.isToolkitError(x) && ASSEMBLY_ERROR_SYMBOL in x;
  }

  /**
   * Determines if a given error is an instance of ContextProviderError.
   */
  public static isContextProviderError(x: any): x is ContextProviderError {
    return ToolkitError.isToolkitError(x) && CONTEXT_PROVIDER_ERROR_SYMBOL in x;
  }

  /**
   * A ToolkitError with an original error as cause
   */
  public static withCause(errorCode: string, message: string, error: unknown): ToolkitError {
    return new ToolkitError(errorCode, message, 'toolkit', error);
  }

  /**
   * The type of the error, defaults to "toolkit".
   */
  public readonly type: string;

  /**
   * Denotes the source of the error as the toolkit.
   */
  public readonly source: 'toolkit' | 'user';

  /**
   * The specific original cause of the error, if available
   */
  public readonly cause?: unknown;

  constructor(errorCode: string, message: string, type: string = 'toolkit', cause?: unknown) {
    super(message);
    this.name = errorCode;
    Object.setPrototypeOf(this, ToolkitError.prototype);
    Object.defineProperty(this, TOOLKIT_ERROR_SYMBOL, { value: true });
    this.type = type;
    this.source = 'toolkit';
    this.cause = cause;
  }
}

/**
 * Represents an authentication-specific error in the AWS CDK Toolkit.
 */
export class AuthenticationError extends ToolkitError {
  /**
   * Denotes the source of the error as user.
   */
  public readonly source = 'user';

  constructor(errorCode: string, message: string) {
    super(errorCode, message, 'authentication');
    Object.setPrototypeOf(this, AuthenticationError.prototype);
    Object.defineProperty(this, AUTHENTICATION_ERROR_SYMBOL, { value: true });
  }
}

/**
 * Represents an error causes by cloud assembly synthesis
 *
 * This includes errors thrown during app execution, as well as failing annotations.
 */
export class AssemblyError extends ToolkitError {
  /**
   * An AssemblyError with an original error as cause
   */
  public static withCause(message: string, error: unknown): AssemblyError {
    return new AssemblyError(message, undefined, error);
  }

  /**
   * An AssemblyError with a list of stacks as cause
   */
  public static withStacks(message: string, stacks?: cxapi.CloudFormationStackArtifact[]): AssemblyError {
    return new AssemblyError(message, stacks);
  }

  /**
   * Denotes the source of the error as user.
   */
  public readonly source = 'user';

  /**
   * The stacks that caused the error, if available
   *
   * The `messages` property of each `cxapi.CloudFormationStackArtifact` will contain the respective errors.
   * Absence indicates synthesis didn't fully complete.
   */
  public readonly stacks?: cxapi.CloudFormationStackArtifact[];

  private _synthErrorCode: string | undefined;

  private constructor(message: string, stacks?: cxapi.CloudFormationStackArtifact[], cause?: unknown) {
    super('AssemblyError', message, 'assembly', cause);
    Object.setPrototypeOf(this, AssemblyError.prototype);
    Object.defineProperty(this, ASSEMBLY_ERROR_SYMBOL, { value: true });
    this.stacks = stacks;
  }

  /**
   * The synthesis error code
   */
  public get synthErrorCode(): string | undefined {
    return this._synthErrorCode;
  }

  public attachSynthesisErrorCode(synthesisErrorCode: string) {
    this._synthErrorCode = synthesisErrorCode;
  }
}

/**
 * Represents a deployment-related error in the AWS CDK Toolkit.
 */
export class DeploymentError extends ToolkitError {
  /**
   * Denotes the source of the error as user.
   */
  public readonly source = 'user';

  public readonly deploymentErrorCode: string;

  constructor(message: string, deploymentErrorCode: string) {
    super(message, 'deployment');
    Object.setPrototypeOf(this, DeploymentError.prototype);
    Object.defineProperty(this, DEPLOYMENT_ERROR_SYMBOL, { value: true });
    this.deploymentErrorCode = deploymentErrorCode;
  }
}

/**
 * Represents an error originating from a Context Provider
 */
export class ContextProviderError extends ToolkitError {
  /**
   * Determines if a given error is an instance of NoResultsFoundError.
   */
  public static isNoResultsFoundError(x: any): x is NoResultsFoundError {
    return ToolkitError.isContextProviderError(x) && NO_RESULTS_FOUND_ERROR_SYMBOL in x;
  }

  /**
   * A ContextProviderError with an original error as cause
   */
  public static withCause(errorCode: string, message: string, error: unknown): ContextProviderError {
    return new ContextProviderError(errorCode, message, error);
  }

  /**
   * Denotes the source of the error as user.
   */
  public readonly source = 'user';

  constructor(errorCode: string, message: string, cause?: unknown) {
    super(errorCode, message, 'context-provider', cause);
    Object.setPrototypeOf(this, ContextProviderError.prototype);
    Object.defineProperty(this, CONTEXT_PROVIDER_ERROR_SYMBOL, { value: true });
  }
}

/**
 * A specific context provider lookup failure indicating no results where found for a context query
 */
export class NoResultsFoundError extends ContextProviderError {
  constructor(message: string) {
    super('NoResultsFound', message);
    Object.setPrototypeOf(this, NoResultsFoundError.prototype);
    Object.defineProperty(this, NO_RESULTS_FOUND_ERROR_SYMBOL, { value: true });
  }
}

export abstract class DeploymentErrorCodes {
  public static readonly STACK_DISAPPEARED_ERROR_CODE = 'StackDisappeared';
  public static readonly UNKNOWN_ERROR = 'UnknownError';
  public static readonly PRIVATE_RESOURCE_ERROR = 'PrivateResourceError';
}

