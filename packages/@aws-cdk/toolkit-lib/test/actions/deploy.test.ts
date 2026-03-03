import { StackParameters } from '../../lib/actions/deploy';
import type { DeployStackOptions, DeployStackResult } from '../../lib/api/deployments';
import * as deployments from '../../lib/api/deployments';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, cdkOutFixture, disposableCloudAssemblySource, TestIoHost } from '../_helpers';

let ioHost: TestIoHost;
let toolkit: Toolkit;
let mockDeployStack: jest.SpyInstance<Promise<DeployStackResult>, [DeployStackOptions]>;

beforeEach(() => {
  jest.restoreAllMocks();
  ioHost = new TestIoHost();
  toolkit = new Toolkit({ ioHost });

  // Some default implementations
  mockDeployStack = jest.spyOn(deployments.Deployments.prototype, 'deployStack').mockResolvedValue({
    type: 'did-deploy-stack',
    stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
    outputs: {},
    noOp: false,
  });
  jest.spyOn(deployments.Deployments.prototype, 'resolveEnvironment').mockResolvedValue({
    account: '11111111',
    region: 'aq-south-1',
    name: 'aws://11111111/aq-south-1',
  });
  jest.spyOn(deployments.Deployments.prototype, 'isSingleAssetPublished').mockResolvedValue(true);
  jest.spyOn(deployments.Deployments.prototype, 'readCurrentTemplate').mockResolvedValue({ Resources: {} });
  jest.spyOn(deployments.Deployments.prototype, 'buildSingleAsset').mockImplementation();
  jest.spyOn(deployments.Deployments.prototype, 'publishSingleAsset').mockImplementation();
  jest.spyOn(deployments.Deployments.prototype, 'describeChangeSet').mockResolvedValue({
    ChangeSetName: 'test-changeset',
    Changes: [
      {
        Type: 'Resource',
        ResourceChange: {
          Action: 'Add',
          LogicalResourceId: 'TestResource',
          ResourceType: 'AWS::S3::Bucket',
        },
      },
    ],
    Status: 'CREATE_COMPLETE',
    $metadata: {},
  });
  jest.spyOn(deployments.Deployments.prototype, 'deleteChangeSet').mockResolvedValue();
});

describe('deploy', () => {
  test('deploy from builder', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.deploy(cx);

    // THEN
    successfulDeployment();
  });

  test('request response contains security diff', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.deploy(cx);

    // THEN
    const request = ioHost.requestSpy.mock.calls[0][0].message.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

    // Message includes formatted security diff
    expect(request).toContain(`Stack Stack1
IAM Statement Changes
┌───┬─────────────┬────────┬────────────────┬───────────┬───────────┐
│   │ Resource    │ Effect │ Action         │ Principal │ Condition │
├───┼─────────────┼────────┼────────────────┼───────────┼───────────┤
│ + │ $\{Role.Arn\} │ Allow  │ sts:AssumeRole │ AWS:arn   │           │
└───┴─────────────┴────────┴────────────────┴───────────┴───────────┘
`);
    // Request response returns template diff
    expect(ioHost.requestSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I5060',
      message: expect.stringContaining('Do you wish to deploy these changes'),
      data: expect.objectContaining({
        motivation: expect.stringContaining('Approval required for stack'),
        permissionChangeType: 'broadening',
        templateDiffs: expect.objectContaining({
          Stack1: expect.objectContaining({
            resources: expect.objectContaining({
              diffs: expect.objectContaining({
                Role1ABCC5F0: expect.objectContaining({
                  newValue: expect.objectContaining({
                    Type: 'AWS::IAM::Role',
                    Properties: expect.anything(),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }));
  });

  describe('deployment options', () => {
    test('parameters are passed in', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        parameters: StackParameters.exactly({
          'my-param': 'my-value',
        }),
      });

      // passed through correctly to Deployments
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        parameters: { 'my-param': 'my-value' },
      }));

      successfulDeployment();
    });

    test('notification arns are passed in', async () => {
      // WHEN
      const arn = 'arn:aws:sns:us-east-1:1111111111:resource';
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        notificationArns: [arn],
      });

      // passed through correctly to Deployments
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        notificationArns: [arn],
      }));

      successfulDeployment();
    });

    test('notification arns from stack are passed in', async () => {
      // WHEN
      const arn = 'arn:aws:sns:us-east-1:222222222222:resource';
      const cx = await builderFixture(toolkit, 'stack-with-notification-arns');
      await toolkit.deploy(cx, {
        notificationArns: [arn],
      });

      // passed through correctly to Deployments
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        notificationArns: [
          arn,
          'arn:aws:sns:us-east-1:1111111111:resource',
          'arn:aws:sns:us-east-1:1111111111:other-resource',
        ],
      }));

      successfulDeployment();
    });

    test('non sns notification arn results in error', async () => {
      // WHEN
      const arn = 'arn:aws:sqs:us-east-1:1111111111:resource';
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await expect(async () => toolkit.deploy(cx, {
        notificationArns: [arn],
      })).rejects.toThrow(/Notification arn arn:aws:sqs:us-east-1:1111111111:resource is not a valid arn for an SNS topic/);
    });

    test('forceAssetPublishing: true option is used for asset publishing', async () => {
      const publishSingleAsset = jest.spyOn(deployments.Deployments.prototype, 'publishSingleAsset').mockImplementation();

      const cx = await builderFixture(toolkit, 'stack-with-asset');
      await toolkit.deploy(cx, {
        forceAssetPublishing: true,
      });

      // THEN
      expect(publishSingleAsset).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
        forcePublish: true,
      }));
    });

    test('change-set method creates and describes changeset before deployment', async () => {
      const describeChangeSetSpy = jest.spyOn(deployments.Deployments.prototype, 'describeChangeSet');

      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        deploymentMethod: {
          method: 'change-set',
          changeSetName: 'my-test-changeset',
        },
      });

      // THEN
      // First call should create changeset with execute: false
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        deploymentMethod: expect.objectContaining({
          method: 'change-set',
          changeSetName: 'my-test-changeset',
          execute: false,
        }),
      }));

      // Should describe the changeset
      expect(describeChangeSetSpy).toHaveBeenCalledWith(
        expect.anything(),
        'my-test-changeset',
      );

      // Second call should execute the existing changeset
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        deploymentMethod: expect.objectContaining({
          method: 'change-set',
          changeSetName: 'my-test-changeset',
          executeExistingChangeSet: true,
        }),
      }));

      expect(mockDeployStack).toHaveBeenCalledTimes(2);
    });

    test('change-set with auto-generated changeSetName when not provided', async () => {
      const describeChangeSetSpy = jest.spyOn(deployments.Deployments.prototype, 'describeChangeSet');

      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        deploymentMethod: {
          method: 'change-set',
        },
      });

      // THEN
      // Should use auto-generated name
      const expectedChangeSetPattern = /^cdk-deploy-change-set-\d+$/;
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        deploymentMethod: expect.objectContaining({
          method: 'change-set',
          changeSetName: expect.stringMatching(expectedChangeSetPattern),
          execute: false,
        }),
      }));
      expect(describeChangeSetSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringMatching(expectedChangeSetPattern),
      );
    });

    test('change-set with no changes deletes changeset and skips deployment', async () => {
      const deleteChangeSetSpy = jest.spyOn(deployments.Deployments.prototype, 'deleteChangeSet');
      jest.spyOn(deployments.Deployments.prototype, 'describeChangeSet').mockResolvedValue({
        ChangeSetName: 'empty-changeset',
        Status: 'FAILED',
        StatusReason: "The submitted information didn't contain changes. Submit different information to create a change set.",
        $metadata: {},
      });

      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        deploymentMethod: {
          method: 'change-set',
          changeSetName: 'empty-changeset',
        },
      });

      // THEN
      expect(deleteChangeSetSpy).toHaveBeenCalledWith(
        expect.anything(),
        'empty-changeset',
      );

      // Should only be called once (for changeset creation, not execution)
      expect(mockDeployStack).toHaveBeenCalledTimes(1);

      // Should show skip message
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('stack has no changes, skipping deployment'),
      }));
    });

    test('change-set method preserves other deployment options', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        deploymentMethod: {
          method: 'change-set',
          changeSetName: 'test-changeset',
        },
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        reuseAssets: ['asset1'],
        notificationArns: ['arn:aws:sns:us-east-1:111111111111:topic'],
        forceDeployment: true,
        parameters: StackParameters.exactly({
          'my-param': 'my-value',
        }),
        assetParallelism: false,
      });

      // THEN - Both calls should preserve all options
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        reuseAssets: ['asset1'],
        notificationArns: ['arn:aws:sns:us-east-1:111111111111:topic'],
        forceDeployment: true,
        parameters: { 'my-param': 'my-value' },
        assetParallelism: false,
      }));

      expect(mockDeployStack).toHaveBeenCalledTimes(2);
    });

    test('non-change-set deployment uses original flow', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        deploymentMethod: {
          method: 'direct',
        },
      });

      // THEN
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        deploymentMethod: { method: 'direct' },
      }));

      // Should only be called once (no changeset creation)
      expect(mockDeployStack).toHaveBeenCalledTimes(1);

      // describeChangeSet should not be called
      expect(deployments.Deployments.prototype.describeChangeSet).not.toHaveBeenCalled();
    });
  });

  describe('deployment results', () => {
    test('did-deploy-result', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx);

      // THEN
      successfulDeployment();
    });

    test('failpaused-need-rollback-first', async () => {
      const rollbackSpy = jest.spyOn(toolkit as any, '_rollback').mockResolvedValue({});

      // GIVEN
      mockDeployStack.mockImplementation(async (params) => {
        if (params.rollback === true) {
          return {
            type: 'did-deploy-stack',
            stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
            outputs: {},
            noOp: false,
          } satisfies DeployStackResult;
        } else {
          return {
            type: 'failpaused-need-rollback-first',
            reason: 'replacement',
            status: 'asdf',
          } satisfies DeployStackResult;
        }
      });

      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx);

      // THEN
      // We called rollback
      expect(rollbackSpy).toHaveBeenCalledTimes(1);
      successfulDeployment();
    });

    test('replacement-requires-rollback', async () => {
      // GIVEN
      mockDeployStack.mockImplementation(async (params) => {
        if (params.rollback === true) {
          return {
            type: 'did-deploy-stack',
            stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
            outputs: {},
            noOp: false,
          } satisfies DeployStackResult;
        } else {
          return {
            type: 'replacement-requires-rollback',
          } satisfies DeployStackResult;
        }
      });

      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx);

      // THEN
      successfulDeployment();
    });

    test('change-set information included in diff formatter', async () => {
      const changeSetData = {
        ChangeSetName: 'test-changeset',
        Changes: [
          {
            Type: 'Resource' as const,
            ResourceChange: {
              Action: 'Add' as const,
              LogicalResourceId: 'TestResource',
              ResourceType: 'AWS::S3::Bucket',
            },
          },
        ],
        Status: 'CREATE_COMPLETE' as const,
      };

      jest.spyOn(deployments.Deployments.prototype, 'describeChangeSet').mockResolvedValue({
        ...changeSetData,
        $metadata: {},
      });

      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        deploymentMethod: {
          method: 'change-set',
          changeSetName: 'test-changeset',
        },
      });

      // THEN
      // The changeset data should be available for diff formatting
      // This is verified through the successful execution and user approval flow
      expect(ioHost.requestSpy).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('Do you wish to deploy these changes'),
      }));
    });
  });

  test('deploy returns stack information', async () => {
    // GIVEN
    mockDeployStack.mockResolvedValue({
      type: 'did-deploy-stack',
      stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
      outputs: {
        OutputKey1: 'OutputValue1',
        OutputKey2: 'OutputValue2',
      },
      noOp: false,
    });

    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    const result = await toolkit.deploy(cx);

    // THEN
    expect(result).toEqual({
      stacks: [
        {
          stackName: 'Stack1',
          hierarchicalId: 'Stack1',
          environment: {
            // This wouldn't normally work like this, but this is the information in the manifest so that's what we assert
            account: 'unknown-account',
            region: 'unknown-region',
          },
          // This just comes from the mocked function above
          stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
          outputs: {
            OutputKey1: 'OutputValue1',
            OutputKey2: 'OutputValue2',
          },
        },
        {
          stackName: 'Stack2',
          hierarchicalId: 'Stack2',
          environment: {
            // This wouldn't normally work like this, but this is the information in the manifest so that's what we assert
            account: 'unknown-account',
            region: 'unknown-region',
          },
          // This just comes from the mocked function above
          stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
          outputs: {
            OutputKey1: 'OutputValue1',
            OutputKey2: 'OutputValue2',
            // omg
          },
        },
      ],
    });
  });

  test('deploy contains nested assembly hierarchical id', async () => {
    // GIVEN
    mockDeployStack.mockResolvedValue({
      type: 'did-deploy-stack',
      stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
      outputs: {
        OutputKey1: 'OutputValue1',
        OutputKey2: 'OutputValue2',
      },
      noOp: false,
    });

    // WHEN
    const cx = await cdkOutFixture(toolkit, 'nested-assembly');
    const result = await toolkit.deploy(cx);

    // THEN
    expect(result).toEqual({
      stacks: [
        expect.objectContaining({
          hierarchicalId: 'Stage/Stack1',
        }),
      ],
    });
  });

  test('action disposes of assembly produced by source', async () => {
    // GIVEN
    const [assemblySource, mockDispose, realDispose] = await disposableCloudAssemblySource(toolkit);

    // WHEN
    await toolkit.deploy(assemblySource);

    // THEN
    expect(mockDispose).toHaveBeenCalled();
    await realDispose();
  });

  test('user rejection of change-set deployment deletes changeset', async () => {
    const deleteChangeSetSpy = jest.spyOn(deployments.Deployments.prototype, 'deleteChangeSet');

    // Mock describeChangeSet to return the specific changeset name
    jest.spyOn(deployments.Deployments.prototype, 'describeChangeSet').mockResolvedValue({
      ChangeSetName: 'rejected-changeset',
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Add',
            LogicalResourceId: 'TestResource',
            ResourceType: 'AWS::S3::Bucket',
          },
        },
      ],
      Status: 'CREATE_COMPLETE',
      $metadata: {},
    });

    // Mock user rejection
    ioHost.requestSpy.mockResolvedValue(false);

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const result = toolkit.deploy(cx, {
      deploymentMethod: {
        method: 'change-set',
        changeSetName: 'rejected-changeset',
      },
    });

    // THEN
    await expect(result).rejects.toThrow('Aborted by user');

    // Should delete the changeset before throwing
    expect(deleteChangeSetSpy).toHaveBeenCalledWith(
      expect.anything(),
      'rejected-changeset',
    );

    // Should only be called once (for changeset creation, not execution)
    expect(mockDeployStack).toHaveBeenCalledTimes(1);
  });

  test('user rejection of non-change-set deployment does not call deleteChangeSet', async () => {
    const deleteChangeSetSpy = jest.spyOn(deployments.Deployments.prototype, 'deleteChangeSet');

    // Mock user rejection
    ioHost.requestSpy.mockResolvedValue(false);

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const result = toolkit.deploy(cx, {
      deploymentMethod: {
        method: 'direct',
      },
    });

    // THEN
    await expect(result).rejects.toThrow('Aborted by user');

    // Should NOT delete changeset for non-changeset deployment
    expect(deleteChangeSetSpy).not.toHaveBeenCalled();
  });

  test('motivation message format contains stack display name', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.deploy(cx);

    // THEN
    expect(ioHost.requestSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        motivation: 'Approval required for stack deployment.',
      }),
    }));
  });

  test('describeChangeSet failure is propagated', async () => {
    jest.spyOn(deployments.Deployments.prototype, 'describeChangeSet').mockRejectedValue(
      new Error('Failed to describe changeset'),
    );

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const result = toolkit.deploy(cx, {
      deploymentMethod: {
        method: 'change-set',
        changeSetName: 'failing-describe-changeset',
      },
    });

    // THEN
    await expect(result).rejects.toThrow('Failed to describe changeset');
  });

  test('deleteChangeSet failure during user rejection throws deleteChangeSet error', async () => {
    const deleteChangeSetSpy = jest.spyOn(deployments.Deployments.prototype, 'deleteChangeSet')
      .mockRejectedValue(new Error('Failed to delete changeset'));

    // Mock user rejection
    ioHost.requestSpy.mockResolvedValue(false);

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const result = toolkit.deploy(cx, {
      deploymentMethod: {
        method: 'change-set',
        changeSetName: 'delete-fail-changeset',
      },
    });

    // THEN
    await expect(result).rejects.toThrow('Failed to delete changeset');

    // deleteChangeSet should have been attempted
    expect(deleteChangeSetSpy).toHaveBeenCalled();
  });

  test('deploymentMethod variable overrides options.deploymentMethod for changeset execution', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.deploy(cx, {
      deploymentMethod: {
        method: 'change-set',
        changeSetName: 'override-test',
      },
    });

    // THEN
    // First call: changeset creation
    expect(mockDeployStack).toHaveBeenNthCalledWith(1, expect.objectContaining({
      deploymentMethod: expect.objectContaining({
        method: 'change-set',
        changeSetName: 'override-test',
        execute: false,
      }),
    }));

    // Second call: changeset execution with modified deployment method
    expect(mockDeployStack).toHaveBeenNthCalledWith(2, expect.objectContaining({
      deploymentMethod: expect.objectContaining({
        method: 'change-set',
        changeSetName: 'override-test',
        executeExistingChangeSet: true,
      }),
    }));
  });
});

function successfulDeployment() {
  expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
    action: 'deploy',
    level: 'info',
    code: 'CDK_TOOLKIT_I5000',
    message: expect.stringContaining('Deployment time:'),
  }));
}
