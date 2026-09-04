import { UpdateResourceCommand, GetResourceCommand } from '@aws-sdk/client-cloudcontrol';
import { DescribeTypeCommand } from '@aws-sdk/client-cloudformation';
import { HotswapMode } from '../../../lib/api/hotswap';
import { mockCloudControlClient, mockCloudFormationClient } from '../../_helpers/mock-sdk';
import * as setup from '../_helpers/hotswap-test-setup';

let hotswapMockSdkProvider: setup.HotswapMockSdkProvider;

beforeEach(() => {
  hotswapMockSdkProvider = setup.setupHotswapTests();

  mockCloudFormationClient.on(DescribeTypeCommand).resolves({
    Schema: JSON.stringify({
      primaryIdentifier: ['/properties/Id'],
    }),
  });

  mockCloudControlClient.on(UpdateResourceCommand).resolves({});
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
  test('returns undefined when a new CCAPI resource is added to the Stack', async () => {
    // GIVEN
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyApi: {
            Type: 'AWS::ApiGateway::RestApi',
          },
        },
      },
    });

    if (hotswapMode === HotswapMode.FALL_BACK) {
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).toBeUndefined();
      expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
    } else {
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).not.toBeUndefined();
      expect(deployStackResult?.noOp).toEqual(true);
      expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
    }
  });

  test('calls Cloud Control updateResource when a property changes', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyApi: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: {
            Id: 'res-123',
            Description: 'old description',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyApi', 'AWS::ApiGateway::RestApi', 'res-123'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyApi: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: {
              Id: 'res-123',
              Description: 'new description',
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::ApiGateway::RestApi',
      Identifier: 'res-123',
      PatchDocument: JSON.stringify([
        { op: 'replace', path: '/Description', value: 'new description' },
      ]),
    });
  });

  test('uses "add" op for properties not present in the current resource', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyApi: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: { Id: 'res-123', Name: 'my-api' },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyApi', 'AWS::ApiGateway::RestApi', 'res-123'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyApi: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: { Id: 'res-123', Name: 'my-api', Description: 'brand new' },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::ApiGateway::RestApi',
      Identifier: 'res-123',
      PatchDocument: JSON.stringify([
        { op: 'add', path: '/Description', value: 'brand new' },
      ]),
    });
  });

  test('skips updateResource when property values are already the same', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyApi: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: { Id: 'res-123', Description: 'old' },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyApi', 'AWS::ApiGateway::RestApi', 'res-123'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyApi: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: { Id: 'res-123', Description: 'old' },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
  });

  test('resolves compound primary identifiers joined with |', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({
        primaryIdentifier: ['/properties/ApiId', '/properties/IntegrationId'],
      }),
    });
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyIntegration: {
          Type: 'AWS::ApiGatewayV2::Integration',
          Properties: { ApiId: 'api-123', IntegrationId: 'integ-456', TimeoutInMillis: 29000 },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyIntegration', 'AWS::ApiGatewayV2::Integration', 'integ-456'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: { ApiId: 'api-123', IntegrationId: 'integ-456', TimeoutInMillis: 15000 },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::ApiGatewayV2::Integration',
      Identifier: 'api-123|integ-456',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/TimeoutInMillis', value: 15000 }]),
    });
  });

  test('resolves compound identifier when one property is read-only and absent from template', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({
        primaryIdentifier: ['/properties/ApiId', '/properties/IntegrationId'],
      }),
    });
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyIntegration: {
          Type: 'AWS::ApiGatewayV2::Integration',
          Properties: { ApiId: 'api-123', IntegrationType: 'AWS_PROXY', TimeoutInMillis: 29000 },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyIntegration', 'AWS::ApiGatewayV2::Integration', 'integ-456'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyIntegration: {
            Type: 'AWS::ApiGatewayV2::Integration',
            Properties: { ApiId: 'api-123', IntegrationType: 'AWS_PROXY', TimeoutInMillis: 15000 },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::ApiGatewayV2::Integration',
      Identifier: 'api-123|integ-456',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/TimeoutInMillis', value: 15000 }]),
    });
  });

  test('falls back to CFN physical resource ID when schema has no primaryIdentifier', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({}),
    });
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyRule: {
          Type: 'AWS::Events::Rule',
          Properties: { Description: 'old' },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyRule', 'AWS::Events::Rule', 'my-rule-physical-id'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyRule: {
            Type: 'AWS::Events::Rule',
            Properties: { Description: 'new' },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::Events::Rule',
      Identifier: 'my-rule-physical-id',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/Description', value: 'new' }]),
    });
  });

  test('returns non-hotswappable when physical name cannot be determined', async () => {
    // GIVEN – no stack resource summaries pushed
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyApi: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: { Description: 'old' },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyApi: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: { Description: 'new' },
          },
        },
      },
    });

    if (hotswapMode === HotswapMode.FALL_BACK) {
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).toBeUndefined();
      expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
    } else {
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).not.toBeUndefined();
      expect(deployStackResult?.noOp).toEqual(true);
      expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
    }
  });

  test('returns non-hotswappable when a property references an unresolvable parameter', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Parameters: { Param1: { Type: 'String' } },
      Resources: {
        MyApi: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: { Id: 'res-123', Description: { Ref: 'Param1' } },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyApi', 'AWS::ApiGateway::RestApi', 'res-123'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Parameters: { Param1: { Type: 'String' } },
        Resources: {
          MyApi: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: { Id: 'res-123', Description: { Ref: 'Param1' } },
          },
        },
      },
    });

    // Templates are identical so there are no changes — both modes return a noOp result
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
    expect(deployStackResult).not.toBeUndefined();
    expect(deployStackResult?.noOp).toEqual(true);
    expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
  });

  test('evaluates Ref expressions in property values', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Bucket: { Type: 'AWS::S3::Bucket' },
        MyApi: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: { Id: 'res-123', Description: 'old' },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Bucket', 'AWS::S3::Bucket', 'my-bucket'),
      setup.stackSummaryOf('MyApi', 'AWS::ApiGateway::RestApi', 'res-123'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Bucket: { Type: 'AWS::S3::Bucket' },
          MyApi: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: {
              Id: 'res-123',
              Description: { 'Fn::Join': ['-', [{ Ref: 'Bucket' }, 'desc']] },
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::ApiGateway::RestApi',
      Identifier: 'res-123',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/Description', value: 'my-bucket-desc' }]),
    });
  });

  test('does not hotswap when there are no property changes', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyApi: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: { Id: 'res-123', Description: 'same' },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyApi: {
            Type: 'AWS::ApiGateway::RestApi',
            Properties: { Id: 'res-123', Description: 'same' },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(deployStackResult?.noOp).toEqual(true);
    expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
  });
});

// Sanity check: each CCAPI-registered resource type can be hotswapped
describe.each([
  'AWS::ApiGateway::RestApi',
  'AWS::ApiGateway::Method',
  'AWS::ApiGatewayV2::Api',
  'AWS::Bedrock::Agent',
  'AWS::Events::Rule',
  'AWS::DynamoDB::Table',
  'AWS::DynamoDB::GlobalTable',
  'AWS::SQS::Queue',
  'AWS::CloudWatch::Alarm',
  'AWS::CloudWatch::CompositeAlarm',
  'AWS::CloudWatch::Dashboard',
  'AWS::StepFunctions::StateMachine',
  'AWS::BedrockAgentCore::Runtime',
  'AWS::QuickSight::Dashboard',
  'AWS::QuickSight::Analysis',
  'AWS::QuickSight::Template',
  'AWS::QuickSight::DataSet',
  'AWS::QuickSight::DataSource',
])('CCAPI sanity check for resources where Primary Identifier matches Physical ID %s', (resourceType) => {
  beforeEach(() => {
    hotswapMockSdkProvider = setup.setupHotswapTests();

    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({ primaryIdentifier: ['/properties/Id'] }),
    });
    mockCloudControlClient.on(UpdateResourceCommand).resolves({});
  });

  test('hotswaps a property change via Cloud Control API', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyResource: {
          Type: resourceType,
          Properties: { Id: 'res-123', SomeProp: 'old' },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyResource', resourceType, 'res-123'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyResource: {
            Type: resourceType,
            Properties: { Id: 'res-123', SomeProp: 'new' },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: resourceType,
      Identifier: 'res-123',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/SomeProp', value: 'new' }]),
    });
  });
});

// Sanity check: each CCAPI-registered resource type can be hotswapped
describe.each([
  'AWS::ApiGateway::Deployment',
  'AWS::ApiGatewayV2::Integration',
])('CCAPI sanity check for resources where Primary Identifier does not match Physical ID %s', (resourceType) => {
  beforeEach(() => {
    hotswapMockSdkProvider = setup.setupHotswapTests();

    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({ primaryIdentifier: ['/properties/Id'] }),
    });
    mockCloudControlClient.on(UpdateResourceCommand).resolves({});
  });

  test('hotswaps a property change via Cloud Control API', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyResource: {
          Type: resourceType,
          Properties: { Id: 'res-123', SomeProp: 'old' },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyResource', resourceType, 'res-123'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyResource: {
            Type: resourceType,
            Properties: { Id: 'res-123', SomeProp: 'new' },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: resourceType,
      Identifier: 'res-123|res-123',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/SomeProp', value: 'new' }]),
    });
  });
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('QuickSight hotswap via CCAPI in %p mode', (hotswapMode) => {
  beforeEach(() => {
    hotswapMockSdkProvider = setup.setupHotswapTests();

    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({
        primaryIdentifier: ['/properties/AwsAccountId', '/properties/DashboardId'],
      }),
    });
    mockCloudControlClient.on(UpdateResourceCommand).resolves({});
  });

  test('hotswaps a QuickSight Dashboard Name change', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyDashboard: {
          Type: 'AWS::QuickSight::Dashboard',
          Properties: {
            AwsAccountId: '123456789012',
            DashboardId: 'my-dashboard',
            Name: 'Old Dashboard',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyDashboard', 'AWS::QuickSight::Dashboard', 'my-dashboard'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyDashboard: {
            Type: 'AWS::QuickSight::Dashboard',
            Properties: {
              AwsAccountId: '123456789012',
              DashboardId: 'my-dashboard',
              Name: 'New Dashboard',
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::QuickSight::Dashboard',
      Identifier: 'my-dashboard',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/Name', value: 'New Dashboard' }]),
    });
  });

  test('hotswaps a QuickSight Dashboard Definition change', async () => {
    // GIVEN
    const oldDefinition = { DataSetIdentifierDeclarations: [{ Identifier: 'ds1', DataSetArn: 'arn:old' }] };
    const newDefinition = { DataSetIdentifierDeclarations: [{ Identifier: 'ds1', DataSetArn: 'arn:new' }] };
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyDashboard: {
          Type: 'AWS::QuickSight::Dashboard',
          Properties: {
            AwsAccountId: '123456789012',
            DashboardId: 'my-dashboard',
            Definition: oldDefinition,
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyDashboard', 'AWS::QuickSight::Dashboard', 'my-dashboard'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyDashboard: {
            Type: 'AWS::QuickSight::Dashboard',
            Properties: {
              AwsAccountId: '123456789012',
              DashboardId: 'my-dashboard',
              Definition: newDefinition,
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::QuickSight::Dashboard',
      Identifier: 'my-dashboard',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/Definition', value: newDefinition }]),
    });
  });
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('Property removal and addition in %p mode', (hotswapMode) => {
  beforeEach(() => {
    hotswapMockSdkProvider = setup.setupHotswapTests();

    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({ primaryIdentifier: ['/properties/TableName'] }),
    });
    mockCloudControlClient.on(UpdateResourceCommand).resolves({});
  });

  test('uses remove op when a property is deleted from the new template', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Table: {
          Type: 'AWS::DynamoDB::Table',
          Properties: {
            TableName: 'my-table',
            BillingMode: 'PROVISIONED',
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Table', 'AWS::DynamoDB::Table', 'my-table'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Table: {
            Type: 'AWS::DynamoDB::Table',
            Properties: {
              TableName: 'my-table',
              BillingMode: 'PAY_PER_REQUEST',
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::DynamoDB::Table',
      Identifier: 'my-table',
      PatchDocument: JSON.stringify([
        { op: 'replace', path: '/BillingMode', value: 'PAY_PER_REQUEST' },
        { op: 'remove', path: '/ProvisionedThroughput' },
      ]),
    });
  });

  test('uses add op when a new property is introduced in the new template', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Table: {
          Type: 'AWS::DynamoDB::Table',
          Properties: {
            TableName: 'my-table',
            BillingMode: 'PAY_PER_REQUEST',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Table', 'AWS::DynamoDB::Table', 'my-table'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Table: {
            Type: 'AWS::DynamoDB::Table',
            Properties: {
              TableName: 'my-table',
              BillingMode: 'PROVISIONED',
              ProvisionedThroughput: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 },
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::DynamoDB::Table',
      Identifier: 'my-table',
      PatchDocument: JSON.stringify([
        { op: 'replace', path: '/BillingMode', value: 'PROVISIONED' },
        { op: 'add', path: '/ProvisionedThroughput', value: { ReadCapacityUnits: 10, WriteCapacityUnits: 10 } },
      ]),
    });
  });
});

describe('Tags hotswap does not disturb reserved aws:-prefixed tags', () => {
  // Mirrors the live tag layout observed on a CloudFormation-created SQS queue: the reserved
  // aws:cloudformation:* tags are interleaved with the template's own tags, and the live
  // ordering is NOT the template ordering.
  const liveTags = [
    { Key: 'aws:cloudformation:logical-id', Value: 'Queue' },
    { Key: 'DynamoTableArn', Value: 'arn:aws:dynamodb:us-east-1:1111:table/T' },
    { Key: 'aws:cloudformation:stack-id', Value: 'arn:aws:cloudformation:us-east-1:1111:stack/s/1' },
    { Key: 'aws:cloudformation:stack-name', Value: 'my-stack' },
    { Key: 'DynamicTag', Value: 'original value' },
  ];

  function givenQueue(currentTags: any, templateTags: any, newTemplateTags: any) {
    mockCloudControlClient.on(GetResourceCommand).resolves({
      TypeName: 'AWS::SQS::Queue',
      ResourceDescription: {
        Identifier: 'q-123',
        Properties: JSON.stringify({ Id: 'q-123', Tags: currentTags }),
      },
    });
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Queue: { Type: 'AWS::SQS::Queue', Properties: { Id: 'q-123', Tags: templateTags } },
      },
    });
    setup.pushStackResourceSummaries(setup.stackSummaryOf('Queue', 'AWS::SQS::Queue', 'q-123'));
    return setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Queue: { Type: 'AWS::SQS::Queue', Properties: { Id: 'q-123', Tags: newTemplateTags } },
        },
      },
    });
  }

  const patchOf = () => {
    const call = mockCloudControlClient.commandCalls(UpdateResourceCommand)[0];
    return JSON.parse((call.args[0].input as any).PatchDocument);
  };

  beforeEach(() => {
    hotswapMockSdkProvider = setup.setupHotswapTests();
    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({ primaryIdentifier: ['/properties/Id'] }),
    });
    mockCloudControlClient.on(UpdateResourceCommand).resolves({});
  });

  test('addresses the changed tag by its index in the live list, naming no reserved tag', async () => {
    // GIVEN - only DynamicTag changes; it sits at index 4 on the live resource
    const artifact = givenQueue(
      liveTags,
      [{ Key: 'DynamicTag', Value: 'original value' }, { Key: 'DynamoTableArn', Value: 'arn:aws:dynamodb:us-east-1:1111:table/T' }],
      [{ Key: 'DynamicTag', Value: 'new value' }, { Key: 'DynamoTableArn', Value: 'arn:aws:dynamodb:us-east-1:1111:table/T' }],
    );

    // WHEN
    await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact);

    // THEN - a single index-addressed replace, matching the patch shape proven to be accepted
    expect(patchOf()).toEqual([
      { op: 'replace', path: '/Tags/4', value: { Key: 'DynamicTag', Value: 'new value' } },
    ]);
    // and crucially: no wholesale /Tags replace, and no aws: key anywhere in the patch
    const patchText = JSON.stringify(patchOf());
    expect(patchText).not.toContain('"path":"/Tags"');
    expect(patchText.toLowerCase()).not.toContain('aws:');
  });

  test('appends a tag the resource does not have yet', async () => {
    // GIVEN
    const unchanged = { Key: 'DynamoTableArn', Value: 'arn:aws:dynamodb:us-east-1:1111:table/T' };
    const artifact = givenQueue(
      liveTags,
      [{ Key: 'DynamicTag', Value: 'original value' }, unchanged],
      [{ Key: 'DynamicTag', Value: 'original value' }, unchanged, { Key: 'BrandNew', Value: 'x' }],
    );

    // WHEN
    await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact);

    // THEN
    expect(patchOf()).toEqual([{ op: 'add', path: '/Tags/-', value: { Key: 'BrandNew', Value: 'x' } }]);
  });

  test('removes a tag dropped from the template but never a reserved one', async () => {
    // GIVEN - the template no longer defines DynamoTableArn (live index 1)
    const artifact = givenQueue(
      liveTags,
      [{ Key: 'DynamicTag', Value: 'original value' }, { Key: 'DynamoTableArn', Value: 'arn:aws:dynamodb:us-east-1:1111:table/T' }],
      [{ Key: 'DynamicTag', Value: 'original value' }],
    );

    // WHEN
    await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact);

    // THEN - only the user tag is removed; the three reserved tags are untouched
    expect(patchOf()).toEqual([{ op: 'remove', path: '/Tags/1' }]);
    expect(JSON.stringify(patchOf()).toLowerCase()).not.toContain('aws:');
  });

  test('fails loudly when the live tags cannot be read, instead of sending a wholesale replace', async () => {
    // GIVEN - the deploy role may not read the resource, so GetResource fails
    const artifact = givenQueue(
      liveTags,
      [{ Key: 'DynamicTag', Value: 'original value' }],
      [{ Key: 'DynamicTag', Value: 'new value' }],
    );
    mockCloudControlClient.on(GetResourceCommand).rejects(new Error('AccessDenied'));

    // WHEN / THEN - the hotswap fails with an actionable error...
    await expect(
      hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact),
    ).rejects.toThrow(/could not read the current tags of q-123 \(AWS::SQS::Queue\)/);

    // ...and we never send the request that would have removed the reserved tags
    expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
  });

  test('treats a resource with no tags as all additions', async () => {
    // GIVEN - the live resource carries no Tags at all
    const artifact = givenQueue(
      undefined,
      [{ Key: 'DynamicTag', Value: 'original value' }],
      [{ Key: 'DynamicTag', Value: 'new value' }],
    );

    // WHEN
    await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact);

    // THEN
    expect(patchOf()).toEqual([
      { op: 'add', path: '/Tags/-', value: { Key: 'DynamicTag', Value: 'new value' } },
    ]);
  });
});

describe('Tags modelled as a { key: value } map', () => {
  // Some resource types model Tags as a map rather than a list of { Key, Value }.
  const liveTags = {
    'aws:cloudformation:stack-name': 'my-stack',
    'aws:cloudformation:logical-id': 'Api',
    'DynamicTag': 'original value',
  };

  function givenApi(currentTags: any, templateTags: any, newTemplateTags: any) {
    mockCloudControlClient.on(GetResourceCommand).resolves({
      TypeName: 'AWS::ApiGatewayV2::Api',
      ResourceDescription: {
        Identifier: 'api-123',
        Properties: JSON.stringify({ Id: 'api-123', Tags: currentTags }),
      },
    });
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Api: { Type: 'AWS::ApiGatewayV2::Api', Properties: { Id: 'api-123', Tags: templateTags } },
      },
    });
    setup.pushStackResourceSummaries(setup.stackSummaryOf('Api', 'AWS::ApiGatewayV2::Api', 'api-123'));
    return setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Api: { Type: 'AWS::ApiGatewayV2::Api', Properties: { Id: 'api-123', Tags: newTemplateTags } },
        },
      },
    });
  }

  const patchOf = () => {
    const call = mockCloudControlClient.commandCalls(UpdateResourceCommand)[0];
    return JSON.parse((call.args[0].input as any).PatchDocument);
  };

  beforeEach(() => {
    hotswapMockSdkProvider = setup.setupHotswapTests();
    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({ primaryIdentifier: ['/properties/Id'] }),
    });
    mockCloudControlClient.on(UpdateResourceCommand).resolves({});
  });

  test('addresses the changed tag by key, naming no reserved tag', async () => {
    // GIVEN
    const artifact = givenApi(
      liveTags,
      { DynamicTag: 'original value' },
      { DynamicTag: 'new value' },
    );

    // WHEN
    await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact);

    // THEN
    expect(patchOf()).toEqual([
      { op: 'replace', path: '/Tags/DynamicTag', value: 'new value' },
    ]);
    const patchText = JSON.stringify(patchOf());
    expect(patchText).not.toContain('"path":"/Tags"');
    expect(patchText.toLowerCase()).not.toContain('aws:');
  });

  test('escapes / and ~ in tag keys per RFC 6901', async () => {
    // GIVEN - AWS tag keys may legally contain '/'
    const artifact = givenApi(
      { 'cost/center': 'old', 'a~b': 'old' },
      { 'cost/center': 'old', 'a~b': 'old' },
      { 'cost/center': 'new', 'a~b': 'new' },
    );

    // WHEN
    await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact);

    // THEN - '/' -> '~1' and '~' -> '~0', so the key is not read as a path separator
    expect(patchOf()).toEqual([
      { op: 'replace', path: '/Tags/cost~1center', value: 'new' },
      { op: 'replace', path: '/Tags/a~0b', value: 'new' },
    ]);
  });

  test('removes a tag dropped from the template but never a reserved one', async () => {
    // GIVEN
    const artifact = givenApi(
      { ...liveTags, Obsolete: 'x' },
      { DynamicTag: 'original value', Obsolete: 'x' },
      { DynamicTag: 'original value' },
    );

    // WHEN
    await hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact);

    // THEN
    expect(patchOf()).toEqual([{ op: 'remove', path: '/Tags/Obsolete' }]);
    expect(JSON.stringify(patchOf()).toLowerCase()).not.toContain('aws:');
  });
});

describe('Tags in an unexpected shape', () => {
  beforeEach(() => {
    hotswapMockSdkProvider = setup.setupHotswapTests();
    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({ primaryIdentifier: ['/properties/Id'] }),
    });
    mockCloudControlClient.on(UpdateResourceCommand).resolves({});
  });

  test('fails rather than sending a wholesale replace when the live Tags shape is not the template shape', async () => {
    // GIVEN - the template declares a list, but the resource reports a scalar
    mockCloudControlClient.on(GetResourceCommand).resolves({
      TypeName: 'AWS::SQS::Queue',
      ResourceDescription: {
        Identifier: 'q-123',
        Properties: JSON.stringify({ Id: 'q-123', Tags: 'not-a-tag-collection' }),
      },
    });
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Queue: { Type: 'AWS::SQS::Queue', Properties: { Id: 'q-123', Tags: [{ Key: 'DynamicTag', Value: 'a' }] } },
      },
    });
    setup.pushStackResourceSummaries(setup.stackSummaryOf('Queue', 'AWS::SQS::Queue', 'q-123'));
    const artifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Queue: { Type: 'AWS::SQS::Queue', Properties: { Id: 'q-123', Tags: [{ Key: 'DynamicTag', Value: 'b' }] } },
        },
      },
    });

    // WHEN / THEN
    await expect(
      hotswapMockSdkProvider.tryHotswapDeployment(HotswapMode.HOTSWAP_ONLY, artifact),
    ).rejects.toThrow(/could not interpret the current tags of q-123 \(AWS::SQS::Queue\): the resource reports Tags as string but the template declares a list/);

    // and we never send the request that would have removed the reserved tags
    expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
  });
});
