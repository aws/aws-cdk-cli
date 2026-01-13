import { DescribeStackDriftDetectionStatusCommand, DescribeStackResourceDriftsCommand, DetectStackDriftCommand } from '@aws-sdk/client-cloudformation';
import * as awsauth from '../../lib/api/aws-auth/private';
import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, TestIoHost } from '../_helpers';
import { mockCloudFormationClient, MockSdk, restoreSdkMocksToDefault, setDefaultSTSMocks } from '../_helpers/mock-sdk';

let ioHost: TestIoHost;
let toolkit: Toolkit;

beforeEach(() => {
  jest.restoreAllMocks();
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();
  ioHost = new TestIoHost('info', true);
  toolkit = new Toolkit({ ioHost });

  // Some default implementations
  jest.spyOn(awsauth.SdkProvider.prototype, '_makeSdk').mockReturnValue(new MockSdk());
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
});
