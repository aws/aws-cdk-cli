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
      primaryIdentifier: ['/properties/AgentRuntimeId'],
    }),
  });

  mockCloudControlClient.on(GetResourceCommand).resolves({
    ResourceDescription: {
      Properties: JSON.stringify({
        AgentRuntimeId: 'my-runtime',
        RuntimeName: 'my-runtime',
        RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
        NetworkConfiguration: {
          NetworkMode: 'VPC',
          NetworkModeConfig: {
            Subnets: ['subnet-1', 'subnet-2'],
            SecurityGroups: ['sg-1'],
          },
        },
        AgentRuntimeArtifact: {
          CodeConfiguration: {
            Code: {
              S3: {
                Bucket: 'my-bucket',
                Prefix: 'code.zip',
              },
            },
            Runtime: 'PYTHON_3_13',
            EntryPoint: ['app.py'],
          },
        },
      }),
    },
  });

  mockCloudControlClient.on(UpdateResourceCommand).resolves({});
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
  test('calls Cloud Control updateResource when it receives only an S3 code difference in a Runtime', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
            AgentRuntimeId: 'my-runtime',
            RuntimeName: 'my-runtime',
            RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
            NetworkConfiguration: {
              NetworkMode: 'VPC',
              NetworkModeConfig: {
                Subnets: ['subnet-1', 'subnet-2'],
                SecurityGroups: ['sg-1'],
              },
            },
            AgentRuntimeArtifact: {
              CodeConfiguration: {
                Code: {
                  S3: {
                    Bucket: 'my-bucket',
                    Prefix: 'old-code.zip',
                  },
                },
                Runtime: 'PYTHON_3_13',
                EntryPoint: ['app.py'],
              },
            },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Runtime', 'AWS::BedrockAgentCore::Runtime', 'my-runtime'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Runtime: {
            Type: 'AWS::BedrockAgentCore::Runtime',
            Properties: {
              AgentRuntimeId: 'my-runtime',
              RuntimeName: 'my-runtime',
              RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
              NetworkConfiguration: {
                NetworkMode: 'VPC',
                NetworkModeConfig: {
                  Subnets: ['subnet-1', 'subnet-2'],
                  SecurityGroups: ['sg-1'],
                },
              },
              AgentRuntimeArtifact: {
                CodeConfiguration: {
                  Code: {
                    S3: {
                      Bucket: 'my-bucket',
                      Prefix: 'new-code.zip',
                    },
                  },
                  Runtime: 'PYTHON_3_13',
                  EntryPoint: ['app.py'],
                },
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
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/AgentRuntimeArtifact',
        value: {
          CodeConfiguration: {
            Code: {
              S3: {
                Bucket: 'my-bucket',
                Prefix: 'new-code.zip',
              },
            },
            Runtime: 'PYTHON_3_13',
            EntryPoint: ['app.py'],
          },
        },
      }]),
    });
  });

  test('calls Cloud Control updateResource when it receives only a container image difference in a Runtime', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({
          AgentRuntimeId: 'my-runtime',
          RuntimeName: 'my-runtime',
          RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
          NetworkConfiguration: {
            NetworkMode: 'VPC',
            NetworkModeConfig: {
              Subnets: ['subnet-1', 'subnet-2'],
              SecurityGroups: ['sg-1'],
            },
          },
          AgentRuntimeArtifact: {
            ContainerConfiguration: {
              ContainerUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:old-tag',
            },
          },
        }),
      },
    });

    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
            AgentRuntimeId: 'my-runtime',
            RuntimeName: 'my-runtime',
            RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
            NetworkConfiguration: {
              NetworkMode: 'VPC',
              NetworkModeConfig: {
                Subnets: ['subnet-1', 'subnet-2'],
                SecurityGroups: ['sg-1'],
              },
            },
            AgentRuntimeArtifact: {
              ContainerConfiguration: {
                ContainerUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:old-tag',
              },
            },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Runtime', 'AWS::BedrockAgentCore::Runtime', 'my-runtime'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Runtime: {
            Type: 'AWS::BedrockAgentCore::Runtime',
            Properties: {
              AgentRuntimeId: 'my-runtime',
              RuntimeName: 'my-runtime',
              RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
              NetworkConfiguration: {
                NetworkMode: 'VPC',
                NetworkModeConfig: {
                  Subnets: ['subnet-1', 'subnet-2'],
                  SecurityGroups: ['sg-1'],
                },
              },
              AgentRuntimeArtifact: {
                ContainerConfiguration: {
                  ContainerUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:new-tag',
                },
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
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/AgentRuntimeArtifact',
        value: {
          ContainerConfiguration: {
            ContainerUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:new-tag',
          },
        },
      }]),
    });
  });

  test('calls Cloud Control updateResource when it receives only a description change', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({
          AgentRuntimeId: 'my-runtime',
          RuntimeName: 'my-runtime',
          RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
          NetworkConfiguration: {
            NetworkMode: 'VPC',
            NetworkModeConfig: {
              Subnets: ['subnet-1', 'subnet-2'],
              SecurityGroups: ['sg-1'],
            },
          },
          AgentRuntimeArtifact: {
            CodeConfiguration: {
              Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip' } },
              Runtime: 'PYTHON_3_13',
              EntryPoint: ['app.py'],
            },
          },
          Description: 'Old description',
        }),
      },
    });

    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
            AgentRuntimeId: 'my-runtime',
            RuntimeName: 'my-runtime',
            RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
            NetworkConfiguration: {
              NetworkMode: 'VPC',
              NetworkModeConfig: {
                Subnets: ['subnet-1', 'subnet-2'],
                SecurityGroups: ['sg-1'],
              },
            },
            AgentRuntimeArtifact: {
              CodeConfiguration: {
                Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip' } },
                Runtime: 'PYTHON_3_13',
                EntryPoint: ['app.py'],
              },
            },
            Description: 'Old description',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Runtime', 'AWS::BedrockAgentCore::Runtime', 'my-runtime'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Runtime: {
            Type: 'AWS::BedrockAgentCore::Runtime',
            Properties: {
              AgentRuntimeId: 'my-runtime',
              RuntimeName: 'my-runtime',
              RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
              NetworkConfiguration: {
                NetworkMode: 'VPC',
                NetworkModeConfig: {
                  Subnets: ['subnet-1', 'subnet-2'],
                  SecurityGroups: ['sg-1'],
                },
              },
              AgentRuntimeArtifact: {
                CodeConfiguration: {
                  Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip' } },
                  Runtime: 'PYTHON_3_13',
                  EntryPoint: ['app.py'],
                },
              },
              Description: 'New description',
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
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/Description',
        value: 'New description',
      }]),
    });
  });

  test('calls Cloud Control updateResource when it receives only environment variables changes', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({
          AgentRuntimeId: 'my-runtime',
          RuntimeName: 'my-runtime',
          RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
          NetworkConfiguration: {
            NetworkMode: 'VPC',
            NetworkModeConfig: {
              Subnets: ['subnet-1', 'subnet-2'],
              SecurityGroups: ['sg-1'],
            },
          },
          AgentRuntimeArtifact: {
            CodeConfiguration: {
              Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip' } },
              Runtime: 'PYTHON_3_13',
              EntryPoint: ['app.py'],
            },
          },
          EnvironmentVariables: { KEY1: 'value1' },
        }),
      },
    });

    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
            AgentRuntimeId: 'my-runtime',
            RuntimeName: 'my-runtime',
            RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
            NetworkConfiguration: {
              NetworkMode: 'VPC',
              NetworkModeConfig: {
                Subnets: ['subnet-1', 'subnet-2'],
                SecurityGroups: ['sg-1'],
              },
            },
            AgentRuntimeArtifact: {
              CodeConfiguration: {
                Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip' } },
                Runtime: 'PYTHON_3_13',
                EntryPoint: ['app.py'],
              },
            },
            EnvironmentVariables: { KEY1: 'value1' },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Runtime', 'AWS::BedrockAgentCore::Runtime', 'my-runtime'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Runtime: {
            Type: 'AWS::BedrockAgentCore::Runtime',
            Properties: {
              AgentRuntimeId: 'my-runtime',
              RuntimeName: 'my-runtime',
              RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
              NetworkConfiguration: {
                NetworkMode: 'VPC',
                NetworkModeConfig: {
                  Subnets: ['subnet-1', 'subnet-2'],
                  SecurityGroups: ['sg-1'],
                },
              },
              AgentRuntimeArtifact: {
                CodeConfiguration: {
                  Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip' } },
                  Runtime: 'PYTHON_3_13',
                  EntryPoint: ['app.py'],
                },
              },
              EnvironmentVariables: { KEY1: 'value1', KEY2: 'value2' },
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
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/EnvironmentVariables',
        value: { KEY1: 'value1', KEY2: 'value2' },
      }]),
    });
  });

  test('hotswaps a RoleArn change via Cloud Control API (all properties are hotswappable via CCAPI)', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
            AgentRuntimeId: 'my-runtime',
            RuntimeName: 'my-runtime',
            RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
            NetworkConfiguration: {
              NetworkMode: 'VPC',
              NetworkModeConfig: {
                Subnets: ['subnet-1', 'subnet-2'],
                SecurityGroups: ['sg-1'],
              },
            },
            AgentRuntimeArtifact: {
              CodeConfiguration: {
                Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip' } },
                Runtime: 'PYTHON_3_13',
                EntryPoint: ['app.py'],
              },
            },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Runtime', 'AWS::BedrockAgentCore::Runtime', 'my-runtime'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Runtime: {
            Type: 'AWS::BedrockAgentCore::Runtime',
            Properties: {
              AgentRuntimeId: 'my-runtime',
              RuntimeName: 'my-runtime',
              RoleArn: 'arn:aws:iam::123456789012:role/DifferentRole',
              NetworkConfiguration: {
                NetworkMode: 'VPC',
                NetworkModeConfig: {
                  Subnets: ['subnet-1', 'subnet-2'],
                  SecurityGroups: ['sg-1'],
                },
              },
              AgentRuntimeArtifact: {
                CodeConfiguration: {
                  Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip' } },
                  Runtime: 'PYTHON_3_13',
                  EntryPoint: ['app.py'],
                },
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
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/RoleArn',
        value: 'arn:aws:iam::123456789012:role/DifferentRole',
      }]),
    });
  });

  test('calls Cloud Control updateResource with S3 versionId when specified', async () => {
    // GIVEN
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify({
          AgentRuntimeId: 'my-runtime',
          RuntimeName: 'my-runtime',
          RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
          NetworkConfiguration: {
            NetworkMode: 'VPC',
            NetworkModeConfig: {
              Subnets: ['subnet-1', 'subnet-2'],
              SecurityGroups: ['sg-1'],
            },
          },
          AgentRuntimeArtifact: {
            CodeConfiguration: {
              Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip', VersionId: 'v1' } },
              Runtime: 'PYTHON_3_13',
              EntryPoint: ['app.py'],
            },
          },
        }),
      },
    });

    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
            AgentRuntimeId: 'my-runtime',
            RuntimeName: 'my-runtime',
            RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
            NetworkConfiguration: {
              NetworkMode: 'VPC',
              NetworkModeConfig: {
                Subnets: ['subnet-1', 'subnet-2'],
                SecurityGroups: ['sg-1'],
              },
            },
            AgentRuntimeArtifact: {
              CodeConfiguration: {
                Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip', VersionId: 'v1' } },
                Runtime: 'PYTHON_3_13',
                EntryPoint: ['app.py'],
              },
            },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Runtime', 'AWS::BedrockAgentCore::Runtime', 'my-runtime'),
    );
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Runtime: {
            Type: 'AWS::BedrockAgentCore::Runtime',
            Properties: {
              AgentRuntimeId: 'my-runtime',
              RuntimeName: 'my-runtime',
              RoleArn: 'arn:aws:iam::123456789012:role/MyRole',
              NetworkConfiguration: {
                NetworkMode: 'VPC',
                NetworkModeConfig: {
                  Subnets: ['subnet-1', 'subnet-2'],
                  SecurityGroups: ['sg-1'],
                },
              },
              AgentRuntimeArtifact: {
                CodeConfiguration: {
                  Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip', VersionId: 'v2' } },
                  Runtime: 'PYTHON_3_13',
                  EntryPoint: ['app.py'],
                },
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
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify([{
        op: 'replace',
        path: '/AgentRuntimeArtifact',
        value: {
          CodeConfiguration: {
            Code: { S3: { Bucket: 'my-bucket', Prefix: 'code.zip', VersionId: 'v2' } },
            Runtime: 'PYTHON_3_13',
            EntryPoint: ['app.py'],
          },
        },
      }]),
    });
  });
});
