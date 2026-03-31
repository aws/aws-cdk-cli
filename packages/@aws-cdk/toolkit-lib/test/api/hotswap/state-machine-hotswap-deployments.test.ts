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
      primaryIdentifier: ['/properties/Arn'],
    }),
  });

  mockCloudControlClient.on(GetResourceCommand).resolves({
    ResourceDescription: {
      Properties: JSON.stringify({
        Arn: 'arn:swa:states:here:123456789012:stateMachine:my-machine',
        StateMachineName: 'my-machine',
        DefinitionString: '{ Prop: "old-value" }',
      }),
    },
  });

  mockCloudControlClient.on(UpdateResourceCommand).resolves({});
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
  test('returns undefined when a new StateMachine is added to the Stack', async () => {
    // GIVEN
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
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

  test('calls Cloud Control updateResource when it receives only a definitionString change', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: '{ Prop: "old-value" }',
            StateMachineName: 'my-machine',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: '{ Prop: "new-value" }',
              StateMachineName: 'my-machine',
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
      TypeName: 'AWS::StepFunctions::StateMachine',
      Identifier: 'arn:swa:states:here:123456789012:stateMachine:my-machine',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/DefinitionString',
        value: '{ Prop: "new-value" }',
      }]),
    });
  });

  test('calls Cloud Control updateResource when it receives a definitionString change with Fn::Join', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: {
              'Fn::Join': ['\n', ['{', '  "StartAt" : "SuccessState"', '}']],
            },
            StateMachineName: 'my-machine',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: {
                'Fn::Join': ['\n', ['{', '  "StartAt": "FailState"', '}']],
              },
              StateMachineName: 'my-machine',
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommand(UpdateResourceCommand);
  });

  test('calls Cloud Control updateResource when the state machine has no name', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: '{ "Prop" : "old-value" }',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: '{ "Prop" : "new-value" }',
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommand(UpdateResourceCommand);
  });

  test('hotswaps a non-DefinitionString property change via Cloud Control API (all properties are hotswappable via CCAPI)', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: '{ "Prop" : "old-value" }',
            LoggingConfiguration: {
              IncludeExecutionData: true,
            },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: '{ "Prop" : "new-value" }',
              LoggingConfiguration: {
                IncludeExecutionData: false,
              },
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommand(UpdateResourceCommand);
  });

  test('does not call Cloud Control when a resource with a non-StateMachine type is changed', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Machine: {
          Type: 'AWS::NotStepFunctions::NotStateMachine',
          Properties: {
            DefinitionString: '{ Prop: "old-value" }',
          },
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Machine: {
            Type: 'AWS::NotStepFunctions::NotStateMachine',
            Properties: {
              DefinitionString: '{ Prop: "new-value" }',
            },
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

  test('can correctly hotswap old style synth changes', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Parameters: { AssetParam1: { Type: 'String' } },
      Resources: {
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: { Ref: 'AssetParam1' },
            StateMachineName: 'machine-name',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:machine-name'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Parameters: { AssetParam2: { Type: String } },
        Resources: {
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: { Ref: 'AssetParam2' },
              StateMachineName: 'machine-name',
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact, {
      AssetParam2: 'asset-param-2',
    });

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::StepFunctions::StateMachine',
      Identifier: 'arn:swa:states:here:123456789012:stateMachine:machine-name',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/DefinitionString',
        value: 'asset-param-2',
      }]),
    });
  });

  test('calls Cloud Control updateResource when definitionString uses Fn::GetAtt', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Func: { Type: 'AWS::Lambda::Function' },
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: {
              'Fn::Join': ['\n', ['{', '  "StartAt" : "SuccessState"', '}']],
            },
            StateMachineName: 'my-machine',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
      setup.stackSummaryOf('Func', 'AWS::Lambda::Function', 'my-func'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Func: { Type: 'AWS::Lambda::Function' },
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: {
                'Fn::Join': ['', ['"Resource": ', { 'Fn::GetAtt': ['Func', 'Arn'] }]],
              },
              StateMachineName: 'my-machine',
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
      TypeName: 'AWS::StepFunctions::StateMachine',
      Identifier: 'arn:swa:states:here:123456789012:stateMachine:my-machine',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/DefinitionString',
        value: '"Resource": arn:swa:lambda:here:123456789012:function:my-func',
      }]),
    });
  });

  test('will not perform a hotswap deployment if it cannot find a Ref target', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Parameters: { Param1: { Type: 'String' } },
      Resources: {
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: {
              'Fn::Join': ['', ['{ Prop: "old-value" }, ', '{ "Param" : ', { 'Fn::Sub': '${Param1}' }, ' }']],
            },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Parameters: { Param1: { Type: 'String' } },
        Resources: {
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: {
                'Fn::Join': ['', ['{ Prop: "new-value" }, ', '{ "Param" : ', { 'Fn::Sub': '${Param1}' }, ' }']],
              },
            },
          },
        },
      },
    });

    if (hotswapMode === HotswapMode.FALL_BACK) {
      // THEN – falls back because the property can't be resolved
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).toBeUndefined();
      expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
    } else {
      // THEN – marked non-hotswappable, noOp
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      expect(deployStackResult).not.toBeUndefined();
      expect(deployStackResult?.noOp).toEqual(true);
      expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
    }
  });

  test("will not perform a hotswap deployment if it doesn't know how to handle a specific attribute", async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Bucket: { Type: 'AWS::S3::Bucket' },
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: {
              'Fn::Join': ['', ['{ Prop: "old-value" }, ', '{ "S3Bucket" : ', { 'Fn::GetAtt': ['Bucket', 'UnknownAttribute'] }, ' }']],
            },
            StateMachineName: 'my-machine',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
      setup.stackSummaryOf('Bucket', 'AWS::S3::Bucket', 'my-bucket'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Bucket: { Type: 'AWS::S3::Bucket' },
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: {
                'Fn::Join': ['', ['{ Prop: "new-value" }, ', '{ "S3Bucket" : ', { 'Fn::GetAtt': ['Bucket', 'UnknownAttribute'] }, ' }']],
              },
              StateMachineName: 'my-machine',
            },
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

  test('knows how to handle attributes of the AWS::Events::EventBus resource', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        EventBus: {
          Type: 'AWS::Events::EventBus',
          Properties: { Name: 'my-event-bus' },
        },
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: {
              'Fn::Join': ['', [
                '{"EventBus1Arn":"', { 'Fn::GetAtt': ['EventBus', 'Arn'] },
                '","EventBus1Name":"', { 'Fn::GetAtt': ['EventBus', 'Name'] },
                '","EventBus1Ref":"', { Ref: 'EventBus' }, '"}',
              ]],
            },
            StateMachineName: 'my-machine',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('EventBus', 'AWS::Events::EventBus', 'my-event-bus'),
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          EventBus: {
            Type: 'AWS::Events::EventBus',
            Properties: { Name: 'my-event-bus' },
          },
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: {
                'Fn::Join': ['', [
                  '{"EventBus2Arn":"', { 'Fn::GetAtt': ['EventBus', 'Arn'] },
                  '","EventBus2Name":"', { 'Fn::GetAtt': ['EventBus', 'Name'] },
                  '","EventBus2Ref":"', { Ref: 'EventBus' }, '"}',
                ]],
              },
              StateMachineName: 'my-machine',
            },
          },
        },
      },
    });

    // WHEN
    const result = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(result).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::StepFunctions::StateMachine',
      Identifier: 'arn:swa:states:here:123456789012:stateMachine:my-machine',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/DefinitionString',
        value: JSON.stringify({
          EventBus2Arn: 'arn:swa:events:here:123456789012:event-bus/my-event-bus',
          EventBus2Name: 'my-event-bus',
          EventBus2Ref: 'my-event-bus',
        }),
      }]),
    });
  });

  test('knows how to handle attributes of the AWS::DynamoDB::Table resource', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Table: {
          Type: 'AWS::DynamoDB::Table',
          Properties: {
            KeySchema: [{ AttributeName: 'name', KeyType: 'HASH' }],
            AttributeDefinitions: [{ AttributeName: 'name', AttributeType: 'S' }],
            BillingMode: 'PAY_PER_REQUEST',
          },
        },
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: '{}',
            StateMachineName: 'my-machine',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Table', 'AWS::DynamoDB::Table', 'my-dynamodb-table'),
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Table: {
            Type: 'AWS::DynamoDB::Table',
            Properties: {
              KeySchema: [{ AttributeName: 'name', KeyType: 'HASH' }],
              AttributeDefinitions: [{ AttributeName: 'name', AttributeType: 'S' }],
              BillingMode: 'PAY_PER_REQUEST',
            },
          },
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: {
                'Fn::Join': ['', [
                  '{"TableName":"', { Ref: 'Table' },
                  '","TableArn":"', { 'Fn::GetAtt': ['Table', 'Arn'] }, '"}',
                ]],
              },
              StateMachineName: 'my-machine',
            },
          },
        },
      },
    });

    // WHEN
    const result = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(result).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::StepFunctions::StateMachine',
      Identifier: 'arn:swa:states:here:123456789012:stateMachine:my-machine',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/DefinitionString',
        value: JSON.stringify({
          TableName: 'my-dynamodb-table',
          TableArn: 'arn:swa:dynamodb:here:123456789012:table/my-dynamodb-table',
        }),
      }]),
    });
  });

  test('knows how to handle attributes of the AWS::KMS::Key resource', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Key: {
          Type: 'AWS::KMS::Key',
          Properties: { Description: 'magic-key' },
        },
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: '{}',
            StateMachineName: 'my-machine',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Key', 'AWS::KMS::Key', 'a-key'),
      setup.stackSummaryOf('Machine', 'AWS::StepFunctions::StateMachine', 'arn:swa:states:here:123456789012:stateMachine:my-machine'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Key: {
            Type: 'AWS::KMS::Key',
            Properties: { Description: 'magic-key' },
          },
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: {
                'Fn::Join': ['', [
                  '{"KeyId":"', { Ref: 'Key' },
                  '","KeyArn":"', { 'Fn::GetAtt': ['Key', 'Arn'] }, '"}',
                ]],
              },
              StateMachineName: 'my-machine',
            },
          },
        },
      },
    });

    // WHEN
    const result = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(result).not.toBeUndefined();
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::StepFunctions::StateMachine',
      Identifier: 'arn:swa:states:here:123456789012:stateMachine:my-machine',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/DefinitionString',
        value: JSON.stringify({
          KeyId: 'a-key',
          KeyArn: 'arn:swa:kms:here:123456789012:key/a-key',
        }),
      }]),
    });
  });

  test('does not explode if the DependsOn changes', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Machine: {
          Type: 'AWS::StepFunctions::StateMachine',
          Properties: {
            DefinitionString: '{ Prop: "old-value" }',
            StateMachineName: 'my-machine',
          },
          DependsOn: ['abc'],
        },
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Machine: {
            Type: 'AWS::StepFunctions::StateMachine',
            Properties: {
              DefinitionString: '{ Prop: "old-value" }',
              StateMachineName: 'my-machine',
            },
          },
          DependsOn: ['xyz'],
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
