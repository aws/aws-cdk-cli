import * as chalk from 'chalk';
import { RootTemplateWithNestedStacks } from '../../../../aws-cdk/lib/api/cloudformation';
import { RequireApproval } from '../../lib';
import * as awsCdkApi from '../../lib/api/aws-cdk';
import { StackSelectionStrategy, Toolkit } from '../../lib/toolkit';
import { builderFixture, TestIoHost } from '../_helpers';
import { MockSdk } from '../util/aws-cdk';
import * as path from 'path';

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
      Resources: {},
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
  test('sends diff to IoHost', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
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
      message: expect.stringContaining((chalk.bold('Stack1'))),
    }));
  });

  test('returns diff', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(result).toMatchObject(expect.objectContaining({
      resources: {
        diffs: expect.objectContaining({
          MyBucketF68F3FF0: expect.objectContaining({
            isAddition: true,
            isRemoval: false,
            oldValue: undefined,
            newValue: {
              Type: 'AWS::S3::Bucket',
              UpdateReplacePolicy: 'Retain',
              DeletionPolicy: 'Retain',
              Metadata: { 'aws:cdk:path': 'Stack1/MyBucket/Resource' },
            },
          }),
        }),
      },
    }));
  });

  test('only security diff', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const result = await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE, patterns: ['Stack1'] },
      securityOnly: true,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'diff',
      level: 'warn',
      code: 'CDK_TOOLKIT_W0000',
      message: expect.stringContaining('This deployment will make potentially sensitive changes according to your current security approval level (--require-approval broadening)'),
    }));
    expect(result).toMatchObject(expect.objectContaining({
      iamChanges: expect.objectContaining({
        statements: expect.objectContaining({
          additions: [expect.objectContaining({
            actions: expect.objectContaining({
              not: false,
              values: ['sts:AssumeRole'],
            }),
            condition: undefined,
            effect: 'Allow',
            principals: expect.objectContaining({
              not: false,
              values: ['AWS:arn'],
            }),
          })],
          removals: [],
        }),
      }),
    }));
  });

  test('no security diff', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-empty-stacks');
    await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      securityOnly: true,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'diff',
      level: 'info',
      code: 'CDK_TOOLKIT_I4402',
      message: expect.stringContaining('Number of differences: 0'),
    }));
  });

  describe('templatePath', () => {
    test('fails with multiple stacks', async () => {
      // WHEN + THEN
      const cx = await builderFixture(toolkit, 'two-empty-stacks');
      await expect(async () => await toolkit.diff(cx, { 
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        templatePath: path.join(__dirname, '..', '_fixtures', 'stack-with-bucket', 'cdk.out', 'Stack1.template.json'),
      })).rejects.toThrow(/Can only select one stack when comparing to fixed template./);
    });

    test('fails with bad file path', async () => {
      // WHEN + THEN
      const cx = await builderFixture(toolkit, 'stack-with-bucket');
      await expect(async () => await toolkit.diff(cx, { 
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        templatePath: path.join(__dirname, 'blah.json'),
      })).rejects.toThrow(/There is no file at/);
    });

    test('returns regular diff', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-bucket');
      const result = await toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        templatePath: path.join(__dirname, '..', '_fixtures', 'two-empty-stacks', 'cdk.out', 'Stack1.template.json'),
      });

      // THEN
      expect(result).toMatchObject(expect.objectContaining({
        resources: {
          diffs: expect.objectContaining({
            MyBucketF68F3FF0: expect.objectContaining({
              isAddition: true,
              isRemoval: false,
              oldValue: undefined,
              newValue: {
                Type: 'AWS::S3::Bucket',
                UpdateReplacePolicy: 'Retain',
                DeletionPolicy: 'Retain',
                Metadata: { 'aws:cdk:path': 'Stack1/MyBucket/Resource' },
              },
            }),
          }),
        },
      }));
    });

    test('returns security diff', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      const result = await toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        securityOnly: true,
        templatePath: path.join(__dirname, '..', '_fixtures', 'two-empty-stacks', 'cdk.out', 'Stack1.template.json'),
      });

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        action: 'diff',
        level: 'warn',
        code: 'CDK_TOOLKIT_W0000',
        message: expect.stringContaining('This deployment will make potentially sensitive changes according to your current security approval level (--require-approval broadening)'),
      }));
      expect(result).toMatchObject(expect.objectContaining({
        iamChanges: expect.objectContaining({
          statements: expect.objectContaining({
            additions: [expect.objectContaining({
              actions: expect.objectContaining({
                not: false,
                values: ['sts:AssumeRole'],
              }),
              condition: undefined,
              effect: 'Allow',
              principals: expect.objectContaining({
                not: false,
                values: ['AWS:arn'],
              }),
            })],
            removals: [],
          }),
        }),
      }));
    });
  });
});
