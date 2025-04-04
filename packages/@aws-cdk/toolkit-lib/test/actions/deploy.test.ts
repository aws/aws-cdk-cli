import { StackParameters } from '../../lib';
import * as awsCdkApi from '../../lib/api/aws-cdk';
import type { DeployStackOptions, DeployStackResult } from '../../lib/api/aws-cdk';
import { RequireApproval } from '../../lib/api/shared-private';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, TestIoHost } from '../_helpers';
import { MockSdk } from '../util/aws-cdk';

let ioHost: TestIoHost;
let toolkit: Toolkit;
let mockDeployStack: jest.SpyInstance<Promise<DeployStackResult>, [DeployStackOptions]>;

beforeEach(() => {
  jest.restoreAllMocks();
  ioHost = new TestIoHost();
  ioHost.requireDeployApproval = RequireApproval.NEVER;

  toolkit = new Toolkit({ ioHost });
  const sdk = new MockSdk();

  // Some default implementations
  mockDeployStack = jest.spyOn(awsCdkApi.Deployments.prototype, 'deployStack').mockResolvedValue({
    type: 'did-deploy-stack',
    stackArn: 'arn:aws:cloudformation:region:account:stack/test-stack',
    outputs: {},
    noOp: false,
  });
  jest.spyOn(awsCdkApi.Deployments.prototype, 'resolveEnvironment').mockResolvedValue({
    account: '11111111',
    region: 'aq-south-1',
    name: 'aws://11111111/aq-south-1',
  });
  jest.spyOn(awsCdkApi.Deployments.prototype, 'isSingleAssetPublished').mockResolvedValue(true);
  jest.spyOn(awsCdkApi.Deployments.prototype, 'readCurrentTemplate').mockResolvedValue({ Resources: {} });
  jest.spyOn(awsCdkApi.Deployments.prototype, 'buildSingleAsset').mockImplementation();
  jest.spyOn(awsCdkApi.Deployments.prototype, 'publishSingleAsset').mockImplementation();

  jest.spyOn(awsCdkApi, 'findCloudWatchLogGroups').mockResolvedValue({
    env: { name: 'Z', account: 'X', region: 'Y' },
    sdk,
    logGroupNames: ['/aws/lambda/lambda-function-name'],
  });
});

describe('deploy', () => {
  test('deploy from builder', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.deploy(cx);

    // THEN
    successfulDeployment();
  });

  test('request response when changes exceed require approval threshold', async () => {
    // WHEN
    // this is the lowest threshold; always require approval
    ioHost.requireDeployApproval = RequireApproval.ANY_CHANGE;

    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.deploy(cx);

    // THEN
    expect(ioHost.requestSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I5060',
      message: expect.stringContaining('Do you wish to deploy these changes'),
      data: expect.objectContaining({
        motivation: expect.stringContaining('stack includes security-sensitive updates.'),
        permissionChangeType: 'broadening',
      }),
    }));
  });

  test('skips response when changes do not meet require approval threshold', async () => {
    // WHEN
    // never require approval, so we expect the IoHost to skip
    ioHost.requireDeployApproval = RequireApproval.NEVER;

    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.deploy(cx);

    // THEN
    expect(ioHost.requestSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'deploy',
      level: 'info',
      code: 'CDK_TOOLKIT_I5060',
      message: expect.stringContaining('Do you wish to deploy these changes'),
      data: expect.objectContaining({
        motivation: expect.stringContaining('stack includes security-sensitive updates.'),
        permissionChangeType: 'broadening',
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

    test('can trace logs', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        traceLogs: true,
      });

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        action: 'deploy',
        level: 'info',
        code: 'CDK_TOOLKIT_I5031',
        message: expect.stringContaining('The following log groups are added: /aws/lambda/lambda-function-name'),
      }));
    });

    test('non sns notification arn results in error', async () => {
      // WHEN
      const arn = 'arn:aws:sqs:us-east-1:1111111111:resource';
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await expect(async () => toolkit.deploy(cx, {
        notificationArns: [arn],
      })).rejects.toThrow(/Notification arn arn:aws:sqs:us-east-1:1111111111:resource is not a valid arn for an SNS topic/);
    });

    test('hotswap property overrides', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      await toolkit.deploy(cx, {
        hotswapProperties: {
          ecs: {
            maximumHealthyPercent: 100,
            minimumHealthyPercent: 0,
          },
        },
      });

      // THEN
      // passed through correctly to Deployments
      expect(mockDeployStack).toHaveBeenCalledWith(expect.objectContaining({
        hotswapPropertyOverrides: {
          ecsHotswapProperties: {
            maximumHealthyPercent: 100,
            minimumHealthyPercent: 0,
          },
        },
      }));

      successfulDeployment();
    });

    test('forceAssetPublishing: true option is used for asset publishing', async () => {
      const publishSingleAsset = jest.spyOn(awsCdkApi.Deployments.prototype, 'publishSingleAsset').mockImplementation();

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
});

function successfulDeployment() {
  expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
    action: 'deploy',
    level: 'info',
    code: 'CDK_TOOLKIT_I5000',
    message: expect.stringContaining('Deployment time:'),
  }));
}
