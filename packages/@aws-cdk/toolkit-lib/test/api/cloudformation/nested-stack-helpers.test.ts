import 'aws-sdk-client-mock-jest';

import { ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { LazyListStackResources, loadCurrentTemplate } from '../../../lib/api/cloudformation';
import { MockSdk, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';

/**
 * Since getNestedStackArn is not exported, we test it indirectly through
 * loadNestedStacks / getNestedStackTemplates behavior. However, the core
 * error handling we're fixing can be tested via LazyListStackResources
 * combined with the nested stack helpers.
 *
 * The key scenario: when a parent stack doesn't exist yet, ListStackResources
 * throws ValidationError. The nested-stack-helpers catch block must handle
 * both old (name=ValidationError) and new (Code=ValidationError) SDK formats.
 */
describe('nested-stack-helpers error handling', () => {
  beforeEach(() => {
    restoreSdkMocksToDefault();
  });

  test('handles SDK v2 ValidationError format (message starts with "Stack with id")', async () => {
    // GIVEN — old SDK error format
    const error = new Error('Stack with id my-nested-stack does not exist');
    error.name = 'ValidationError';
    mockCloudFormationClient.on(ListStackResourcesCommand).rejects(error);
    const mockSdk = new MockSdk();
    const res = new LazyListStackResources(mockSdk, 'my-nested-stack');

    // WHEN
    const result = await res.listStackResources();

    // THEN — should return empty array, not throw
    expect(result).toEqual([]);
  });

  test('handles SDK v3 ValidationError format (name=Error, Code=ValidationError)', async () => {
    // GIVEN — new SDK v3 error format
    const error = Object.assign(new Error('ValidationError'), {
      name: 'Error',
      Code: 'ValidationError',
      $metadata: { httpStatusCode: 400 },
    });
    mockCloudFormationClient.on(ListStackResourcesCommand).rejects(error);
    const mockSdk = new MockSdk();
    const res = new LazyListStackResources(mockSdk, 'my-nested-stack');

    // WHEN
    const result = await res.listStackResources();

    // THEN — should return empty array, not throw
    expect(result).toEqual([]);
  });

  test('throws for non-ValidationError exceptions', async () => {
    // GIVEN
    const error = new Error('Access Denied');
    error.name = 'AccessDeniedException';
    mockCloudFormationClient.on(ListStackResourcesCommand).rejects(error);
    const mockSdk = new MockSdk();
    const res = new LazyListStackResources(mockSdk, 'my-nested-stack');

    // WHEN / THEN
    await expect(res.listStackResources()).rejects.toThrow('Access Denied');
  });
});
