import type * as cxapi from '@aws-cdk/cx-api';
import type { DescribeStackResourceDriftsCommandOutput, StackResourceDrift } from '@aws-sdk/client-cloudformation';
import {
  DescribeStackDriftDetectionStatusCommand,
  DescribeStackResourceDriftsCommand,
  DetectStackDriftCommand,
  DetectStackResourceDriftCommand,
} from '@aws-sdk/client-cloudformation';
import { detectStackDrift, DriftFormatter } from '../../../lib/api/drift';
import { IoHelper, IoDefaultMessages } from '../../../lib/api/io/private';
import { ToolkitError } from '../../../lib/toolkit/toolkit-error';
import { mockCloudFormationClient, MockSdk } from '../../_helpers/mock-sdk';

jest.mock('../../../lib/api/io/private', () => {
  const originalModule = jest.requireActual('../../../lib/api/io/private');
  return {
    ...originalModule,
    IO: {
      ...originalModule.IO,
      DEFAULT_TOOLKIT_DEBUG: {
        msg: jest.fn().mockReturnValue('mocked-message'),
      },
    },
    IoDefaultMessages: jest.fn(),
  };
});

describe('CloudFormation drift commands', () => {
  let sdk: MockSdk;

  beforeEach(() => {
    jest.resetAllMocks();
    sdk = new MockSdk();
  });

  test('detectStackDrift sends the correct command', async () => {
    // GIVEN
    const cfnClient = mockCloudFormationClient;
    cfnClient.on(DetectStackDriftCommand).resolves({
      StackDriftDetectionId: 'drift-detection-id',
    });

    // WHEN
    await sdk.cloudFormation().detectStackDrift({
      StackName: 'test-stack',
    });

    // THEN
    expect(cfnClient).toHaveReceivedCommandWith(DetectStackDriftCommand, {
      StackName: 'test-stack',
    });
  });

  test('describeStackDriftDetectionStatus sends the correct command', async () => {
    // GIVEN
    const cfnClient = mockCloudFormationClient;
    cfnClient.on(DescribeStackDriftDetectionStatusCommand).resolves({
      StackId: 'stack-id',
      StackDriftDetectionId: 'drift-detection-id',
      DetectionStatus: 'DETECTION_COMPLETE',
    });

    // WHEN
    await sdk.cloudFormation().describeStackDriftDetectionStatus({
      StackDriftDetectionId: 'drift-detection-id',
    });

    // THEN
    expect(cfnClient).toHaveReceivedCommandWith(DescribeStackDriftDetectionStatusCommand, {
      StackDriftDetectionId: 'drift-detection-id',
    });
  });

  test('describeStackResourceDrifts sends the correct command', async () => {
    // GIVEN
    const cfnClient = mockCloudFormationClient;
    cfnClient.on(DescribeStackResourceDriftsCommand).resolves({
      StackResourceDrifts: [
        {
          StackId: 'stack-id',
          LogicalResourceId: 'resource-id',
          PhysicalResourceId: 'physical-id',
          ResourceType: 'AWS::S3::Bucket',
          ExpectedProperties: '{}',
          ActualProperties: '{}',
          PropertyDifferences: [],
          StackResourceDriftStatus: 'IN_SYNC',
          Timestamp: new Date(),
        },
      ],
    });

    // WHEN
    await sdk.cloudFormation().describeStackResourceDrifts({
      StackName: 'test-stack',
    });

    // THEN
    expect(cfnClient).toHaveReceivedCommandWith(DescribeStackResourceDriftsCommand, {
      StackName: 'test-stack',
    });
  });

  test('detectStackResourceDrift sends the correct command', async () => {
    // GIVEN
    const cfnClient = mockCloudFormationClient;
    cfnClient.on(DetectStackResourceDriftCommand).resolves({
      StackResourceDrift: {
        StackId: 'stack-id',
        LogicalResourceId: 'resource-id',
        PhysicalResourceId: 'physical-id',
        ResourceType: 'AWS::S3::Bucket',
        ExpectedProperties: '{}',
        ActualProperties: '{}',
        PropertyDifferences: [],
        StackResourceDriftStatus: 'IN_SYNC',
        Timestamp: new Date(),
      },
    });

    // WHEN
    await sdk.cloudFormation().detectStackResourceDrift({
      StackName: 'test-stack',
      LogicalResourceId: 'resource-id',
    });

    // THEN
    expect(cfnClient).toHaveReceivedCommandWith(DetectStackResourceDriftCommand, {
      StackName: 'test-stack',
      LogicalResourceId: 'resource-id',
    });
  });
});

describe('detectStackDrift', () => {
  let mockCfn: any;
  let mockIoHelper: any;

  beforeEach(() => {
    mockCfn = {
      detectStackDrift: jest.fn(),
      describeStackDriftDetectionStatus: jest.fn(),
      describeStackResourceDrifts: jest.fn(),
    };

    mockIoHelper = {
      notify: jest.fn().mockResolvedValue(undefined),
    };
  });

  test('successfully detects drift and returns results', async () => {
    // GIVEN
    const stackName = 'test-stack';
    const driftDetectionId = 'drift-detection-id';
    const expectedDriftResults = { StackResourceDrifts: [], $metadata: {} };

    mockCfn.detectStackDrift.mockResolvedValue({ StackDriftDetectionId: driftDetectionId });
    mockCfn.describeStackDriftDetectionStatus.mockResolvedValue({
      DetectionStatus: 'DETECTION_COMPLETE',
    });
    mockCfn.describeStackResourceDrifts.mockResolvedValue(expectedDriftResults);

    // WHEN
    const result = await detectStackDrift(mockCfn, mockIoHelper, stackName);

    // THEN
    expect(mockCfn.detectStackDrift).toHaveBeenCalledWith({ StackName: stackName });
    expect(mockCfn.describeStackDriftDetectionStatus).toHaveBeenCalledWith({
      StackDriftDetectionId: driftDetectionId,
    });
    expect(mockCfn.describeStackResourceDrifts).toHaveBeenCalledWith({ StackName: stackName });
    expect(result).toBe(expectedDriftResults);
  });

  test('throws error when drift detection takes too long', async () => {
    // GIVEN
    const stackName = 'test-stack';
    const driftDetectionId = 'drift-detection-id';

    mockCfn.detectStackDrift.mockResolvedValue({ StackDriftDetectionId: driftDetectionId });

    // Mock the describeStackDriftDetectionStatus to always return DETECTION_IN_PROGRESS
    let callCount = 0;
    mockCfn.describeStackDriftDetectionStatus.mockImplementation(() => {
      callCount++;
      // After a few calls, simulate a timeout by returning a status that will trigger the timeout check
      return Promise.resolve({
        DetectionStatus: 'DETECTION_IN_PROGRESS',
      });
    });

    // Mock Date.now to simulate timeout
    const originalDateNow = Date.now;
    const mockDateNow = jest.fn()
      .mockReturnValueOnce(1000) // First call - start time
      .mockReturnValue(999999); // Subsequent calls - after timeout
    Date.now = mockDateNow;

    // WHEN & THEN
    await expect(detectStackDrift(mockCfn, mockIoHelper, stackName))
      .rejects.toThrow(ToolkitError);

    // Restore original Date.now
    Date.now = originalDateNow;
  });

  test('sends periodic check-in notifications during long-running drift detection', async () => {
    // GIVEN
    const stackName = 'test-stack';
    const driftDetectionId = 'drift-detection-id';
    const expectedDriftResults = { StackResourceDrifts: [], $metadata: {} };

    mockCfn.detectStackDrift.mockResolvedValue({ StackDriftDetectionId: driftDetectionId });

    // Mock Date.now to simulate time progression
    const originalDateNow = Date.now;
    const mockDateNow = jest.fn();

    const startTime = 1000;
    const timeBetweenOutputs = 10_000;

    mockDateNow
      .mockReturnValueOnce(startTime) // Initial call
      .mockReturnValueOnce(startTime + 5000) // First check - before checkIn
      .mockReturnValueOnce(startTime + timeBetweenOutputs + 1000) // Second check - after checkIn
      .mockReturnValueOnce(startTime + timeBetweenOutputs + 5000) // Third check - before next checkIn
      .mockReturnValueOnce(startTime + timeBetweenOutputs + 6000); // Fourth check - still before next checkIn

    Date.now = mockDateNow;

    // First three calls return IN_PROGRESS, fourth call returns COMPLETE
    mockCfn.describeStackDriftDetectionStatus
      .mockResolvedValueOnce({ DetectionStatus: 'DETECTION_IN_PROGRESS' })
      .mockResolvedValueOnce({ DetectionStatus: 'DETECTION_IN_PROGRESS' })
      .mockResolvedValueOnce({ DetectionStatus: 'DETECTION_IN_PROGRESS' })
      .mockResolvedValueOnce({ DetectionStatus: 'DETECTION_COMPLETE' });

    mockCfn.describeStackResourceDrifts.mockResolvedValue(expectedDriftResults);

    // WHEN
    await detectStackDrift(mockCfn, mockIoHelper, stackName);

    // THEN
    expect(mockIoHelper.notify).toHaveBeenCalled();

    // Verify that notify was called at least 3 times (initial, progress, and completion)
    expect(mockIoHelper.notify.mock.calls.length).toBeGreaterThanOrEqual(3);

    // Restore original Date.now
    Date.now = originalDateNow;
  });

  test('throws error when detection status is DETECTION_FAILED', async () => {
    // GIVEN
    const stackName = 'test-stack';
    const driftDetectionId = 'drift-detection-id';
    const failureReason = 'Something went wrong';

    mockCfn.detectStackDrift.mockResolvedValue({ StackDriftDetectionId: driftDetectionId });
    mockCfn.describeStackDriftDetectionStatus.mockResolvedValue({
      DetectionStatus: 'DETECTION_FAILED',
      DetectionStatusReason: failureReason,
    });

    // WHEN & THEN
    await expect(detectStackDrift(mockCfn, mockIoHelper, stackName))
      .rejects.toThrow(`Drift detection failed: ${failureReason}`);
  });

  test('throws error when detection fails', async () => {
    // GIVEN
    const stackName = 'test-stack';
    const driftDetectionId = 'test-detection-id';
    const failureReason = 'Some failure reason';

    mockCfn.detectStackDrift.mockResolvedValue({
      StackDriftDetectionId: driftDetectionId,
    });

    mockCfn.describeStackDriftDetectionStatus.mockResolvedValue({
      DetectionStatus: 'DETECTION_FAILED',
      DetectionStatusReason: failureReason,
    });

    // WHEN & THEN
    await expect(detectStackDrift(mockCfn, mockIoHelper, stackName))
      .rejects.toThrow(`Drift detection failed: ${failureReason}`);
  });
});

describe('formatStackDrift', () => {
  let mockIoHelper: IoHelper;
  let mockNewTemplate: cxapi.CloudFormationStackArtifact;
  let mockIoDefaultMessages: any;

  beforeEach(() => {
    const mockNotify = jest.fn().mockResolvedValue(undefined);
    const mockRequestResponse = jest.fn().mockResolvedValue(undefined);

    mockIoHelper = IoHelper.fromIoHost(
      { notify: mockNotify, requestResponse: mockRequestResponse },
      'diff',
    );

    mockIoDefaultMessages = {
      info: jest.fn(),
      warning: jest.fn(),
      error: jest.fn(),
    };

    jest.spyOn(mockIoHelper, 'notify').mockImplementation(() => Promise.resolve());
    jest.spyOn(mockIoHelper, 'requestResponse').mockImplementation(() => Promise.resolve());

    (IoDefaultMessages as jest.Mock).mockImplementation(() => mockIoDefaultMessages);

    mockNewTemplate = {
      template: {
        Resources: {
          Func: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Code: {
                S3Bucket: 'BuckChuckets',
                S3Key: 'some-key',
              },
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
              Description: 'Some description',
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;
  });

  test('detects drift', () => {
    // GIVEN
    const mockDriftedResources: DescribeStackResourceDriftsCommandOutput = {
      StackResourceDrifts: [{
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'GiveUpTheFunc',
        PhysicalResourceId: 'gotta-have-that-func',
        ResourceType: 'AWS::Lambda::Function',
        PropertyDifferences: [{
          PropertyPath: '/Description',
          ExpectedValue: 'Some description',
          ActualValue: 'Tear the Roof Off the Sucker',
          DifferenceType: 'NOT_EQUAL',
        }],
        Timestamp: new Date(2024, 5, 6, 9, 0, 0),
      }],
      $metadata: {},
    };

    // WHEN
    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockNewTemplate,
      driftResults: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(1);
    const expectedStringsInOutput = [
      'Modified Resources',
      'AWS::Lambda::Function',
      'GiveUpTheFunc',
      'Description',
      'Some description',
      'Tear the Roof Off the Sucker',
      '1 resource has drifted',
    ];
    for (const expectedStringInOutput of expectedStringsInOutput) {
      expect(result.formattedDrift).toContain(expectedStringInOutput);
    }
  });

  test('detects multiple drifts', () => {
    // GIVEN
    const mockDriftedResources: DescribeStackResourceDriftsCommandOutput = {
      StackResourceDrifts: [{
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'MyVpc',
        PhysicalResourceId: 'MyVpc',
        ResourceType: 'AWS::EC2::VPC',
        PropertyDifferences: [{
          PropertyPath: '/CidrBlock',
          ExpectedValue: '10.0.0.0/16',
          ActualValue: '10.0.0.1/16',
          DifferenceType: 'NOT_EQUAL',
        }],
        Timestamp: new Date(2024, 5, 3, 13, 0, 0),
      },
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'DELETED',
        LogicalResourceId: 'SomeRoute',
        PhysicalResourceId: 'SomeRoute',
        ResourceType: 'AWS::EC2::Route',
        Timestamp: new Date(2024, 11, 24, 19, 0, 0),
      }],
      $metadata: {},
    };

    // WHEN
    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockNewTemplate,
      driftResults: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(2);
    const expectedStringsInOutput = [
      'Modified Resources',
      'AWS::EC2::VPC',
      'MyVpc',
      'CidrBlock',
      '10.0.0.0/16',
      '10.0.0.1/16',
      'AWS::EC2::Route',
      'SomeRoute',
      '2 resources have drifted',
    ];
    for (const expectedStringInOutput of expectedStringsInOutput) {
      expect(result.formattedDrift).toContain(expectedStringInOutput);
    }
  });

  test('no drift detected', () => {
    // GIVEN
    const mockDriftResults: DescribeStackResourceDriftsCommandOutput = {
      StackResourceDrifts: [],
      $metadata: {},
    };

    // WHEN
    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockNewTemplate,
      driftResults: mockDriftResults,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(0);
    expect(result.formattedDrift).toContain('No drift detected');
  });

  test('if detect drift is false, no output', () => {
    // WHEN
    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockNewTemplate,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBeUndefined();
    expect(result.formattedDrift).toContain('No drift results available');
  });

  test('formatting with verbose should show unchecked resources', () => {
    // GIVEN
    const allStackResources = new Map<string, string>([
      ['SomeID', 'AWS::Lambda::Function'],
      ['AnotherID', 'AWS::Lambda::Function'],
      ['OneMoreID', 'AWS::Lambda::Function'],
    ]);
    const mockDriftedResources: DescribeStackResourceDriftsCommandOutput = {
      StackResourceDrifts: [{
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'SomeID',
        ResourceType: 'AWS::Lambda::Function',
        PropertyDifferences: [{
          PropertyPath: '/Description',
          ExpectedValue: 'Understand Understand',
          ActualValue: 'The Concept of Love',
          DifferenceType: 'NOT_EQUAL',
        }],
        Timestamp: new Date(2025, 10, 10, 0, 0, 0),
      },
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'IN_SYNC',
        LogicalResourceId: 'OneMoreID',
        ResourceType: 'AWS::Lambda::Function',
        Timestamp: new Date(2025, 10, 10, 0, 0, 0),
      }],
      $metadata: {},
    };

    // WHEN
    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockNewTemplate,
      driftResults: mockDriftedResources,
      allStackResources: allStackResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.formattedDrift).toContain('1 resource has drifted');

    expect(result.formattedDrift).toContain('Resources In Sync');
    expect(result.formattedDrift).toContain('Unchecked Resources');
  });

  test('formatting with different drift statuses', () => {
    // GIVEN
    const mockDriftedResources: DescribeStackResourceDriftsCommandOutput = {
      StackResourceDrifts: [
        {
          StackId: 'some:stack:arn',
          StackResourceDriftStatus: 'MODIFIED',
          LogicalResourceId: 'Resource1',
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
        {
          StackId: 'some:stack:arn',
          StackResourceDriftStatus: 'DELETED',
          LogicalResourceId: 'Resource2',
          PhysicalResourceId: 'physical-id-2',
          ResourceType: 'AWS::IAM::Role',
          Timestamp: new Date(Date.now()),
        },
        {
          StackId: 'some:stack:arn',
          StackResourceDriftStatus: 'IN_SYNC',
          LogicalResourceId: 'Resource3',
          PhysicalResourceId: 'physical-id-3',
          ResourceType: 'AWS::Lambda::Function',
          Timestamp: new Date(Date.now()),
        },
        {
          StackId: 'some:stack:arn',
          StackResourceDriftStatus: 'NOT_CHECKED',
          LogicalResourceId: 'Resource4',
          PhysicalResourceId: 'physical-id-4',
          ResourceType: 'AWS::DynamoDB::Table',
          Timestamp: new Date(Date.now()),
        },
      ],
      $metadata: {},
    };

    // WHEN
    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockNewTemplate,
      driftResults: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(2); // Only MODIFIED and DELETED count as drift
    expect(result.formattedDrift).toContain('Modified Resources');
    expect(result.formattedDrift).toContain('AWS::S3::Bucket');
    expect(result.formattedDrift).toContain('Resource1');
    expect(result.formattedDrift).toContain('Deleted Resources');
    expect(result.formattedDrift).toContain('AWS::IAM::Role');
    expect(result.formattedDrift).toContain('Resource2');
    expect(result.formattedDrift).toContain('2 resources have drifted');
  });

  test('with no drifts and verbose option', () => {
    const mockStack = {
      stackName: 'test-stack',
      // Add this method to fix the error
      findMetadataByType: jest.fn().mockReturnValue([]),
    } as unknown as cxapi.CloudFormationStackArtifact;
    const mockDriftedResources = {
      StackResourceDrifts: [{
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'IN_SYNC',
        LogicalResourceId: 'SomeID',
        ResourceType: 'AWS::Lambda::Function',
        Timestamp: new Date(2025, 4, 20, 0, 0, 0),
      } as StackResourceDrift],
      $metadata: {},
    } as DescribeStackResourceDriftsCommandOutput;

    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockStack,
      driftResults: mockDriftedResources,
    });

    const result = formatter.formatStackDrift();

    // Verify the output contains the stack name and "No drift detected"
    // expect(result.formattedDrift).toContain('test-stack'); // I'm commenting this out for now to just remove the flags, I'll re-enable it when I change the logging so it shows in debug level. Someone hold me to account in case I forget to un-comment this check because there is a non-zero chance that happens lmao
    expect(result.formattedDrift).toContain('No drift detected');
    expect(result.numResourcesWithDrift).toBe(0);
  });

  test('uses logical ID to path mapping for formatting', () => {
    const mockStack = {
      stackName: 'test-stack',
      findMetadataByType: jest.fn().mockReturnValue([
        { data: 'LogicalId1', path: 'path/to/resource1' },
      ]),
    } as unknown as cxapi.CloudFormationStackArtifact;

    const mockDriftResults = {
      StackResourceDrifts: [{
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'LogicalId1', // This matches one of the logical IDs in the metadata
        ResourceType: 'AWS::Lambda::Function',
        PropertyDifferences: [{
          PropertyPath: '/Description',
          ExpectedValue: 'Expected',
          ActualValue: 'Actual',
          DifferenceType: 'NOT_EQUAL',
        }],
        Timestamp: new Date(),
      }] as StackResourceDrift[],
      $metadata: {},
    } as DescribeStackResourceDriftsCommandOutput;

    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockStack,
      driftResults: mockDriftResults,
    });

    const result = formatter.formatStackDrift();

    // The path might be formatted differently in the output
    // Let's check for parts of the path instead
    expect(result.formattedDrift).toContain('to/resource1');
  });
});
