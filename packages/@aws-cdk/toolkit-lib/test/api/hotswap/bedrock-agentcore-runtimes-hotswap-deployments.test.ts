import { GetResourceCommand, UpdateResourceCommand } from '@aws-sdk/client-cloudcontrol';
import { HotswapMode } from '../../../lib/api/hotswap';
import { mockCloudControlClient } from '../../_helpers/mock-sdk';
import * as setup from '../_helpers/hotswap-test-setup';

let hotswapMockSdkProvider: setup.HotswapMockSdkProvider;

const defaultCurrentProperties = {
  AgentRuntimeId: 'my-runtime',
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
};

beforeEach(() => {
  hotswapMockSdkProvider = setup.setupHotswapTests();
  mockCloudControlClient.on(GetResourceCommand).resolves({
    ResourceDescription: {
      Properties: JSON.stringify(defaultCurrentProperties),
    },
  });
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
  test('calls the updateResource() API when it receives only an S3 code difference in a Runtime', async () => {
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
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify(Object.entries({
        ...defaultCurrentProperties,
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
      }).map(([key, value]) => ({ op: 'replace', path: `/${key}`, value }))),
    });
  });

  test('calls the updateResource() API when it receives only a container image difference in a Runtime', async () => {
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
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify(Object.entries({
        ...defaultCurrentProperties,
        AgentRuntimeArtifact: {
          ContainerConfiguration: {
            ContainerUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:new-tag',
          },
        },
      }).map(([key, value]) => ({ op: 'replace', path: `/${key}`, value }))),
    });
  });

  test('calls the updateResource() API when it receives only a description change', async () => {
    // GIVEN
    const currentPropsWithDescription = {
      ...defaultCurrentProperties,
      Description: 'Old description',
    };
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
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify(currentPropsWithDescription),
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
      PatchDocument: JSON.stringify(Object.entries({
        ...currentPropsWithDescription,
        Description: 'New description',
      }).map(([key, value]) => ({ op: 'replace', path: `/${key}`, value }))),
    });
  });

  test('calls the updateResource() API when it receives only environment variables changes', async () => {
    // GIVEN
    const currentPropsWithEnvVars = {
      ...defaultCurrentProperties,
      EnvironmentVariables: {
        KEY1: 'value1',
      },
    };
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
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: {
        Properties: JSON.stringify(currentPropsWithEnvVars),
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
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify(Object.entries({
        ...currentPropsWithEnvVars,
        EnvironmentVariables: {
          KEY1: 'value1',
          KEY2: 'value2',
        },
      }).map(([key, value]) => ({ op: 'replace', path: `/${key}`, value }))),
    });
  });

  test('does not call the updateResource() API when a non-hotswappable property changes', async () => {
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
    expect(mockCloudControlClient).not.toHaveReceivedCommand(UpdateResourceCommand);
  });

  test('calls the updateResource() API with S3 versionId when specified', async () => {
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
    expect(mockCloudControlClient).toHaveReceivedCommandWith(UpdateResourceCommand, {
      TypeName: 'AWS::BedrockAgentCore::Runtime',
      Identifier: 'my-runtime',
      PatchDocument: JSON.stringify(Object.entries({
        ...defaultCurrentProperties,
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
      }).map(([key, value]) => ({ op: 'replace', path: `/${key}`, value }))),
    });
  });
});
