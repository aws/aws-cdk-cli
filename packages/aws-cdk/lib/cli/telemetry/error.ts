import { ToolkitError } from "@aws-cdk/toolkit-lib";
import { ServiceException } from "@smithy/smithy-client";

/**
 * Return the transmitted error code for this error object
 *
 * We are taking care to only transmit errors that originate from AWS systems
 * (this toolkit itself, the CDK construct library, the AWS SDK, AWS services).
 */
export function cdkCliErrorName(err: Error): string {
  if (ServiceException.isInstance(err)) {
    // SDK and/or Service error
    return `SDK:${err.name}`;
  }

  if (ToolkitError.isAssemblyError(err) && err.synthErrorCode) {
    // If we have a synth code, return that
    return `Synth:${err.synthErrorCode}`;
  }

  if (ToolkitError.isToolkitError(err)) {
    // Any old error originating from us
    return err.name;
  }

  // Off-limits error
  return 'UnknownError';
}

