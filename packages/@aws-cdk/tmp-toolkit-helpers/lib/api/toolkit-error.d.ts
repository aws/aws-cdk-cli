import type * as cxapi from '@aws-cdk/cx-api';
/**
 * Represents a general toolkit error in the AWS CDK Toolkit.
 */
export declare class ToolkitError extends Error {
    /**
     * Determines if a given error is an instance of ToolkitError.
     */
    static isToolkitError(x: any): x is ToolkitError;
    /**
     * Determines if a given error is an instance of AuthenticationError.
     */
    static isAuthenticationError(x: any): x is AuthenticationError;
    /**
     * Determines if a given error is an instance of AssemblyError.
     */
    static isAssemblyError(x: any): x is AssemblyError;
    /**
     * Determines if a given error is an instance of AssemblyError.
     */
    static isContextProviderError(x: any): x is ContextProviderError;
    /**
     * An AssemblyError with an original error as cause
     */
    static withCause(message: string, error: unknown): ToolkitError;
    /**
     * The type of the error, defaults to "toolkit".
     */
    readonly type: string;
    /**
     * Denotes the source of the error as the toolkit.
     */
    readonly source: 'toolkit' | 'user';
    /**
     * The specific original cause of the error, if available
     */
    readonly cause?: unknown;
    constructor(message: string, type?: string, cause?: unknown);
}
/**
 * Represents an authentication-specific error in the AWS CDK Toolkit.
 */
export declare class AuthenticationError extends ToolkitError {
    /**
     * Denotes the source of the error as user.
     */
    readonly source = "user";
    constructor(message: string);
}
/**
 * Represents an error causes by cloud assembly synthesis
 *
 * This includes errors thrown during app execution, as well as failing annotations.
 */
export declare class AssemblyError extends ToolkitError {
    /**
     * An AssemblyError with an original error as cause
     */
    static withCause(message: string, error: unknown): AssemblyError;
    /**
     * An AssemblyError with a list of stacks as cause
     */
    static withStacks(message: string, stacks?: cxapi.CloudFormationStackArtifact[]): AssemblyError;
    /**
     * Denotes the source of the error as user.
     */
    readonly source = "user";
    /**
     * The stacks that caused the error, if available
     *
     * The `messages` property of each `cxapi.CloudFormationStackArtifact` will contain the respective errors.
     * Absence indicates synthesis didn't fully complete.
     */
    readonly stacks?: cxapi.CloudFormationStackArtifact[];
    private constructor();
}
/**
 * Represents an error originating from a Context Provider
 */
export declare class ContextProviderError extends ToolkitError {
    /**
     * Denotes the source of the error as user.
     */
    readonly source = "user";
    constructor(message: string);
}
