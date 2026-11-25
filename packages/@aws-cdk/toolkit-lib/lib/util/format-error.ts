import { ToolkitError } from '../toolkit/toolkit-error';

/**
 * Where the AWS SDK API call that produced an error is recorded on the error.
 *
 * A non-enumerable property under a global symbol, so it doesn't change how the
 * error serializes or inspects, and isn't mistaken for something the SDK put there.
 */
const SDK_API_CALL = Symbol.for('@aws-cdk/toolkit-lib.sdkApiCall');

/**
 * Record on an error which AWS SDK API call produced it, e.g. `CloudFormation.DescribeStacks`.
 *
 * The first recorded call wins, so a call made inside another call keeps the innermost one.
 */
export function recordSdkApiCall(error: unknown, apiCall: string): void {
  if (!error || typeof error !== 'object' || SDK_API_CALL in error || !Object.isExtensible(error)) {
    return;
  }
  Object.defineProperty(error, SDK_API_CALL, { value: apiCall, enumerable: false });
}

/**
 * The AWS SDK API call that produced the given error, if known.
 */
export function sdkApiCallOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const apiCall = (error as any)[SDK_API_CALL];
  return typeof apiCall === 'string' ? apiCall : undefined;
}

/**
 * Prefix a message with the AWS SDK API call that produced the error, if known.
 */
export function withSdkApiCall(error: unknown, message: string): string {
  const apiCall = sdkApiCallOf(error);
  return apiCall ? `${apiCall}: ${message}` : message;
}

/**
 * Takes in an error and returns a correctly formatted string of its error message.
 * If it is an AggregateError, it will return a string with all the inner errors
 * formatted and separated by a newline.
 *
 * Errors produced by an AWS SDK API call are prefixed with that call, e.g.
 * `S3.PutObject: Access Denied`.
 *
 * @param error - The error to format
 * @returns A string with the error message(s) of the error
 */
export function formatErrorMessage(error: any): string {
  if (error && Array.isArray(error.errors)) {
    const innerMessages = error.errors
      .map((innerError: { message: any; toString: () => any }) => withSdkApiCall(innerError, innerError?.message || innerError?.toString()))
      .join('\n');
    return withSdkApiCall(error, `AggregateError: ${innerMessages}`);
  }

  if (ToolkitError.isToolkitError(error) && error.cause) {
    return `${error.message}\n${formatErrorMessage(error.cause)}`;
  }

  // Regular Error or other types with a usable message
  if (error?.message) {
    return withSdkApiCall(error, error.message);
  }

  // Some service errors carry no `message` at all.
  // Surface whatever the AWS SDK gives us
  const fromSdk = formatSdkError(error);
  if (fromSdk) {
    return withSdkApiCall(error, fromSdk);
  }

  // fallback if AWS SDK has no information for us
  return error?.toString() || 'Unknown error';
}

/**
 * Build a message from an AWS SDK error's name/code and response metadata.
 *
 * Returns `undefined` if there is nothing useful to say.
 */
function formatSdkError(error: any): string | undefined {
  const name: string | undefined = error?.name ?? error?.code;
  const metadata = error?.$metadata ?? {};
  const details: string[] = [];
  if (typeof metadata.httpStatusCode === 'number') {
    details.push(`HTTP ${metadata.httpStatusCode}`);
  }
  if (metadata.requestId) {
    details.push(`request id: ${metadata.requestId}`);
  }

  if (name && details.length > 0) {
    return `${name} (${details.join(', ')})`;
  }
  if (name) {
    return name;
  }
  if (details.length > 0) {
    return details.join(', ');
  }
  return undefined;
}
