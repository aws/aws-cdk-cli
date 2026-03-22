import 'aws-sdk-client-mock-jest';

import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CloudFormationStack } from '../../../lib/api/cloudformation';
import { MockSdk, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';

describe('CloudFormationStack.lookup', () => {
  beforeEach(() => {
    restoreSdkMocksToDefault();
  });

  test('returns existing stack when DescribeStacks succeeds', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'my-stack',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    });
    const mockSdk = new MockSdk();

    // WHEN
    const stack = await CloudFormationStack.lookup(mockSdk.cloudFormation(), 'my-stack');

    // THEN
    expect(stack.exists).toBe(true);
    expect(stack.stackName).toBe('my-stack');
  });

  test('returns non-existent stack for SDK v2 ValidationError format (name=ValidationError)', async () => {
    // GIVEN — SDK v2 / early v3 error format
    const error = new Error('Stack with id my-stack does not exist');
    error.name = 'ValidationError';
    mockCloudFormationClient.on(DescribeStacksCommand).rejects(error);
    const mockSdk = new MockSdk();

    // WHEN
    const stack = await CloudFormationStack.lookup(mockSdk.cloudFormation(), 'my-stack');

    // THEN
    expect(stack.exists).toBe(false);
  });

  test('returns non-existent stack for SDK v3 ValidationError format (name=Error, Code=ValidationError)', async () => {
    // GIVEN — SDK v3 3.993.0+ error format
    // The newer AWS SDK puts "ValidationError" as the message and sets name to "Error"
    const error = Object.assign(new Error('ValidationError'), {
      name: 'Error',
      Code: 'ValidationError',
      $metadata: { httpStatusCode: 400 },
    });
    mockCloudFormationClient.on(DescribeStacksCommand).rejects(error);
    const mockSdk = new MockSdk();

    // WHEN
    const stack = await CloudFormationStack.lookup(mockSdk.cloudFormation(), 'my-stack');

    // THEN
    expect(stack.exists).toBe(false);
  });

  test('returns non-existent stack when error message contains "does not exist"', async () => {
    // GIVEN — any future format where the message includes "does not exist"
    const error = new Error('Stack with id my-stack does not exist');
    error.name = 'SomeOtherErrorName';
    mockCloudFormationClient.on(DescribeStacksCommand).rejects(error);
    const mockSdk = new MockSdk();

    // WHEN
    const stack = await CloudFormationStack.lookup(mockSdk.cloudFormation(), 'my-stack');

    // THEN
    expect(stack.exists).toBe(false);
  });

  test('throws for non-ValidationError exceptions', async () => {
    // GIVEN
    const error = new Error('Access Denied');
    error.name = 'AccessDeniedException';
    mockCloudFormationClient.on(DescribeStacksCommand).rejects(error);
    const mockSdk = new MockSdk();

    // WHEN / THEN
    await expect(CloudFormationStack.lookup(mockSdk.cloudFormation(), 'my-stack')).rejects.toThrow('Access Denied');
  });
});
