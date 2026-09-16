import { DescribeStackDriftDetectionStatusCommand, DescribeStackResourceDriftsCommand, DetectStackDriftCommand } from '@aws-sdk/client-cloudformation';
import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, TestIoHost } from '../_helpers';
import { mockCloudFormationClient, mockSdkProvider, restoreSdkMocksToDefault, setDefaultSTSMocks } from '../_helpers/mock-sdk';

let ioHost: TestIoHost;
let toolkit: Toolkit;

beforeEach(() => {
  jest.restoreAllMocks();
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();
  ioHost = new TestIoHost('info', true);
  toolkit = new Toolkit({ ioHost });

  // Some default implementations
  // Keep the real SdkProvider hermetic and avoid resolving ambient credentials.
  mockSdkProvider();
});

describe('drift', () => {
  test('if no drift is returned, warn user', async () => {
    // GIVEN
    mockCloudFormationClient.on(DetectStackDriftCommand).resolves({ StackDriftDetectionId: '12345' });
    mockCloudFormationClient.on(DescribeStackDriftDetectionStatusCommand).resolves({ DetectionStatus: 'DETECTION_COMPLETE' });
    mockCloudFormationClient.on(DescribeStackResourceDriftsCommand).resolvesOnce({});

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.drift(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(Object.keys(result).length).toBe(0);
    ioHost.expectMessage({ containing: 'No drift results available', level: 'warn' });
  });

  test('returns stack drift and ignores metadata resource', async () => {
    // GIVEN
    mockCloudFormationClient.on(DetectStackDriftCommand).resolves({ StackDriftDetectionId: '12345' });
    mockCloudFormationClient.on(DescribeStackDriftDetectionStatusCommand).resolves({ DetectionStatus: 'DETECTION_COMPLETE' });
    mockCloudFormationClient.on(DescribeStackResourceDriftsCommand).resolvesOnce({
      StackResourceDrifts: [
        {
          StackId: 'some:stack:arn',
          StackResourceDriftStatus: 'MODIFIED',
          LogicalResourceId: 'MyBucketF68F3FF0',
          PhysicalResourceId: 'physical-id-1',
          ResourceType: 'AWS::S3::Bucket',
          PropertyDifferences: [{
            PropertyPath: '/BucketName',
            ExpectedValue: 'expected-name',
            ActualValue: 'actual-name',
            DifferenceType: 'NOT_EQUAL',
          }],
          Timestamp: new Date(Date.now()),
        },
      ],
    });

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.drift(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(result).toHaveProperty('Stack1');
    expect(result.Stack1.numResourcesWithDrift).toBe(1);
    expect(result.Stack1.numResourcesUnchecked).toBe(0);
    ioHost.expectMessage({ containing: 'Modified Resources', level: 'info' });
    ioHost.expectMessage({ containing: '[~] AWS::S3::Bucket MyBucket MyBucketF68F3FF0', level: 'info' });
  });

  test('can invoke drift action without options', async () => {
    // GIVEN
    mockCloudFormationClient.on(DetectStackDriftCommand).resolves({ StackDriftDetectionId: '12345' });
    mockCloudFormationClient.on(DescribeStackDriftDetectionStatusCommand).resolves({ DetectionStatus: 'DETECTION_COMPLETE' });
    mockCloudFormationClient.on(DescribeStackResourceDriftsCommand).resolvesOnce({});

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.drift(cx);

    // THEN
    expect(Object.keys(result).length).toBe(0);
    ioHost.expectMessage({ containing: 'No drift results available' });
  });

  test('resources without a drift record are reported as unchecked in the summary', async () => {
    // GIVEN - drift detection completes, but CloudFormation returns no drift
    // record for the bucket (e.g. the resource type does not support drift
    // detection)
    mockCloudFormationClient.on(DetectStackDriftCommand).resolves({ StackDriftDetectionId: '12345' });
    mockCloudFormationClient.on(DescribeStackDriftDetectionStatusCommand).resolves({ DetectionStatus: 'DETECTION_COMPLETE' });
    mockCloudFormationClient.on(DescribeStackResourceDriftsCommand).resolvesOnce({
      StackResourceDrifts: [],
    });

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.drift(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(result.Stack1.numResourcesWithDrift).toBe(0);
    expect(result.Stack1.numResourcesUnchecked).toBe(1);
    // the final tally includes the unchecked count
    ioHost.expectMessage({ containing: 'Number of resources with drift: 0 (1 unchecked)' });
  });

  test('summary has no unchecked suffix when all resources were checked', async () => {
    // GIVEN - every resource has a drift record
    mockCloudFormationClient.on(DetectStackDriftCommand).resolves({ StackDriftDetectionId: '12345' });
    mockCloudFormationClient.on(DescribeStackDriftDetectionStatusCommand).resolves({ DetectionStatus: 'DETECTION_COMPLETE' });
    mockCloudFormationClient.on(DescribeStackResourceDriftsCommand).resolvesOnce({
      StackResourceDrifts: [
        {
          StackId: 'some:stack:arn',
          StackResourceDriftStatus: 'IN_SYNC',
          LogicalResourceId: 'MyBucketF68F3FF0',
          PhysicalResourceId: 'physical-id-1',
          ResourceType: 'AWS::S3::Bucket',
          Timestamp: new Date(Date.now()),
        },
      ],
    });

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.drift(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(result.Stack1.numResourcesWithDrift).toBe(0);
    expect(result.Stack1.numResourcesUnchecked).toBe(0);
    ioHost.expectMessage({ containing: 'Number of resources with drift: 0' });
    expect(() => ioHost.expectMessage({ containing: 'unchecked' })).toThrow();
  });
});
