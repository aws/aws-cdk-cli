import { AssemblyError, AuthenticationError, ContextProviderError, ToolkitError } from "@aws-cdk/toolkit-lib";
import { ServiceException } from "@smithy/smithy-client";

/**
 * The error code when a user hits Ctrl-C
 */
export const USER_INTERRUPTED_CODE = 'UserInterrupted';

/**
 * If we can't find a specific error code
 */
export const UNKNOWN_ERROR_CODE = 'UnknownError';

/**
 * Return the transmitted error code for this error object
 *
 * We are taking care to only transmit errors that originate from AWS systems
 * (this toolkit itself, the CDK construct library, the AWS SDK, AWS services).
 */
export function cdkCliErrorName(err: Error): string {
  if (ToolkitError.isToolkitError(err)) {
    // Any old error originating from us.
    // Get a specific cause, if any, otherwise just the class name
    return firstSpecificCause(err) ?? err.name;
  }

  // Off-limits error
  return UNKNOWN_ERROR_CODE;
}

/**
 * Return the first error cause that has a specific error, if any
 */
function firstSpecificCause(error: Error): string | undefined {
  const ret = specificErrorCode(error);
  if (ret) {
    return ret;
  }

  if (error.cause && error.cause instanceof Error) {
    return firstSpecificCause(error.cause);
  }

  return undefined;
}

/**
 * Return a specific error code for the given function, or undefined if we don't have a specific code
 */
function specificErrorCode(err: Error): string | undefined {
  if (ServiceException.isInstance(err)) {
    // SDK and/or Service error
    return `sdk:${err.name}`;
  }

  if (ToolkitError.isAssemblyError(err) && err.synthErrorCode) {
    // If we have a synth code, return that
    return `synth:${err.synthErrorCode}`;
  }

  // If we have a more specific error code than just the error name, use that
  const standardErrorNames = [ToolkitError.name, AuthenticationError.name, AssemblyError.name, ContextProviderError.name];
  if (ToolkitError.isToolkitError(err) && !standardErrorNames.includes(err.name)) {
    return err.name;
  }

  return undefined;
}