import { DescribeServicesCommand, RegisterTaskDefinitionCommand, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { Settings } from '../../../lib/api';
import { EcsHotswapProperties, HotswapMode, HotswapPropertyOverrides } from '../../../lib/api/hotswap';
import { mockECSClient } from '../../_helpers/mock-sdk';
import * as setup from '../_helpers/hotswap-test-setup';

let hotswapMockSdkProvider: setup.HotswapMockSdkProvider;

beforeEach(() => {
  hotswapMockSdkProvider = setup.setupHotswapTests();
  mockECSClient
    .on(UpdateServiceCommand)
    .resolves({
      service: {
        clusterArn: 'arn:aws:ecs:region:account:service/my-cluster',
        serviceArn: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
      },
    })
    .on(DescribeServicesCommand)
    .resolves({
      services: [
        {
          deployments: [
            {
              desiredCount: 1,
              runningCount: 1,
            },
          ],
        },
      ],
    });
});

describe.each([HotswapMode.FALL_BACK, HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
  test(
    'should call registerTaskDefinition and updateService for a difference only in the TaskDefinition with a Family property',
    async () => {
      // GIVEN
      setup.setCurrentCfnStackTemplate({
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              Family: 'my-task-def',
              ContainerDefinitions: [{ Image: 'image1' }],
            },
          },
          Service: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: { Ref: 'TaskDef' },
            },
          },
        },
      });
      setup.pushStackResourceSummaries(
        setup.stackSummaryOf(
          'Service',
          'AWS::ECS::Service',
          'arn:aws:ecs:region:account:service/my-cluster/my-service',
        ),
      );
      mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        },
      });
      const cdkStackArtifact = setup.cdkStackArtifactOf({
        template: {
          Resources: {
            TaskDef: {
              Type: 'AWS::ECS::TaskDefinition',
              Properties: {
                Family: 'my-task-def',
                ContainerDefinitions: [{ Image: 'image2' }],
              },
            },
            Service: {
              Type: 'AWS::ECS::Service',
              Properties: {
                TaskDefinition: { Ref: 'TaskDef' },
              },
            },
          },
        },
      });

      // WHEN
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

      // THEN
      expect(deployStackResult).not.toBeUndefined();
      expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
        family: 'my-task-def',
        containerDefinitions: [{ image: 'image2' }],
      });

      expect(mockECSClient).toHaveReceivedCommandWith(UpdateServiceCommand, {
        service: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
        cluster: 'my-cluster',
        taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        deploymentConfiguration: {
          minimumHealthyPercent: 0,
        },
        forceNewDeployment: true,
      });
    },
  );

  test(
    'any other TaskDefinition property change besides ContainerDefinition cannot be hotswapped in CLASSIC mode but does not block HOTSWAP_ONLY mode deployments',
    async () => {
      // GIVEN
      setup.setCurrentCfnStackTemplate({
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              Family: 'my-task-def',
              ContainerDefinitions: [{ Image: 'image1' }],
              Cpu: '256',
            },
          },
          Service: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: { Ref: 'TaskDef' },
            },
          },
        },
      });
      setup.pushStackResourceSummaries(
        setup.stackSummaryOf(
          'Service',
          'AWS::ECS::Service',
          'arn:aws:ecs:region:account:service/my-cluster/my-service',
        ),
      );
      mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        },
      });
      const cdkStackArtifact = setup.cdkStackArtifactOf({
        template: {
          Resources: {
            TaskDef: {
              Type: 'AWS::ECS::TaskDefinition',
              Properties: {
                Family: 'my-task-def',
                ContainerDefinitions: [{ Image: 'image2' }],
                Cpu: '512',
              },
            },
            Service: {
              Type: 'AWS::ECS::Service',
              Properties: {
                TaskDefinition: { Ref: 'TaskDef' },
              },
            },
          },
        },
      });

      if (hotswapMode === HotswapMode.FALL_BACK) {
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

        // THEN
        expect(deployStackResult).toBeUndefined();
        expect(mockECSClient).not.toHaveReceivedCommand(RegisterTaskDefinitionCommand);
        expect(mockECSClient).not.toHaveReceivedCommand(UpdateServiceCommand);
      } else if (hotswapMode === HotswapMode.HOTSWAP_ONLY) {
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
          family: 'my-task-def',
          containerDefinitions: [{ image: 'image2' }],
          cpu: '256', // this uses the old value because a new value could cause a service replacement
        });
        expect(mockECSClient).toHaveReceivedCommandWith(UpdateServiceCommand, {
          service: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
          cluster: 'my-cluster',
          taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
          deploymentConfiguration: {
            minimumHealthyPercent: 0,
          },
          forceNewDeployment: true,
        });
      }
    },
  );

  test(
    'deleting any other TaskDefinition property besides ContainerDefinition results in a full deployment in CLASSIC mode and a hotswap deployment in HOTSWAP_ONLY mode',
    async () => {
      // GIVEN
      setup.setCurrentCfnStackTemplate({
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              Family: 'my-task-def',
              ContainerDefinitions: [{ Image: 'image1' }],
              Cpu: '256',
            },
          },
          Service: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: { Ref: 'TaskDef' },
            },
          },
        },
      });
      setup.pushStackResourceSummaries(
        setup.stackSummaryOf(
          'Service',
          'AWS::ECS::Service',
          'arn:aws:ecs:region:account:service/my-cluster/my-service',
        ),
      );
      mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        },
      });
      const cdkStackArtifact = setup.cdkStackArtifactOf({
        template: {
          Resources: {
            TaskDef: {
              Type: 'AWS::ECS::TaskDefinition',
              Properties: {
                Family: 'my-task-def',
                ContainerDefinitions: [{ Image: 'image2' }],
              },
            },
            Service: {
              Type: 'AWS::ECS::Service',
              Properties: {
                TaskDefinition: { Ref: 'TaskDef' },
              },
            },
          },
        },
      });

      if (hotswapMode === HotswapMode.FALL_BACK) {
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

        // THEN
        expect(deployStackResult).toBeUndefined();
        expect(mockECSClient).not.toHaveReceivedCommand(RegisterTaskDefinitionCommand);
        expect(mockECSClient).not.toHaveReceivedCommand(UpdateServiceCommand);
      } else if (hotswapMode === HotswapMode.HOTSWAP_ONLY) {
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
          family: 'my-task-def',
          containerDefinitions: [{ image: 'image2' }],
          cpu: '256', // this uses the old value because a new value could cause a service replacement
        });
        expect(mockECSClient).toHaveReceivedCommandWith(UpdateServiceCommand, {
          service: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
          cluster: 'my-cluster',
          taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
          deploymentConfiguration: {
            minimumHealthyPercent: 0,
          },
          forceNewDeployment: true,
        });
      }
    },
  );

  test(
    'should call registerTaskDefinition and updateService for a difference only in the TaskDefinition without a Family property',
    async () => {
      // GIVEN
      setup.setCurrentCfnStackTemplate({
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              ContainerDefinitions: [{ Image: 'image1' }],
            },
          },
          Service: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: { Ref: 'TaskDef' },
            },
          },
        },
      });
      setup.pushStackResourceSummaries(
        setup.stackSummaryOf(
          'TaskDef',
          'AWS::ECS::TaskDefinition',
          'arn:aws:ecs:region:account:task-definition/my-task-def:2',
        ),
        setup.stackSummaryOf(
          'Service',
          'AWS::ECS::Service',
          'arn:aws:ecs:region:account:service/my-cluster/my-service',
        ),
      );
      mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        },
      });
      const cdkStackArtifact = setup.cdkStackArtifactOf({
        template: {
          Resources: {
            TaskDef: {
              Type: 'AWS::ECS::TaskDefinition',
              Properties: {
                ContainerDefinitions: [{ Image: 'image2' }],
              },
            },
            Service: {
              Type: 'AWS::ECS::Service',
              Properties: {
                TaskDefinition: { Ref: 'TaskDef' },
              },
            },
          },
        },
      });

      // WHEN
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

      // THEN
      expect(deployStackResult).not.toBeUndefined();
      expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
        family: 'my-task-def',
        containerDefinitions: [{ image: 'image2' }],
      });
      expect(mockECSClient).toHaveReceivedCommandWith(UpdateServiceCommand, {
        service: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
        cluster: 'my-cluster',
        taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        deploymentConfiguration: {
          minimumHealthyPercent: 0,
        },
        forceNewDeployment: true,
      });
    },
  );

  test(
    'a difference just in a TaskDefinition, without any services using it, is not hotswappable in FALL_BACK mode',
    async () => {
      // GIVEN
      setup.setCurrentCfnStackTemplate({
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              ContainerDefinitions: [{ Image: 'image1' }],
            },
          },
        },
      });
      setup.pushStackResourceSummaries(
        setup.stackSummaryOf(
          'TaskDef',
          'AWS::ECS::TaskDefinition',
          'arn:aws:ecs:region:account:task-definition/my-task-def:2',
        ),
      );
      mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        },
      });
      const cdkStackArtifact = setup.cdkStackArtifactOf({
        template: {
          Resources: {
            TaskDef: {
              Type: 'AWS::ECS::TaskDefinition',
              Properties: {
                ContainerDefinitions: [{ Image: 'image2' }],
              },
            },
          },
        },
      });

      if (hotswapMode === HotswapMode.FALL_BACK) {
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

        // THEN
        expect(deployStackResult).toBeUndefined();
        expect(mockECSClient).not.toHaveReceivedCommand(RegisterTaskDefinitionCommand);
        expect(mockECSClient).not.toHaveReceivedCommand(UpdateServiceCommand);
      } else if (hotswapMode === HotswapMode.HOTSWAP_ONLY) {
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
          family: 'my-task-def',
          containerDefinitions: [{ image: 'image2' }],
        });

        expect(mockECSClient).not.toHaveReceivedCommand(UpdateServiceCommand);
      }
    },
  );

  test(
    'if anything besides an ECS Service references the changed TaskDefinition, hotswapping is not possible in CLASSIC mode but is possible in HOTSWAP_ONLY',
    async () => {
      // GIVEN
      setup.setCurrentCfnStackTemplate({
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              Family: 'my-task-def',
              ContainerDefinitions: [{ Image: 'image1' }],
            },
          },
          Service: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: { Ref: 'TaskDef' },
            },
          },
          Function: {
            Type: 'AWS::Lambda::Function',
            Properties: {
              Environment: {
                Variables: {
                  TaskDefRevArn: { Ref: 'TaskDef' },
                },
              },
            },
          },
        },
      });
      setup.pushStackResourceSummaries(
        setup.stackSummaryOf(
          'Service',
          'AWS::ECS::Service',
          'arn:aws:ecs:region:account:service/my-cluster/my-service',
        ),
      );
      mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        },
      });
      const cdkStackArtifact = setup.cdkStackArtifactOf({
        template: {
          Resources: {
            TaskDef: {
              Type: 'AWS::ECS::TaskDefinition',
              Properties: {
                Family: 'my-task-def',
                ContainerDefinitions: [{ Image: 'image2' }],
              },
            },
            Service: {
              Type: 'AWS::ECS::Service',
              Properties: {
                TaskDefinition: { Ref: 'TaskDef' },
              },
            },
            Function: {
              Type: 'AWS::Lambda::Function',
              Properties: {
                Environment: {
                  Variables: {
                    TaskDefRevArn: { Ref: 'TaskDef' },
                  },
                },
              },
            },
          },
        },
      });

      if (hotswapMode === HotswapMode.FALL_BACK) {
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

        // THEN
        expect(deployStackResult).toBeUndefined();
        expect(mockECSClient).not.toHaveReceivedCommand(RegisterTaskDefinitionCommand);
        expect(mockECSClient).not.toHaveReceivedCommand(UpdateServiceCommand);
      } else if (hotswapMode === HotswapMode.HOTSWAP_ONLY) {
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
          family: 'my-task-def',
          containerDefinitions: [{ image: 'image2' }],
        });
        expect(mockECSClient).toHaveReceivedCommandWith(UpdateServiceCommand, {
          service: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
          cluster: 'my-cluster',
          taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
          deploymentConfiguration: {
            minimumHealthyPercent: 0,
          },
          forceNewDeployment: true,
        });
      }
    },
  );

  test('should call registerTaskDefinition with certain properties not lowercased', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        TaskDef: {
          Type: 'AWS::ECS::TaskDefinition',
          Properties: {
            Family: 'my-task-def',
            ContainerDefinitions: [{ Image: 'image1' }],
            Volumes: [
              {
                DockerVolumeConfiguration: {
                  DriverOpts: { Option1: 'option1' },
                  Labels: { Label1: 'label1' },
                },
              },
            ],
          },
        },
        Service: {
          Type: 'AWS::ECS::Service',
          Properties: {
            TaskDefinition: { Ref: 'TaskDef' },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Service', 'AWS::ECS::Service', 'arn:aws:ecs:region:account:service/my-cluster/my-service'),
    );
    mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
      taskDefinition: {
        taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              Family: 'my-task-def',
              ContainerDefinitions: [
                {
                  Image: 'image2',
                  DockerLabels: { Label1: 'label1' },
                  FirelensConfiguration: {
                    Options: { Name: 'cloudwatch' },
                  },
                  LogConfiguration: {
                    Options: { Option1: 'option1' },
                  },
                },
              ],
              Volumes: [
                {
                  DockerVolumeConfiguration: {
                    DriverOpts: { Option1: 'option1' },
                    Labels: { Label1: 'label1' },
                  },
                },
              ],
            },
          },
          Service: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: { Ref: 'TaskDef' },
            },
          },
        },
      },
    });

    // WHEN
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
      family: 'my-task-def',
      containerDefinitions: [
        {
          image: 'image2',
          dockerLabels: { Label1: 'label1' },
          firelensConfiguration: {
            options: {
              Name: 'cloudwatch',
            },
          },
          logConfiguration: {
            options: { Option1: 'option1' },
          },
        },
      ],
      volumes: [
        {
          dockerVolumeConfiguration: {
            driverOpts: { Option1: 'option1' },
            labels: { Label1: 'label1' },
          },
        },
      ],
    });
    expect(mockECSClient).toHaveReceivedCommandWith(UpdateServiceCommand, {
      service: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
      cluster: 'my-cluster',
      taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
      deploymentConfiguration: {
        minimumHealthyPercent: 0,
      },
      forceNewDeployment: true,
    });
  });

  test(
    'should correctly transform ProxyConfiguration.ProxyConfigurationProperties to proxyConfiguration.properties',
    async () => {
      // GIVEN
      setup.setCurrentCfnStackTemplate({
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              Family: 'my-task-def',
              ContainerDefinitions: [{ Image: 'image1' }],
              ProxyConfiguration: {
                ContainerName: 'FargateApplication',
                ProxyConfigurationProperties: [
                  { Name: 'AppPorts', Value: '8080' },
                  { Name: 'IgnoredUID', Value: '1337' },
                ],
                Type: 'APPMESH',
              },
            },
          },
          Service: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: { Ref: 'TaskDef' },
            },
          },
        },
      });
      setup.pushStackResourceSummaries(
        setup.stackSummaryOf(
          'Service',
          'AWS::ECS::Service',
          'arn:aws:ecs:region:account:service/my-cluster/my-service',
        ),
      );
      mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
        taskDefinition: {
          taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        },
      });
      const cdkStackArtifact = setup.cdkStackArtifactOf({
        template: {
          Resources: {
            TaskDef: {
              Type: 'AWS::ECS::TaskDefinition',
              Properties: {
                Family: 'my-task-def',
                ContainerDefinitions: [{ Image: 'image2' }],
                ProxyConfiguration: {
                  ContainerName: 'FargateApplication',
                  ProxyConfigurationProperties: [
                    { Name: 'AppPorts', Value: '8080' },
                    { Name: 'IgnoredUID', Value: '1337' },
                  ],
                  Type: 'APPMESH',
                },
              },
            },
            Service: {
              Type: 'AWS::ECS::Service',
              Properties: {
                TaskDefinition: { Ref: 'TaskDef' },
              },
            },
          },
        },
      });
      // WHEN
      const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
      // THEN
      expect(deployStackResult).not.toBeUndefined();
      expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
        family: 'my-task-def',
        containerDefinitions: [{ image: 'image2' }],
        proxyConfiguration: {
          containerName: 'FargateApplication',
          properties: [
            { name: 'AppPorts', value: '8080' },
            { name: 'IgnoredUID', value: '1337' },
          ],
          type: 'APPMESH',
        },
      });
      expect(mockECSClient).toHaveReceivedCommandWith(UpdateServiceCommand, {
        service: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
        cluster: 'my-cluster',
        taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        deploymentConfiguration: {
          minimumHealthyPercent: 0,
        },
        forceNewDeployment: true,
      });
    },
  );
});

describe.each([
  new Settings().set(['hotswap'], { ecs: { minimumHealthyPercent: 10 } }),
  new Settings().set(['hotswap'], { ecs: { minimumHealthyPercent: 10, maximumHealthyPercent: 100 } }),
])('hotswap properties', (settings) => {
  test('should handle all possible hotswap properties', async () => {
    // GIVEN
    setup.setCurrentCfnStackTemplate({
      Resources: {
        TaskDef: {
          Type: 'AWS::ECS::TaskDefinition',
          Properties: {
            Family: 'my-task-def',
            ContainerDefinitions: [
              { Image: 'image1' },
            ],
          },
        },
        Service: {
          Type: 'AWS::ECS::Service',
          Properties: {
            TaskDefinition: { Ref: 'TaskDef' },
          },
        },
      },
    });
    setup.pushStackResourceSummaries(
      setup.stackSummaryOf('Service', 'AWS::ECS::Service',
        'arn:aws:ecs:region:account:service/my-cluster/my-service'),
    );
    mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
      taskDefinition: {
        taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
      },
    });
    const cdkStackArtifact = setup.cdkStackArtifactOf({
      template: {
        Resources: {
          TaskDef: {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: {
              Family: 'my-task-def',
              ContainerDefinitions: [
                { Image: 'image2' },
              ],
            },
          },
          Service: {
            Type: 'AWS::ECS::Service',
            Properties: {
              TaskDefinition: { Ref: 'TaskDef' },
            },
          },
        },
      },
    });

    // WHEN
    let ecsHotswapProperties = new EcsHotswapProperties(settings.get(['hotswap']).ecs.minimumHealthyPercent, settings.get(['hotswap']).ecs.maximumHealthyPercent);
    const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(
      HotswapMode.HOTSWAP_ONLY,
      cdkStackArtifact,
      {},
      new HotswapPropertyOverrides(ecsHotswapProperties),
    );

    // THEN
    expect(deployStackResult).not.toBeUndefined();
    expect(mockECSClient).toHaveReceivedCommandWith(RegisterTaskDefinitionCommand, {
      family: 'my-task-def',
      containerDefinitions: [
        { image: 'image2' },
      ],
    });
    expect(mockECSClient).toHaveReceivedCommandWith(UpdateServiceCommand, {
      service: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
      cluster: 'my-cluster',
      taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
      deploymentConfiguration: {
        minimumHealthyPercent: settings.get(['hotswap']).ecs?.minimumHealthyPercent == undefined ?
          0 : settings.get(['hotswap']).ecs?.minimumHealthyPercent,
        maximumPercent: settings.get(['hotswap']).ecs?.maximumHealthyPercent,
      },
      forceNewDeployment: true,
    });
    expect(mockECSClient).toHaveReceivedCommandWith(DescribeServicesCommand, {
      cluster: 'arn:aws:ecs:region:account:service/my-cluster',
      services: ['arn:aws:ecs:region:account:service/my-cluster/my-service'],
    });
  });
});

test.each([
  // default case
  [101, undefined],
  [2, 10],
  [11, 60],
])('DesribeService is called %p times when timeout is %p', async (describeAttempts: number, timeoutSeconds?: number) => {
  setup.setCurrentCfnStackTemplate({
    Resources: {
      TaskDef: {
        Type: 'AWS::ECS::TaskDefinition',
        Properties: {
          Family: 'my-task-def',
          ContainerDefinitions: [
            { Image: 'image1' },
          ],
        },
      },
      Service: {
        Type: 'AWS::ECS::Service',
        Properties: {
          TaskDefinition: { Ref: 'TaskDef' },
        },
      },
    },
  });
  setup.pushStackResourceSummaries(
    setup.stackSummaryOf('Service', 'AWS::ECS::Service',
      'arn:aws:ecs:region:account:service/my-cluster/my-service'),
  );
  mockECSClient.on(RegisterTaskDefinitionCommand).resolves({
    taskDefinition: {
      taskDefinitionArn: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
    },
  });
  const cdkStackArtifact = setup.cdkStackArtifactOf({
    template: {
      Resources: {
        TaskDef: {
          Type: 'AWS::ECS::TaskDefinition',
          Properties: {
            Family: 'my-task-def',
            ContainerDefinitions: [
              { Image: 'image2' },
            ],
          },
        },
        Service: {
          Type: 'AWS::ECS::Service',
          Properties: {
            TaskDefinition: { Ref: 'TaskDef' },
          },
        },
      },
    },
  });

  // WHEN
  let ecsHotswapProperties = new EcsHotswapProperties(undefined, undefined, timeoutSeconds);
  // mock the client such that the service never becomes stable using desiredCount > runningCount
  mockECSClient.on(DescribeServicesCommand).resolves({
    services: [
      {
        serviceArn: 'arn:aws:ecs:region:account:service/my-cluster/my-service',
        taskDefinition: 'arn:aws:ecs:region:account:task-definition/my-task-def:3',
        desiredCount: 1,
        runningCount: 0,
      },
    ],
  });

  jest.useFakeTimers();
  jest.spyOn(global, 'setTimeout').mockImplementation((callback, ms) => {
    callback();
    jest.advanceTimersByTime(ms ?? 0);
    return {} as NodeJS.Timeout;
  });

  await expect(hotswapMockSdkProvider.tryHotswapDeployment(
    HotswapMode.HOTSWAP_ONLY,
    cdkStackArtifact,
    {},
    new HotswapPropertyOverrides(ecsHotswapProperties),
  )).rejects.toThrow('Resource is not in the expected state due to waiter status');

  // THEN
  expect(mockECSClient).toHaveReceivedCommandTimes(DescribeServicesCommand, describeAttempts);
});
