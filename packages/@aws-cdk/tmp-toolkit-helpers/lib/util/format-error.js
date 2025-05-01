"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatErrorMessage = formatErrorMessage;
/**
 * Takes in an error and returns a correctly formatted string of its error message.
 * If it is an AggregateError, it will return a string with all the inner errors
 * formatted and separated by a newline.
 *
 * @param error The error to format
 * @returns A string with the error message(s) of the error
 */
function formatErrorMessage(error) {
    if (error && Array.isArray(error.errors)) {
        const innerMessages = error.errors
            .map((innerError) => (innerError?.message || innerError?.toString()))
            .join('\n');
        return `AggregateError: ${innerMessages}`;
    }
    // Fallback for regular Error or other types
    return error?.message || error?.toString() || 'Unknown error';
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZm9ybWF0LWVycm9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3V0aWwvZm9ybWF0LWVycm9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBUUEsZ0RBVUM7QUFsQkQ7Ozs7Ozs7R0FPRztBQUNILFNBQWdCLGtCQUFrQixDQUFDLEtBQVU7SUFDM0MsSUFBSSxLQUFLLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztRQUN6QyxNQUFNLGFBQWEsR0FBRyxLQUFLLENBQUMsTUFBTTthQUMvQixHQUFHLENBQUMsQ0FBQyxVQUFpRCxFQUFFLEVBQUUsQ0FBQyxDQUFDLFVBQVUsRUFBRSxPQUFPLElBQUksVUFBVSxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUM7YUFDM0csSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2QsT0FBTyxtQkFBbUIsYUFBYSxFQUFFLENBQUM7SUFDNUMsQ0FBQztJQUVELDRDQUE0QztJQUM1QyxPQUFPLEtBQUssRUFBRSxPQUFPLElBQUksS0FBSyxFQUFFLFFBQVEsRUFBRSxJQUFJLGVBQWUsQ0FBQztBQUNoRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBUYWtlcyBpbiBhbiBlcnJvciBhbmQgcmV0dXJucyBhIGNvcnJlY3RseSBmb3JtYXR0ZWQgc3RyaW5nIG9mIGl0cyBlcnJvciBtZXNzYWdlLlxuICogSWYgaXQgaXMgYW4gQWdncmVnYXRlRXJyb3IsIGl0IHdpbGwgcmV0dXJuIGEgc3RyaW5nIHdpdGggYWxsIHRoZSBpbm5lciBlcnJvcnNcbiAqIGZvcm1hdHRlZCBhbmQgc2VwYXJhdGVkIGJ5IGEgbmV3bGluZS5cbiAqXG4gKiBAcGFyYW0gZXJyb3IgVGhlIGVycm9yIHRvIGZvcm1hdFxuICogQHJldHVybnMgQSBzdHJpbmcgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZShzKSBvZiB0aGUgZXJyb3JcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEVycm9yTWVzc2FnZShlcnJvcjogYW55KTogc3RyaW5nIHtcbiAgaWYgKGVycm9yICYmIEFycmF5LmlzQXJyYXkoZXJyb3IuZXJyb3JzKSkge1xuICAgIGNvbnN0IGlubmVyTWVzc2FnZXMgPSBlcnJvci5lcnJvcnNcbiAgICAgIC5tYXAoKGlubmVyRXJyb3I6IHsgbWVzc2FnZTogYW55OyB0b1N0cmluZzogKCkgPT4gYW55IH0pID0+IChpbm5lckVycm9yPy5tZXNzYWdlIHx8IGlubmVyRXJyb3I/LnRvU3RyaW5nKCkpKVxuICAgICAgLmpvaW4oJ1xcbicpO1xuICAgIHJldHVybiBgQWdncmVnYXRlRXJyb3I6ICR7aW5uZXJNZXNzYWdlc31gO1xuICB9XG5cbiAgLy8gRmFsbGJhY2sgZm9yIHJlZ3VsYXIgRXJyb3Igb3Igb3RoZXIgdHlwZXNcbiAgcmV0dXJuIGVycm9yPy5tZXNzYWdlIHx8IGVycm9yPy50b1N0cmluZygpIHx8ICdVbmtub3duIGVycm9yJztcbn1cbiJdfQ==