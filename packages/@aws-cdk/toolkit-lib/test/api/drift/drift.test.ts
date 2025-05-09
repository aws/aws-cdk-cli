import type * as cxapi from '@aws-cdk/cx-api';
import type { DescribeStackResourceDriftsCommandOutput } from '@aws-sdk/client-cloudformation';
import { DriftFormatter } from '../../../lib/api/drift';
import { IoHelper, IoDefaultMessages } from '../../../lib/api/io/private';

jest.mock('../../../lib/api/io/private/messages', () => ({
  IoDefaultMessages: jest.fn(),
}));

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
});
