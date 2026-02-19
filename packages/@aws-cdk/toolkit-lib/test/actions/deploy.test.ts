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
});

describe('deploy', () => {
  test('deploy from builder', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.deploy(cx);

    // THEN
    successfulDeployment();
  });

  test('emits resource counters', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.deploy(cx);

    // THEN
    const deploy = ioHost.notifySpy.mock.calls.map(cs => cs[0]).filter(c => c.code === 'CDK_TOOLKIT_I5001');
    expect(deploy).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({
        counters: expect.objectContaining({
          resources: 1,
        }),
      }),
    }));
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
        motivation: expect.stringContaining('stack includes security-sensitive updates.'),
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
});

function successfulDeployment() {
  expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
    action: 'deploy',
    level: 'info',
    code: 'CDK_TOOLKIT_I5000',
    message: expect.stringContaining('Deployment time:'),
  }));
}
