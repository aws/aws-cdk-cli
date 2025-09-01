import type * as cxapi from '@aws-cdk/cx-api';
import type { DescribeStackResourceDriftsCommandOutput, StackResourceDrift } from '@aws-sdk/client-cloudformation';
import {
  DescribeStackDriftDetectionStatusCommand,
  DescribeStackResourceDriftsCommand,
  DetectStackDriftCommand,
  DetectStackResourceDriftCommand,
} from '@aws-sdk/client-cloudformation';
import { detectStackDrift, DriftFormatter } from '../../../lib/api/drift';
import { ToolkitError } from '../../../lib/toolkit/toolkit-error';
import { mockCloudFormationClient, MockSdk } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

let ioHost = new TestIoHost();
let ioHelper = ioHost.asHelper('deploy');

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

  beforeEach(() => {
    jest.resetAllMocks();
    ioHost = new TestIoHost();
    // Set level to trace to capture all messages
    ioHost.level = 'trace';
    ioHelper = ioHost.asHelper('drift');
    mockCfn = {
      detectStackDrift: jest.fn(),
      describeStackDriftDetectionStatus: jest.fn(),
      describeStackResourceDrifts: jest.fn(),
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
      StackDriftStatus: 'IN_SYNC',
    });
    mockCfn.describeStackResourceDrifts.mockResolvedValue(expectedDriftResults);

    // WHEN
    const result = await detectStackDrift(mockCfn, ioHelper, stackName);

    // THEN
    expect(mockCfn.detectStackDrift).toHaveBeenCalledWith({ StackName: stackName });
    expect(mockCfn.describeStackDriftDetectionStatus).toHaveBeenCalledWith({
      StackDriftDetectionId: driftDetectionId,
    });
    expect(mockCfn.describeStackResourceDrifts).toHaveBeenCalledWith({ StackName: stackName });
    expect(result).toBe(expectedDriftResults);
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Detecting drift'),
      level: 'trace',
    }));
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
    await expect(detectStackDrift(mockCfn, ioHelper, stackName))
      .rejects.toThrow(ToolkitError);

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Detecting drift'),
      level: 'trace',
    }));

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
      .mockResolvedValueOnce({ DetectionStatus: 'DETECTION_COMPLETE', StackDriftStatus: 'IN_SYNC' });

    mockCfn.describeStackResourceDrifts.mockResolvedValue(expectedDriftResults);

    // WHEN
    await detectStackDrift(mockCfn, ioHelper, stackName);

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Detecting drift'),
      level: 'trace',
    }));

    // Restore original Date.now
    Date.now = originalDateNow;
  }, 15_000);

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
    await expect(detectStackDrift(mockCfn, ioHelper, stackName))
      .rejects.toThrow(`Drift detection failed: ${failureReason}`);

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Detecting drift'),
      level: 'trace',
    }));
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
    await expect(detectStackDrift(mockCfn, ioHelper, stackName))
      .rejects.toThrow(`Drift detection failed: ${failureReason}`);

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Detecting drift'),
      level: 'trace',
    }));
  });

  test('handles UNKNOWN stack drift status', async () => {
    // GIVEN
    const stackName = 'test-stack';
    const driftDetectionId = 'test-detection-id';
    const statusReason = 'Unable to check drift for some resources';
    const expectedDriftResults = { StackResourceDrifts: [], $metadata: {} };

    mockCfn.detectStackDrift.mockResolvedValue({
      StackDriftDetectionId: driftDetectionId,
    });

    mockCfn.describeStackDriftDetectionStatus.mockResolvedValue({
      DetectionStatus: 'DETECTION_COMPLETE',
      StackDriftStatus: 'UNKNOWN',
      DetectionStatusReason: statusReason,
    });

    mockCfn.describeStackResourceDrifts.mockResolvedValue(expectedDriftResults);

    // WHEN
    await detectStackDrift(mockCfn, ioHelper, stackName);

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Stack drift status is UNKNOWN'),
      level: 'trace',
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining(statusReason),
      level: 'trace',
    }));
  });

  test('handles resources with UNKNOWN drift status', async () => {
    // GIVEN
    const stackName = 'test-stack';
    const driftDetectionId = 'test-detection-id';
    const driftStatusReason = 'Insufficient permissions to check drift';
    const expectedDriftResults = {
      StackResourceDrifts: [
        {
          StackId: 'stack-id',
          LogicalResourceId: 'MyResource1',
          ResourceType: 'AWS::S3::Bucket',
          StackResourceDriftStatus: 'UNKNOWN',
          DriftStatusReason: driftStatusReason,
          Timestamp: new Date(),
        },
      ],
      $metadata: {},
    };

    mockCfn.detectStackDrift.mockResolvedValue({
      StackDriftDetectionId: driftDetectionId,
    });

    mockCfn.describeStackDriftDetectionStatus.mockResolvedValue({
      DetectionStatus: 'DETECTION_COMPLETE',
      StackDriftStatus: 'UNKNOWN',
    });

    mockCfn.describeStackResourceDrifts.mockResolvedValue(expectedDriftResults);

    // WHEN
    await detectStackDrift(mockCfn, ioHelper, stackName);

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Some resources have UNKNOWN drift status'),
      level: 'trace',
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('MyResource1'),
      level: 'trace',
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining(driftStatusReason),
      level: 'trace',
    }));
  });

  test('sends periodic check-in message during drift detection wait', async () => {
    // GIVEN
    const stackName = 'test-stack';
    const driftDetectionId = 'drift-detection-id';
    const expectedDriftResults = { StackResourceDrifts: [], $metadata: {} };

    mockCfn.detectStackDrift.mockResolvedValue({ StackDriftDetectionId: driftDetectionId });

    // Mock Date.now to simulate time progression that triggers check-in message
    const originalDateNow = Date.now;
    const startTime = 1000;
    const timeBetweenOutputs = 10_000;

    const mockDateNow = jest.fn()
      .mockReturnValueOnce(startTime) // deadline calculation
      .mockReturnValueOnce(startTime) // checkIn calculation
      .mockReturnValueOnce(startTime + timeBetweenOutputs + 1000) // First status check - after checkIn
      .mockReturnValueOnce(startTime + timeBetweenOutputs + 1000) // deadline check
      .mockReturnValueOnce(startTime + timeBetweenOutputs + 1000) // checkIn comparison - triggers message
      .mockReturnValue(startTime + timeBetweenOutputs + 2000); // All subsequent calls

    Date.now = mockDateNow;

    // First call returns IN_PROGRESS, second call returns COMPLETE
    mockCfn.describeStackDriftDetectionStatus
      .mockResolvedValueOnce({ DetectionStatus: 'DETECTION_IN_PROGRESS' })
      .mockResolvedValueOnce({ DetectionStatus: 'DETECTION_COMPLETE', StackDriftStatus: 'IN_SYNC' });

    mockCfn.describeStackResourceDrifts.mockResolvedValue(expectedDriftResults);

    // WHEN
    await detectStackDrift(mockCfn, ioHelper, stackName);

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Waiting for drift detection to complete...'),
      level: 'trace',
    }));

    // Restore original Date.now
    Date.now = originalDateNow;
  });
});

describe('formatStackDrift', () => {
  let mockNewTemplate: cxapi.CloudFormationStackArtifact;

  // Helper function to create template with metadata
  function createTemplateWithMetadata(resources: Record<string, any>) {
    return {
      template: {
        Resources: {
          ...resources,
          CDKMetadata: {
            Type: 'AWS::CDK::Metadata',
            Properties: {
              Analytics: 'placeholder-string',
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;
  }

  beforeEach(() => {
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
      stack: mockNewTemplate,
      resourceDrifts: mockDriftedResources.StackResourceDrifts!,
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
    ];
    for (const expectedStringInOutput of expectedStringsInOutput) {
      expect(result.modified).toContain(expectedStringInOutput);
    }
    expect(result.summary).toContain('1 resource has drifted');
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
      stack: mockNewTemplate,
      resourceDrifts: mockDriftedResources.StackResourceDrifts!,
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
    ];
    for (const expectedStringInOutput of expectedStringsInOutput) {
      expect(result.modified).toContain(expectedStringInOutput);
    }
    expect(result.deleted).toContain('AWS::EC2::Route');
    expect(result.deleted).toContain('SomeRoute');
    expect(result.summary).toContain('2 resources have drifted');
  });

  test('no drift detected', () => {
    // WHEN
    const formatter = new DriftFormatter({
      stack: mockNewTemplate,
      resourceDrifts: [],
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(0);
    expect(result.summary).toContain('No drift detected');
  });

  test('formatting with verbose should show unchecked resources', () => {
    // GIVEN
    mockNewTemplate = { // we want additional resources to see what was unchecked
      template: {
        Resources: {
          SomeID: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Code: {
                S3Bucket: 'MyBucket',
                S3Key: 'MyKey',
              },
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
              Description: 'Abra',
            },
          },
          AnotherID: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Code: {
                S3Bucket: 'MyOtherBucket',
                S3Key: 'MyOtherKey',
              },
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
              Description: 'Kadabra',
            },
          },
          OneMoreID: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Code: {
                S3Bucket: 'YetAnotherBucket',
                S3Key: 'YetAnotherKey',
              },
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
              Description: 'Alakazam',
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

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
      stack: mockNewTemplate,
      resourceDrifts: mockDriftedResources.StackResourceDrifts!,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.summary).toContain('1 resource has drifted');

    expect(result.unchanged).toContain('Resources In Sync');
    expect(result.unchecked).toContain('Unchecked Resources');
  });

  test('formatting with different drift statuses', () => {
    // GIVEN
    const mockDriftedResources: StackResourceDrift[] = [
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
    ];

    // WHEN
    const formatter = new DriftFormatter({
      stack: mockNewTemplate,
      resourceDrifts: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(2); // Only MODIFIED and DELETED count as drift
    expect(result.modified).toContain('Modified Resources');
    expect(result.modified).toContain('AWS::S3::Bucket');
    expect(result.modified).toContain('Resource1');
    expect(result.deleted).toContain('Deleted Resources');
    expect(result.deleted).toContain('AWS::IAM::Role');
    expect(result.deleted).toContain('Resource2');
    expect(result.summary).toContain('2 resources have drifted');
  });

  test('formatting with UNKNOWN drift status', () => {
    // GIVEN
    const templateWithMultipleResources = {
      template: {
        Resources: {
          Resource1: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              BucketName: 'expected-name',
            },
          },
          Resource2: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'test-role',
            },
          },
          Resource3: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    const mockDriftedResources: StackResourceDrift[] = [
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
        StackResourceDriftStatus: 'UNKNOWN',
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
    ];

    // WHEN
    const formatter = new DriftFormatter({
      stack: templateWithMultipleResources,
      resourceDrifts: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(1); // Only MODIFIED counts as drift, UNKNOWN does not
    expect(result.modified).toContain('Modified Resources');
    expect(result.modified).toContain('AWS::S3::Bucket');
    expect(result.modified).toContain('Resource1');
    expect(result.summary).toContain('1 resource has drifted');

    // UNKNOWN resources should be treated as unchecked, not as drift
    expect(result.unchecked).toContain('AWS::IAM::Role');
    expect(result.unchecked).toContain('Resource2');
  });

  test('formatting with only UNKNOWN drift status', () => {
    // GIVEN
    const templateWithUnknownResources = {
      template: {
        Resources: {
          Resource1: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              BucketName: 'test-bucket',
            },
          },
          Resource2: {
            Type: 'AWS::IAM::Role',
            Properties: {
              RoleName: 'test-role',
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    const mockDriftedResources: StackResourceDrift[] = [
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'UNKNOWN',
        LogicalResourceId: 'Resource1',
        PhysicalResourceId: 'physical-id-1',
        ResourceType: 'AWS::S3::Bucket',
        Timestamp: new Date(Date.now()),
      },
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'UNKNOWN',
        LogicalResourceId: 'Resource2',
        PhysicalResourceId: 'physical-id-2',
        ResourceType: 'AWS::IAM::Role',
        Timestamp: new Date(Date.now()),
      },
    ];

    // WHEN
    const formatter = new DriftFormatter({
      stack: templateWithUnknownResources,
      resourceDrifts: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(0); // UNKNOWN resources do not count as drift
    expect(result.summary).toContain('No drift detected');

    // All UNKNOWN resources should be in the unchecked section
    expect(result.unchecked).toBeDefined();
    expect(result.unchecked).toContain('AWS::S3::Bucket');
    expect(result.unchecked).toContain('Resource1');
    expect(result.unchecked).toContain('AWS::IAM::Role');
    expect(result.unchecked).toContain('Resource2');
  });

  test('filters out AWS::CDK::Metadata resources from drift count', () => {
    // GIVEN
    const templateWithMetadata = createTemplateWithMetadata({
      MyBucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: 'test-bucket',
        },
      },
    });

    const mockDriftedResources: StackResourceDrift[] = [
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'MyBucket',
        PhysicalResourceId: 'physical-bucket-id',
        ResourceType: 'AWS::S3::Bucket',
        PropertyDifferences: [{
          PropertyPath: '/BucketName',
          ExpectedValue: 'test-bucket',
          ActualValue: 'actual-bucket-name',
          DifferenceType: 'NOT_EQUAL',
        }],
        Timestamp: new Date(Date.now()),
      },
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'CDKMetadata',
        PhysicalResourceId: 'physical-metadata-id',
        ResourceType: 'AWS::CDK::Metadata',
        PropertyDifferences: [{
          PropertyPath: '/Analytics',
          ExpectedValue: 'placeholder-string',
          ActualValue: 'different-analytics-value',
          DifferenceType: 'NOT_EQUAL',
        }],
        Timestamp: new Date(Date.now()),
      },
    ];

    // WHEN
    const formatter = new DriftFormatter({
      stack: templateWithMetadata,
      resourceDrifts: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    // Only the S3 bucket should count as drift, not the CDK metadata resource
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.summary).toContain('1 resource has drifted');

    // The modified section should contain the S3 bucket but not the CDK metadata
    expect(result.modified).toContain('AWS::S3::Bucket');
    expect(result.modified).toContain('MyBucket');
    expect(result.modified).not.toContain('AWS::CDK::Metadata');
    expect(result.modified).not.toContain('CDKMetadata');
  });

  test('filters out AWS::CDK::Metadata resources from deleted resources section', () => {
    // GIVEN
    const templateWithMetadata = createTemplateWithMetadata({
      MyRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: 'test-role',
        },
      },
    });

    const mockDriftedResources: StackResourceDrift[] = [
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'DELETED',
        LogicalResourceId: 'MyRole',
        PhysicalResourceId: 'physical-role-id',
        ResourceType: 'AWS::IAM::Role',
        Timestamp: new Date(Date.now()),
      },
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'DELETED',
        LogicalResourceId: 'CDKMetadata',
        PhysicalResourceId: 'physical-metadata-id',
        ResourceType: 'AWS::CDK::Metadata',
        Timestamp: new Date(Date.now()),
      },
    ];

    // WHEN
    const formatter = new DriftFormatter({
      stack: templateWithMetadata,
      resourceDrifts: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    // Only the IAM role should count as drift, not the CDK metadata resource
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.summary).toContain('1 resource has drifted');

    // The deleted section should contain the IAM role but not the CDK metadata
    expect(result.deleted).toContain('AWS::IAM::Role');
    expect(result.deleted).toContain('MyRole');
    expect(result.deleted).not.toContain('AWS::CDK::Metadata');
    expect(result.deleted).not.toContain('CDKMetadata');
  });

  test('handles empty resource drift results', () => {
    // GIVEN
    const mockTemplate = {
      template: {
        Resources: {
          MyBucket: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              BucketName: 'test-bucket',
            },
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    // WHEN
    const formatter = new DriftFormatter({
      stack: mockTemplate,
      resourceDrifts: [], // Empty array
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(0);
    expect(result.summary).toContain('No drift detected');
    expect(result.numResourcesUnchecked).toBe(1); // MyBucket is unchecked
  });

  test('formatValue handles null and undefined values', () => {
    // GIVEN
    const mockTemplate = {
      template: {
        Resources: {
          MyResource: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    const mockDriftedResources: StackResourceDrift[] = [
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'MyResource',
        PhysicalResourceId: 'physical-id',
        ResourceType: 'AWS::S3::Bucket',
        PropertyDifferences: [
          {
            PropertyPath: '/NullProperty',
            ExpectedValue: null,
            ActualValue: 'some-value',
            DifferenceType: 'NOT_EQUAL',
          },
          {
            PropertyPath: '/ObjectProperty',
            ExpectedValue: { key: 'value' },
            ActualValue: { key: 'new-value' },
            DifferenceType: 'NOT_EQUAL',
          },
        ],
        Timestamp: new Date(Date.now()),
      },
    ];

    // WHEN
    const formatter = new DriftFormatter({
      stack: mockTemplate,
      resourceDrifts: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.modified).toBeDefined();
    // The formatter should handle null values and JSON stringify objects
    expect(result.modified).toContain('NullProperty');
    expect(result.modified).toContain('ObjectProperty');
  });

  test('formatTreeDiff handles ADDITION and REMOVAL differences', () => {
    // GIVEN
    const mockTemplate = {
      template: {
        Resources: {
          MyResource: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [],
    } as any;

    const mockDriftedResources: StackResourceDrift[] = [
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'MyResource',
        PhysicalResourceId: 'physical-id',
        ResourceType: 'AWS::S3::Bucket',
        PropertyDifferences: [
          {
            PropertyPath: '/AddedProperty',
            ExpectedValue: undefined,
            ActualValue: 'new-value',
            DifferenceType: 'ADD',
          },
          {
            PropertyPath: '/RemovedProperty',
            ExpectedValue: 'old-value',
            ActualValue: undefined,
            DifferenceType: 'REMOVE',
          },
        ],
        Timestamp: new Date(Date.now()),
      },
    ];

    // WHEN
    const formatter = new DriftFormatter({
      stack: mockTemplate,
      resourceDrifts: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.modified).toBeDefined();
    expect(result.modified).toContain('AddedProperty');
    expect(result.modified).toContain('RemovedProperty');
  });

  test('formatLogicalId handles path normalization', () => {
    // GIVEN
    const mockTemplate = {
      template: {
        Resources: {
          MyResource: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
      templateFile: 'template.json',
      stackName: 'test-stack',
      findMetadataByType: () => [
        {
          type: 'aws:cdk:logicalId',
          data: 'MyResource',
          path: '/MyStack/MyConstruct/Resource',
        },
        {
          type: 'aws:cdk:logicalId', 
          data: 'AnotherResource',
          path: '/MyStack/AnotherConstruct/Default',
        },
      ],
    } as any;

    const mockDriftedResources: StackResourceDrift[] = [
      {
        StackId: 'some:stack:arn',
        StackResourceDriftStatus: 'MODIFIED',
        LogicalResourceId: 'MyResource',
        PhysicalResourceId: 'physical-id',
        ResourceType: 'AWS::S3::Bucket',
        PropertyDifferences: [
          {
            PropertyPath: '/BucketName',
            ExpectedValue: 'old-name',
            ActualValue: 'new-name',
            DifferenceType: 'NOT_EQUAL',
          },
        ],
        Timestamp: new Date(Date.now()),
      },
    ];

    // WHEN
    const formatter = new DriftFormatter({
      stack: mockTemplate,
      resourceDrifts: mockDriftedResources,
    });
    const result = formatter.formatStackDrift();

    // THEN
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.modified).toBeDefined();
    // Should normalize path by removing leading slash and "Resource"/"Default" suffixes
    expect(result.modified).toContain('MyConstruct');
    expect(result.modified).toContain('MyResource'); // logical ID should still be present
  });
});
