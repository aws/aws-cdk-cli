import { ToolkitError } from '../../lib/toolkit/toolkit-error';
import { formatErrorMessage, recordSdkApiCall, sdkApiCallOf } from '../../lib/util/format-error';

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

  test('should prefix the message with the SDK API call that produced it', () => {
    const error = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' });
    recordSdkApiCall(error, 'S3.PutObject');
    expect(formatErrorMessage(error)).toBe('S3.PutObject: Access Denied');
    expect(error.message).toBe('Access Denied');
  });

  test('should prefix SDK errors without a message with the SDK API call', () => {
    const error = { name: 'InternalFailure', $metadata: { httpStatusCode: 500 } };
    recordSdkApiCall(error, 'CloudFormation.DescribeStacks');
    expect(formatErrorMessage(error)).toBe('CloudFormation.DescribeStacks: InternalFailure (HTTP 500)');
  });

  test('should prefix inner errors of an AggregateError with their SDK API call', () => {
    const inner = new Error('Access Denied');
    recordSdkApiCall(inner, 'S3.PutObject');
    const error = new AggregateError([inner, new Error('Other error')]);
    expect(formatErrorMessage(error)).toBe('AggregateError: S3.PutObject: Access Denied\nOther error');
  });

  test('should prefix the cause of a ToolkitError with its SDK API call', () => {
    const cause = new Error('Rate exceeded');
    recordSdkApiCall(cause, 'CloudFormation.DescribeStackEvents');
    const error = ToolkitError.withCause('SomeCode', 'Deployment failed', cause);
    expect(formatErrorMessage(error)).toBe('Deployment failed\nCloudFormation.DescribeStackEvents: Rate exceeded');
  });

  test('should keep the SDK API call when the same call is recorded again', () => {
    const error = new Error('Access Denied');
    recordSdkApiCall(error, 'S3.PutObject');
    recordSdkApiCall(error, 'S3.PutObject');
    expect(sdkApiCallOf(error)).toBe('S3.PutObject');
  });

  test('should not prefix an error that different SDK API calls share', () => {
    const error = new Error('Could not load credentials from any providers');
    recordSdkApiCall(error, 'CloudFormation.DescribeStacks');
    recordSdkApiCall(error, 'S3.PutObject');
    recordSdkApiCall(error, 'CloudFormation.DescribeStacks');
    expect(sdkApiCallOf(error)).toBeUndefined();
    expect(formatErrorMessage(error)).toBe('Could not load credentials from any providers');
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
