import { GetResourceCommand, UpdateResourceCommand } from '@aws-sdk/client-cloudcontrol';
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

  mockCloudControlClient.on(GetResourceCommand).resolves({
    ResourceDescription: {
      Properties: JSON.stringify({
        Id: 'res-123',
        SomeProp: 'old',
      }),
    },
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
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({ Id: 'res-123', Description: 'old description' }),
      },
    });
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
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({ Id: 'res-123', Name: 'my-api' }),
      },
    });
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
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({ Id: 'res-123', Description: 'same' }),
      },
    });
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
            Properties: { Id: 'res-123', Description: 'same' },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommand(GetResourceCommand);
    expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
  });

  test('resolves compound primary identifiers joined with |', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({
        primaryIdentifier: ['/properties/RestApiId', '/properties/StageName'],
      }),
    });
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({ RestApiId: 'api-123', StageName: 'prod', Description: 'old' }),
      },
    });
    setup.setCurrentCfnStackTemplate({
      Resources: {
        MyStage: {
          Type: 'AWS::ApiGateway::Stage',
          Properties: { RestApiId: 'api-123', StageName: 'prod', Description: 'old' },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('MyStage', 'AWS::ApiGateway::Stage', 'api-123|prod'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          MyStage: {
            Type: 'AWS::ApiGateway::Stage',
            Properties: { RestApiId: 'api-123', StageName: 'prod', Description: 'new' },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::ApiGateway::Stage',
      Identifier: 'api-123|prod',
      PatchDocument: JSON.stringify([{ op: 'replace', path: '/Description', value: 'new' }]),
    });
  });

  test('falls back to CFN physical resource ID when schema has no primaryIdentifier', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeTypeCommand).resolves({
      Schema: JSON.stringify({}),
    });
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({ Description: 'old' }),
      },
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
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({ Id: 'res-123', Description: 'old' }),
      },
    });
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
  'AWS::ApiGateway::Stage',
  'AWS::ApiGateway::Deployment',
  'AWS::ApiGateway::Method',
  'AWS::ApiGatewayV2::Api',
  'AWS::ApiGatewayV2::Integration',
  'AWS::ApiGatewayV2::Route',
  'AWS::Bedrock::Agent',
  'AWS::Events::Rule',
  'AWS::DynamoDB::Table',
  'AWS::DynamoDB::GlobalTable',
  'AWS::SNS::Subscription',
  'AWS::SNS::Topic',
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
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({ Id: 'res-123', SomeProp: 'old' }),
      },
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
