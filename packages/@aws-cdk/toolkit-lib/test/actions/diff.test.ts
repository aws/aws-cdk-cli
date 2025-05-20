import * as path from 'path';
import * as chalk from 'chalk';
import { DiffMethod } from '../../lib/actions/diff';
import * as awsauth from '../../lib/api/aws-auth/private';
import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import * as deployments from '../../lib/api/deployments';
import { cfnApi } from '../../lib/api/shared-private';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, disposableCloudAssemblySource, TestIoHost } from '../_helpers';
import { MockSdk, restoreSdkMocksToDefault, setDefaultSTSMocks } from '../_helpers/mock-sdk';

let ioHost: TestIoHost;
let toolkit: Toolkit;

beforeEach(() => {
  jest.restoreAllMocks();
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();
  ioHost = new TestIoHost();
  toolkit = new Toolkit({ ioHost });

  // Some default implementations
  jest.spyOn(awsauth.SdkProvider.prototype, '_makeSdk').mockReturnValue(new MockSdk());

  jest.spyOn(deployments.Deployments.prototype, 'readCurrentTemplateWithNestedStacks').mockResolvedValue({
    deployedRootTemplate: {
      Parameters: {},
      Resources: {},
    },
    nestedStacks: [] as any,
  });
  jest.spyOn(deployments.Deployments.prototype, 'stackExists').mockResolvedValue(true);
  jest.spyOn(deployments.Deployments.prototype, 'resolveEnvironment').mockResolvedValue({
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
      code: 'CDK_TOOLKIT_I4001',
      message: expect.stringContaining('✨ Number of stacks with differences: 1'),
      data: expect.objectContaining({
        formattedStackDiff: expect.stringContaining((chalk.bold('Stack1'))),
      }),
    }));
  });

  test('returns diff', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    const result = await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(result.Stack1).toMatchObject(expect.objectContaining({
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

  test('returns multiple template diffs', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'two-different-stacks');
    const result = await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(result.Stack1).toMatchObject(expect.objectContaining({
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
    expect(result.Stack2).toMatchObject(expect.objectContaining({
      resources: {
        diffs: expect.objectContaining({
          MyQueueE6CA6235: expect.objectContaining({
            isAddition: true,
            isRemoval: false,
            oldValue: undefined,
            newValue: {
              Type: 'AWS::SQS::Queue',
              UpdateReplacePolicy: 'Delete',
              DeletionPolicy: 'Delete',
              Metadata: { 'aws:cdk:path': 'Stack2/MyQueue/Resource' },
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
      method: DiffMethod.TemplateOnly({ compareAgainstProcessedTemplate: true }),
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'diff',
      level: 'warn',
      code: 'CDK_TOOLKIT_W0000',
      message: expect.stringContaining('This deployment will make potentially sensitive changes according to your current security approval level'),
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'diff',
      level: 'info',
      code: 'CDK_TOOLKIT_I4001',
      message: expect.stringContaining('✨ Number of stacks with differences: 1'),
      data: expect.objectContaining({
        formattedSecurityDiff: expect.stringContaining((chalk.underline(chalk.bold('IAM Statement Changes')))),
      }),
    }));

    expect(result.Stack1).toMatchObject(expect.objectContaining({
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
      code: 'CDK_TOOLKIT_I4001',
      message: expect.stringContaining('✨ Number of stacks with differences: 0'),
      data: expect.objectContaining({
        formattedSecurityDiff: '',
      }),
    }));
  });

  test('TemplateOnly diff method does not try to find changeSet', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.diff(cx, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
      method: DiffMethod.TemplateOnly({ compareAgainstProcessedTemplate: true }),
    });

    // THEN
    expect(ioHost.notifySpy).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'diff',
      level: 'info',
      code: 'CDK_TOOLKIT_I0000',
      message: expect.stringContaining('Could not create a change set'),
    }));
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'diff',
      level: 'info',
      code: 'CDK_TOOLKIT_I4001',
      message: expect.stringContaining('✨ Number of stacks with differences: 1'),
      data: expect.objectContaining({
        formattedStackDiff: expect.stringContaining(chalk.bold('Stack1')),
      }),
    }));
  });

  describe('DiffMethod.ChangeSet', () => {
    test('ChangeSet diff method falls back to template only if changeset not found', async () => {
      // WHEN
      ioHost.level = 'debug';
      const cx = await builderFixture(toolkit, 'stack-with-bucket');
      await toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        method: DiffMethod.ChangeSet(),
      });

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        action: 'diff',
        level: 'info',
        code: 'CDK_TOOLKIT_I0000',
        message: expect.stringContaining('Could not create a change set, will base the diff on template differences'),
      }));
    });

    test('ChangeSet diff method with import existing resources option enabled', async () => {
      // Setup mock BEFORE calling the function
      const createDiffChangeSetMock = jest.spyOn(cfnApi, 'createDiffChangeSet').mockImplementationOnce(async () => {
        return {
          $metadata: {},
          Changes: [
            {
              ResourceChange: {
                Action: 'Import',
                LogicalResourceId: 'MyBucketF68F3FF0',
              },
            },
          ],
        };
      });

      // WHEN
      ioHost.level = 'debug';
      const cx = await builderFixture(toolkit, 'stack-with-bucket');
      const result = await toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        method: DiffMethod.ChangeSet({ importExistingResources: true }),
      });

      // THEN
      expect(createDiffChangeSetMock).toHaveBeenCalled();
      expect(result.Stack1.resources.get('MyBucketF68F3FF0').isImport).toBe(true);
    });

    test('ChangeSet diff method throws if changeSet fails and fallBackToTemplate = false', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-bucket');
      await expect(async () => toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        method: DiffMethod.ChangeSet({ fallbackToTemplate: false }),
      })).rejects.toThrow(/Could not create a change set and failOnError is set/);
    });

    test('ChangeSet diff method throws if stack not found and fallBackToTemplate = false', async () => {
      // GIVEN
      jest.spyOn(deployments.Deployments.prototype, 'stackExists').mockResolvedValue(false);

      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-bucket');
      await expect(async () => toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        method: DiffMethod.ChangeSet({ fallbackToTemplate: false }),
      })).rejects.toThrow(/the stack 'Stack1' has not been deployed to CloudFormation/);
    });
  });

  describe('DiffMethod.LocalFile', () => {
    test('fails with multiple stacks', async () => {
      // WHEN + THEN
      const cx = await builderFixture(toolkit, 'two-empty-stacks');
      await expect(async () => toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        method: DiffMethod.LocalFile(path.join(__dirname, '..', '_fixtures', 'stack-with-bucket', 'cdk.out', 'Stack1.template.json')),
      })).rejects.toThrow(/Can only select one stack when comparing to fixed template./);
    });

    test('fails with bad file path', async () => {
      // WHEN + THEN
      const cx = await builderFixture(toolkit, 'stack-with-bucket');
      await expect(async () => toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        method: DiffMethod.LocalFile(path.join(__dirname, 'blah.json')),
      })).rejects.toThrow(/There is no file at/);
    });

    test('returns regular diff', async () => {
      // WHEN
      const cx = await builderFixture(toolkit, 'stack-with-bucket');
      const result = await toolkit.diff(cx, {
        stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
        method: DiffMethod.LocalFile(path.join(__dirname, '..', '_fixtures', 'two-empty-stacks', 'cdk.out', 'Stack1.template.json')),
      });

      // THEN
      expect(result.Stack1).toMatchObject(expect.objectContaining({
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
        method: DiffMethod.LocalFile(path.join(__dirname, '..', '_fixtures', 'two-empty-stacks', 'cdk.out', 'Stack1.template.json')),
      });

      // THEN
      expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        action: 'diff',
        level: 'warn',
        code: 'CDK_TOOLKIT_W0000',
        message: expect.stringContaining('This deployment will make potentially sensitive changes according to your current security approval level'),
      }));
      expect(result.Stack1).toMatchObject(expect.objectContaining({
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

  test('action disposes of assembly produced by source', async () => {
    // GIVEN
    const [assemblySource, mockDispose, realDispose] = await disposableCloudAssemblySource(toolkit);

    // WHEN
    await toolkit.diff(assemblySource, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(mockDispose).toHaveBeenCalled();
    await realDispose();
  });
});
