import * as deployments from '../../lib/api/deployments';
import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, TestIoHost } from '../_helpers';

let ioHost: TestIoHost;
let toolkit: Toolkit;

beforeEach(() => {
  jest.restoreAllMocks();
  ioHost = new TestIoHost('info', true);
  toolkit = new Toolkit({ ioHost });

  // Mock deployments methods for asset operations
  jest.spyOn(deployments.Deployments.prototype, 'resolveEnvironment').mockResolvedValue({
    account: '11111111',
    region: 'us-east-1',
    name: 'aws://11111111/us-east-1',
  });
  jest.spyOn(deployments.Deployments.prototype, 'isSingleAssetPublished').mockResolvedValue(false);
  jest.spyOn(deployments.Deployments.prototype, 'buildSingleAsset').mockImplementation();
  jest.spyOn(deployments.Deployments.prototype, 'publishSingleAsset').mockImplementation();
});

describe('publish', () => {
  test('publishes assets for a single stack', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-asset');
    const result = await toolkit.publish(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(result.success).toBe(true);
    expect(result.stackCount).toBe(1);
    expect(result.synthesisTime).toBeGreaterThan(0);
    ioHost.expectMessage({ containing: 'Publishing assets for 1 stack(s)', level: 'info' });
    ioHost.expectMessage({ containing: 'Assets published successfully', level: 'info' });
  });

  test('publishes assets for multiple stacks', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-different-stacks');
    const result = await toolkit.publish(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(result.success).toBe(true);
    expect(result.stackCount).toBeGreaterThanOrEqual(1);
    ioHost.expectMessage({ containing: 'Assets published successfully', level: 'info' });
  });

  test('returns error when no stacks are selected', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-asset');
    const result = await toolkit.publish(cx, {
      stacks: { patterns: ['NonExistentStack'], strategy: StackSelectionStrategy.PATTERN_MATCH },
    });

    // THEN
    expect(result.success).toBe(false);
    expect(result.stackCount).toBe(0);
    ioHost.expectMessage({ containing: 'No stacks selected', level: 'error' });
  });

  test('can invoke publish action without options', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-asset');
    const result = await toolkit.publish(cx);

    // THEN
    expect(result.success).toBe(true);
    ioHost.expectMessage({ containing: 'Assets published successfully', level: 'info' });
  });

  test('respects force option', async () => {
    // WHEN - publish with force
    const cx = await builderFixture(toolkit, 'stack-with-asset');
    const result = await toolkit.publish(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      force: true,
    });

    // THEN
    expect(result.success).toBe(true);
    ioHost.expectMessage({ containing: 'Assets published successfully', level: 'info' });
  });

  test('skips already published assets when force is false', async () => {
    // Mock that asset is already published
    jest.spyOn(deployments.Deployments.prototype, 'isSingleAssetPublished').mockResolvedValue(true);

    // WHEN - publish without force
    const cx = await builderFixture(toolkit, 'stack-with-asset');
    const result = await toolkit.publish(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      force: false,
    });

    // THEN
    expect(result.success).toBe(true);
    ioHost.expectMessage({ containing: 'Assets published successfully', level: 'info' });
  });
});
