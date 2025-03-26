import * as chalk from 'chalk';
import { RootTemplateWithNestedStacks } from '../../../../aws-cdk/lib/api/cloudformation';
import { RequireApproval } from '../../lib';
import * as awsCdkApi from '../../lib/api/aws-cdk';
import { StackSelectionStrategy, Toolkit } from '../../lib/toolkit';
import { builderFixture, TestIoHost } from '../_helpers';
import { MockSdk } from '../util/aws-cdk';

let ioHost: TestIoHost;
let toolkit: Toolkit;
let mockReadCurrentTemplateWithNestedStacks: jest.SpyInstance<Promise<RootTemplateWithNestedStacks>>;

beforeEach(() => {
  jest.restoreAllMocks();
  ioHost = new TestIoHost();
  ioHost.requireDeployApproval = RequireApproval.NEVER;

  toolkit = new Toolkit({ ioHost });
  const sdk = new MockSdk();

  // Some default implementations
  mockReadCurrentTemplateWithNestedStacks = jest.spyOn(awsCdkApi.Deployments.prototype, 'readCurrentTemplateWithNestedStacks').mockResolvedValue({
    deployedRootTemplate: {
      Parameters: {},
      Resources: {
        MyBucketF68F3FF0: {
          Type: 'AWS::S3::Bucket',
          UpdateReplacePolicy: 'Retain',
          DeletionPolicy: 'Retain',
        },
      },
    },
    nestedStacks: [] as any,
  });
  jest.spyOn(awsCdkApi.Deployments.prototype, 'stackExists').mockResolvedValue(true);
  jest.spyOn(awsCdkApi.Deployments.prototype, 'resolveEnvironment').mockResolvedValue({
    name: 'aws://123456789012/us-east-1',
    account: '123456789012',
    region: 'us-east-1',
  });
});

describe('diff', () => {
  test('sends regular diff to IoHost', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE, patterns: ['Stack1'] },
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'diff',
      level: 'info',
      code: 'CDK_TOOLKIT_I4402',
      message: expect.stringContaining('Number of differences: 1'),
    }));

    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'diff',
      level: 'info',
      code: 'CDK_TOOLKIT_I4401',
      // message: expect.stringContaining(`${chalk.red('Stack')}${chalk.red(chalk.bold(' Stack1'))}`),
    }));
  });

  test('returns regular diff', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    const result = await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE, patterns: ['Stack1'] },
    });

    // THEN
    expect(result).toMatchObject(expect.objectContaining({
      resources: {
        diffs: expect.objectContaining({
          MyBucketF68F3FF0: expect.objectContaining({
            isAddition: false,
            isRemoval: true,
            newValue: undefined,
            oldValue: {
              Type: 'AWS::S3::Bucket',
              UpdateReplacePolicy: 'Retain',
              DeletionPolicy: 'Retain',
            },
          }),
        }),
      },
    }));
  });

  describe('templatePath', () => {
    test('fails with multiple stacks', async () => {
      // WHEN + THEN
      const cx = await builderFixture(toolkit, 'two-empty-stacks');
      await expect(async () => await toolkit.diff(cx, { 
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        templatePath: 'blah',
      })).rejects.toThrow(/Can only select one stack when comparing to fixed template./);
    });

    test('with securityOnly', () => {

    });
  });
});
