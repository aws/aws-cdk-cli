import type * as cxapi from '@aws-cdk/cx-api';
import type { DescribeStackResourceDriftsCommandOutput } from '@aws-sdk/client-cloudformation';
import { detectStackDrift, DriftFormatter } from '../../../lib/api/drift';
import { IoHelper, IoDefaultMessages } from '../../../lib/api/io/private';
import { ToolkitError } from '../../../lib/toolkit/toolkit-error';

jest.mock('../../../lib/api/io/private', () => {
  const originalModule = jest.requireActual('../../../lib/api/io/private');
  return {
    ...originalModule,
    IO: {
      DEFAULT_TOOLKIT_DEBUG: {
        msg: jest.fn().mockReturnValue('mocked-message'),
      },
    },
    IoDefaultMessages: jest.fn(),
  };
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
    mockCfn.describeStackDriftDetectionStatus.mockImplementation(() => {
      // Simulate timeout by never returning DETECTION_COMPLETE
      return Promise.resolve({ DetectionStatus: 'DETECTION_IN_PROGRESS' });
    });

    // Mock Date.now to simulate timeout
    const originalDateNow = Date.now;
    const mockDateNow = jest.fn()
      .mockReturnValueOnce(1000) // First call - start time
      .mockReturnValueOnce(12000); // Second call - after timeout
    Date.now = mockDateNow;

    // WHEN & THEN
    await expect(async () => {
      try {
        await detectStackDrift(mockCfn, mockIoHelper, stackName);
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow;
      }
    }).rejects.toThrow(ToolkitError);
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
    const result = formatter.formatStackDrift({});

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
    const result = formatter.formatStackDrift({});

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
    const result = formatter.formatStackDrift({});

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
    const result = formatter.formatStackDrift({});

    // THEN
    expect(result.numResourcesWithDrift).toBeUndefined();
    expect(result.formattedDrift).toContain('No drift results available');
  });

  test('formatting with quiet should not output when no drift', () => {
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
    const result = formatter.formatStackDrift({ quiet: true });

    // THEN
    expect(result.numResourcesWithDrift).toBe(0);
    expect(result.formattedDrift).toBe('');
  });

  test('formatting with quiet should output when drift', () => {
    // GIVEN
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
        Timestamp: new Date(2025, 4, 20, 0, 0, 0),
      }],
      $metadata: {},
    };

    // WHEN
    const formatter = new DriftFormatter({
      ioHelper: mockIoHelper,
      stack: mockNewTemplate,
      driftResults: mockDriftedResources,
    });
    const result = formatter.formatStackDrift({ quiet: true });

    // THEN
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.formattedDrift).toContain('1 resource has drifted');
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
    const result = formatter.formatStackDrift({ verbose: true });

    // THEN
    expect(result.numResourcesWithDrift).toBe(1);
    expect(result.formattedDrift).toContain('1 resource has drifted');

    expect(result.formattedDrift).toContain('Resources In Sync');
    expect(result.formattedDrift).toContain('Unchecked Resources');
  });
});
