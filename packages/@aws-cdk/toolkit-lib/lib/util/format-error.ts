import { ToolkitError } from '../toolkit/toolkit-error';

/**
 * Takes in an error and returns a correctly formatted string of its error message.
 * If it is an AggregateError, it will return a string with all the inner errors
 * formatted and separated by a newline.
 *
 * @param error - The error to format
 * @returns A string with the error message(s) of the error
 */
export function formatErrorMessage(error: any): string {
  if (error && Array.isArray(error.errors)) {
    const innerMessages = error.errors
      .map((innerError: { message: any; toString: () => any }) => (innerError?.message || innerError?.toString()))
      .join('\n');
    return `AggregateError: ${innerMessages}`;
  }

  if (ToolkitError.isToolkitError(error) && error.cause) {
    return `${error.message}\n${formatErrorMessage(error.cause)}`;
  }

  // Regular Error or other types with a usable message
  if (error?.message) {
    return error.message;
  }

  // Some service errors carry no `message` at all.
  // Surface whatever the AWS SDK gives us
  const fromSdk = formatSdkError(error);
  if (fromSdk) {
    return fromSdk;
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
