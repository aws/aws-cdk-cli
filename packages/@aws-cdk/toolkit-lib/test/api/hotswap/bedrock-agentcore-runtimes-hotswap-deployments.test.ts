import { GetAgentRuntimeCommand, UpdateAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore-control';
import { HotswapMode } from '../../../lib/api/hotswap';
import { mockBedrockAgentCoreControlClient } from '../../_helpers/mock-sdk';
import * as setup from '../_helpers/hotswap-test-setup';

let hotswapMockSdkProvider: setup.HotswapMockSdkProvider;

beforeEach(() => {
  hotswapMockSdkProvider = setup.setupHotswapTests();
  mockBedrockAgentCoreControlClient.on(GetAgentRuntimeCommand).resolves({
    agentRuntimeId: 'my-runtime',
    roleArn: 'arn:aws:iam::123456789012:role/MyRole',
    networkConfiguration: {
      networkMode: 'VPC',
      networkModeConfig: {
        subnets: ['subnet-1', 'subnet-2'],
        securityGroups: ['sg-1'],
      },
    },
    agentRuntimeArtifact: {
      codeConfiguration: {
        code: {
          s3: {
            bucket: 'my-bucket',
            prefix: 'code.zip',
          },
        },
        runtime: 'PYTHON_3_13',
        entryPoint: ['app.py'],
      },
    },
  });
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
  test('calls the updateAgentRuntime() API when it receives only an S3 code difference in a Runtime', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
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
    expect(mockBedrockAgentCoreControlClient).toHaveReceivedCommandWith(UpdateAgentRuntimeCommand, {
      agentRuntimeId: 'my-runtime',
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: {
            s3: {
              bucket: 'my-bucket',
              prefix: 'new-code.zip',
            },
          },
          runtime: 'PYTHON_3_13',
          entryPoint: ['app.py'],
        },
      },
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      networkConfiguration: {
        networkMode: 'VPC',
        networkModeConfig: {
          subnets: ['subnet-1', 'subnet-2'],
          securityGroups: ['sg-1'],
        },
      },
    });
  });

  test('calls the updateAgentRuntime() API when it receives only a container image difference in a Runtime', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
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
    expect(mockBedrockAgentCoreControlClient).toHaveReceivedCommandWith(UpdateAgentRuntimeCommand, {
      agentRuntimeId: 'my-runtime',
      agentRuntimeArtifact: {
        containerConfiguration: {
          containerUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:new-tag',
        },
      },
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      networkConfiguration: {
        networkMode: 'VPC',
        networkModeConfig: {
          subnets: ['subnet-1', 'subnet-2'],
          securityGroups: ['sg-1'],
        },
      },
    });
  });

  test('calls the updateAgentRuntime() API when it receives only a description change', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
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
            Description: 'Old description',
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Runtime', 'AWS::BedrockAgentCore::Runtime', 'my-runtime'),
    );
    mockBedrockAgentCoreControlClient.on(GetAgentRuntimeCommand).resolves({
      agentRuntimeId: 'my-runtime',
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      networkConfiguration: {
        networkMode: 'VPC',
        networkModeConfig: {
          subnets: ['subnet-1', 'subnet-2'],
          securityGroups: ['sg-1'],
        },
      },
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: {
            s3: {
              bucket: 'my-bucket',
              prefix: 'code.zip',
            },
          },
          runtime: 'PYTHON_3_13',
          entryPoint: ['app.py'],
        },
      },
      description: 'Old description',
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Runtime: {
            Type: 'AWS::BedrockAgentCore::Runtime',
            Properties: {
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
    expect(mockBedrockAgentCoreControlClient).toHaveReceivedCommandWith(UpdateAgentRuntimeCommand, {
      agentRuntimeId: 'my-runtime',
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: {
            s3: {
              bucket: 'my-bucket',
              prefix: 'code.zip',
            },
          },
          runtime: 'PYTHON_3_13',
          entryPoint: ['app.py'],
        },
      },
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      networkConfiguration: {
        networkMode: 'VPC',
        networkModeConfig: {
          subnets: ['subnet-1', 'subnet-2'],
          securityGroups: ['sg-1'],
        },
      },
      description: 'New description',
    });
  });

  test('calls the updateAgentRuntime() API when it receives only environment variables changes', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
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
            EnvironmentVariables: {
              KEY1: 'value1',
            },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Runtime', 'AWS::BedrockAgentCore::Runtime', 'my-runtime'),
    );
    mockBedrockAgentCoreControlClient.on(GetAgentRuntimeCommand).resolves({
      agentRuntimeId: 'my-runtime',
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      networkConfiguration: {
        networkMode: 'VPC',
        networkModeConfig: {
          subnets: ['subnet-1', 'subnet-2'],
          securityGroups: ['sg-1'],
        },
      },
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: {
            s3: {
              bucket: 'my-bucket',
              prefix: 'code.zip',
            },
          },
          runtime: 'PYTHON_3_13',
          entryPoint: ['app.py'],
        },
      },
      environmentVariables: {
        KEY1: 'value1',
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          Runtime: {
            Type: 'AWS::BedrockAgentCore::Runtime',
            Properties: {
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
              EnvironmentVariables: {
                KEY1: 'value1',
                KEY2: 'value2',
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
    expect(mockBedrockAgentCoreControlClient).toHaveReceivedCommandWith(UpdateAgentRuntimeCommand, {
      agentRuntimeId: 'my-runtime',
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: {
            s3: {
              bucket: 'my-bucket',
              prefix: 'code.zip',
            },
          },
          runtime: 'PYTHON_3_13',
          entryPoint: ['app.py'],
        },
      },
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      networkConfiguration: {
        networkMode: 'VPC',
        networkModeConfig: {
          subnets: ['subnet-1', 'subnet-2'],
          securityGroups: ['sg-1'],
        },
      },
      environmentVariables: {
        KEY1: 'value1',
        KEY2: 'value2',
      },
    });
  });

  test('does not call the updateAgentRuntime() API when a non-hotswappable property changes', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
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
              RuntimeName: 'my-runtime',
              RoleArn: 'arn:aws:iam::123456789012:role/DifferentRole', // non-hotswappable change
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
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    if (hotswapMode === HotswapMode.FALL_BACK) {
      expect(deployStackResult).toBeUndefined();
    } else {
      expect(deployStackResult).not.toBeUndefined();
    }
    expect(mockBedrockAgentCoreControlClient).not.toHaveReceivedCommand(UpdateAgentRuntimeCommand);
  });

  test('calls the updateAgentRuntime() API with S3 versionId when specified', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        Runtime: {
          Type: 'AWS::BedrockAgentCore::Runtime',
          Properties: {
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
                    VersionId: 'v1',
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
                      VersionId: 'v2',
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
    expect(mockBedrockAgentCoreControlClient).toHaveReceivedCommandWith(UpdateAgentRuntimeCommand, {
      agentRuntimeId: 'my-runtime',
      agentRuntimeArtifact: {
        codeConfiguration: {
          code: {
            s3: {
              bucket: 'my-bucket',
              prefix: 'code.zip',
              versionId: 'v2',
            },
          },
          runtime: 'PYTHON_3_13',
          entryPoint: ['app.py'],
        },
      },
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      networkConfiguration: {
        networkMode: 'VPC',
        networkModeConfig: {
          subnets: ['subnet-1', 'subnet-2'],
          securityGroups: ['sg-1'],
        },
      },
    });
  });
});
