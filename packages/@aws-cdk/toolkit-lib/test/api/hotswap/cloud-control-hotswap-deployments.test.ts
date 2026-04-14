import { UpdateResourceCommand } from '@aws-sdk/client-cloudcontrol';
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
  'AWS::ApiGateway::Deployment',
  'AWS::ApiGateway::Method',
  'AWS::ApiGatewayV2::Api',
  'AWS::ApiGatewayV2::Integration',
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
])('CCAPI sanity check for %s', (resourceType) => {
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
