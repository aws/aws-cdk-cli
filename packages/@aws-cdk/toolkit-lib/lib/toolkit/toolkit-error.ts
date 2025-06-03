import type * as cxapi from '@aws-cdk/cx-api';

const TOOLKIT_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.ToolkitError');
const AUTHENTICATION_ERROR_SYMBOL = Symbol.for('@aws-cdk/toolkit-lib.AuthenticationError');
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
    return this.isToolkitError(x) && AUTHENTICATION_ERROR_SYMBOL in x;
  }

  /**
   * Determines if a given error is an instance of AssemblyError.
   */
  public static isAssemblyError(x: any): x is AssemblyError {
    return this.isToolkitError(x) && ASSEMBLY_ERROR_SYMBOL in x;
  }

  /**
   * Determines if a given error is an instance of AssemblyError.
   */
  public static isContextProviderError(x: any): x is ContextProviderError {
    return this.isToolkitError(x) && CONTEXT_PROVIDER_ERROR_SYMBOL in x;
  }

  /**
   * An AssemblyError with an original error as cause
   */
  public static withCause(message: string, error: unknown): ToolkitError {
    return new ToolkitError(message, 'toolkit', error);
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

  constructor(message: string, type: string = 'toolkit', cause?: unknown) {
    super(message);
    Object.setPrototypeOf(this, ToolkitError.prototype);
    Object.defineProperty(this, TOOLKIT_ERROR_SYMBOL, { value: true });
    this.name = new.target.name;
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

  constructor(message: string) {
    super(message, 'authentication');
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

  private constructor(message: string, stacks?: cxapi.CloudFormationStackArtifact[], cause?: unknown) {
    super(message, 'assembly', cause);
    Object.setPrototypeOf(this, AssemblyError.prototype);
    Object.defineProperty(this, ASSEMBLY_ERROR_SYMBOL, { value: true });
    this.stacks = stacks;
  }
}

/**
 * Represents an error originating from a Context Provider
 */
export class ContextProviderError extends ToolkitError {
  /**
   * Determines if a given error is an instance of AssemblyError.
   */
  public static isNoResultsFoundError(x: any): x is NoResultsFoundError {
    return this.isContextProviderError(x) && NO_RESULTS_FOUND_ERROR_SYMBOL in x;
  }

  /**
   * Denotes the source of the error as user.
   */
  public readonly source = 'user';

  constructor(message: string) {
    super(message, 'context-provider');
    Object.setPrototypeOf(this, ContextProviderError.prototype);
    Object.defineProperty(this, CONTEXT_PROVIDER_ERROR_SYMBOL, { value: true });
  }
}

/**
 * A specific context provider lookup failure indicating no results where found for a context query
 */
export class NoResultsFoundError extends ContextProviderError {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, NoResultsFoundError.prototype);
    Object.defineProperty(this, NO_RESULTS_FOUND_ERROR_SYMBOL, { value: true });
  }
}
