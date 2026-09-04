import { formatErrorMessage } from '../../lib/util/format-error';

describe('formatErrorMessage', () => {
  test('should return the formatted message for a regular Error object', () => {
    const error = new Error('Something went wrong');
    const result = formatErrorMessage(error);
    expect(result).toBe('Something went wrong');
  });

  test('should return the formatted message for an AggregateError', () => {
    const error = {
      errors: [
        new Error('Inner error 1'),
        new Error('Inner error 2'),
        new Error('Inner error 3'),
      ],
    };
    const result = formatErrorMessage(error);
    expect(result).toBe('AggregateError: Inner error 1\nInner error 2\nInner error 3');
  });

  test('should return "Unknown error" for null or undefined error', () => {
    expect(formatErrorMessage(null)).toBe('Unknown error');
    expect(formatErrorMessage(undefined)).toBe('Unknown error');
  });

  test('should surface SDK error name and metadata when there is no message', () => {
    const error = {
      name: 'InternalFailure',
      message: '',
      $metadata: {
        httpStatusCode: 500,
        requestId: '296a5792-c977-4dd4-8f9b-269ae8c0b221',
      },
    };
    const result = formatErrorMessage(error);
    expect(result).toBe('InternalFailure (HTTP 500, request id: 296a5792-c977-4dd4-8f9b-269ae8c0b221)');
  });

  test('should fall back to the SDK error `code` when `name` is absent', () => {
    const error = {
      code: 'ValidationError',
      $metadata: { httpStatusCode: 400 },
    };
    const result = formatErrorMessage(error);
    expect(result).toBe('ValidationError (HTTP 400)');
  });

  test('should return just the error name when no metadata is present', () => {
    const error = { name: 'InternalFailure' };
    const result = formatErrorMessage(error);
    expect(result).toBe('InternalFailure');
  });

  test('should prefer a real message over SDK metadata', () => {
    const error = {
      name: 'ValidationError',
      message: 'Stack is in UPDATE_FAILED state',
      $metadata: { httpStatusCode: 400 },
    };
    const result = formatErrorMessage(error);
    expect(result).toBe('Stack is in UPDATE_FAILED state');
  });
});
