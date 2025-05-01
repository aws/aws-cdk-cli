/**
 * Takes in an error and returns a correctly formatted string of its error message.
 * If it is an AggregateError, it will return a string with all the inner errors
 * formatted and separated by a newline.
 *
 * @param error The error to format
 * @returns A string with the error message(s) of the error
 */
export declare function formatErrorMessage(error: any): string;
