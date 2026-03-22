/**
 * Additional tests for lazy-list-stack-resources.test.ts
 * Append these test cases to the existing describe block.
 */
import 'aws-sdk-client-mock-jest';

import { ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { LazyListStackResources } from '../../../lib/api/cloudformation';
import { MockSdk, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';

describe('Lazy ListStackResources', () => {
  beforeEach(() => {
    restoreSdkMocksToDefault();
  });

  test('correctly caches calls to the CloudFormation API', async () => {
    // GIVEN
    const mockSdk = new MockSdk();
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [],
      NextToken: undefined,
    });
    const res = new LazyListStackResources(mockSdk, 'StackName');

    // WHEN
    void res.listStackResources();
    void res.listStackResources();
    void res.listStackResources();
    const result = await res.listStackResources();

    // THEN
    expect(result.length).toBe(0);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ListStackResourcesCommand, 1);
  });

  test('returns empty array when stack does not exist (SDK v3 ValidationError format)', async () => {
    // GIVEN — SDK v3 3.993.0+ throws Error with message "ValidationError"
    // when ListStackResources is called on a non-existent stack
    const error = Object.assign(new Error('ValidationError'), {
      name: 'Error',
      Code: 'ValidationError',
      $metadata: { httpStatusCode: 400 },
    });
    mockCloudFormationClient.on(ListStackResourcesCommand).rejects(error);
    const mockSdk = new MockSdk();
    const res = new LazyListStackResources(mockSdk, 'NonExistentStack');

    // WHEN
    const result = await res.listStackResources();

    // THEN
    expect(result).toEqual([]);
  });

  test('returns empty array when stack does not exist (SDK v2 ValidationError format)', async () => {
    // GIVEN — older SDK format with name="ValidationError"
    const error = new Error('Stack with id NonExistentStack does not exist');
    error.name = 'ValidationError';
    mockCloudFormationClient.on(ListStackResourcesCommand).rejects(error);
    const mockSdk = new MockSdk();
    const res = new LazyListStackResources(mockSdk, 'NonExistentStack');

    // WHEN
    const result = await res.listStackResources();

    // THEN
    expect(result).toEqual([]);
  });

  test('throws for non-ValidationError exceptions from ListStackResources', async () => {
    // GIVEN
    const error = new Error('Rate exceeded');
    error.name = 'Throttling';
    mockCloudFormationClient.on(ListStackResourcesCommand).rejects(error);
    const mockSdk = new MockSdk();
    const res = new LazyListStackResources(mockSdk, 'StackName');

    // WHEN / THEN
    await expect(res.listStackResources()).rejects.toThrow('Rate exceeded');
  });

  test('caches the empty result for non-existent stacks', async () => {
    // GIVEN — SDK v3 error
    const error = Object.assign(new Error('ValidationError'), {
      name: 'Error',
      Code: 'ValidationError',
    });
    mockCloudFormationClient.on(ListStackResourcesCommand).rejects(error);
    const mockSdk = new MockSdk();
    const res = new LazyListStackResources(mockSdk, 'NonExistentStack');

    // WHEN — call multiple times
    const result1 = await res.listStackResources();
    const result2 = await res.listStackResources();

    // THEN — should only call API once and cache the empty result
    expect(result1).toEqual([]);
    expect(result2).toEqual([]);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ListStackResourcesCommand, 1);
  });
});
