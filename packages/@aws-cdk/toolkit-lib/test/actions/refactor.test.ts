import {
  CreateStackRefactorCommand,
  DescribeStackRefactorCommand,
  DescribeStacksCommand,
  ExecuteStackRefactorCommand,
  GetTemplateCommand,
  ListStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { StackSelectionStrategy, Toolkit } from '../../lib';
import { SdkProvider } from '../../lib/api/shared-private';
import { builderFixture, TestIoHost } from '../_helpers';
import { mockCloudFormationClient, MockSdk, mockSTSClient } from '../_helpers/mock-sdk';

// these tests often run a bit longer than the default
jest.setTimeout(10_000);

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });

jest.spyOn(SdkProvider.prototype, '_makeSdk').mockReturnValue(new MockSdk());
jest.spyOn(SdkProvider.prototype, 'forEnvironment').mockResolvedValue({
  sdk: new MockSdk(),
  didAssumeRole: false,
});

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
});

describe.each([true, false])('refactor detection', (dryRun) => {
  test('detects the same resource in different locations', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.refactor(cx, {
      dryRun,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refactor',
        level: 'result',
        code: 'CDK_TOOLKIT_I8900',
        message: expect.stringMatching(/AWS::S3::Bucket.*Stack1\/OldLogicalID\/Resource.*Stack1\/MyBucket\/Resource/),
        data: expect.objectContaining({
          typedMappings: [
            {
              sourcePath: 'Stack1/OldLogicalID/Resource',
              destinationPath: 'Stack1/MyBucket/Resource',
              type: 'AWS::S3::Bucket',
            },
          ],
        }),
      }),
    );
  });

  test('detects ambiguous mappings', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      CatPhotos: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/CatPhotos/Resource',
        },
      },
      DogPhotos: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/DogPhotos/Resource',
        },
      },
    });

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.refactor(cx, {
      dryRun,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refactor',
        level: 'result',
        code: 'CDK_TOOLKIT_I8900',
        /*
        ┌───┬───────────────────────────┐
        │   │ Resource                  │
        ├───┼───────────────────────────┤
        │ - │ Stack1/CatPhotos/Resource │
        │   │ Stack1/DogPhotos/Resource │
        ├───┼───────────────────────────┤
        │ + │ Stack1/Bucket/Resource    │
        └───┴───────────────────────────┘
         */
        message: expect.stringMatching(
          /-.*Stack1\/CatPhotos\/Resource.*\s+.*Stack1\/DogPhotos\/Resource.*\s+.*\s+.*\+.*Stack1\/MyBucket\/Resource/gm,
        ),
        data: {
          ambiguousPaths: [[['Stack1/CatPhotos/Resource', 'Stack1/DogPhotos/Resource'], ['Stack1/MyBucket/Resource']]],
        },
      }),
    );
  });

  test('filters stacks when stack selector is passed', async () => {
    // GIVEN
    mockCloudFormationClient.on(ListStacksCommand).resolves({
      StackSummaries: [
        {
          StackName: 'Stack1',
          StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/Stack1',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
        {
          StackName: 'Stack2',
          StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/Stack2',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    });

    mockCloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Stack1',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            OldBucketName: {
              Type: 'AWS::S3::Bucket',
              UpdateReplacePolicy: 'Retain',
              DeletionPolicy: 'Retain',
              Metadata: {
                'aws:cdk:path': 'Stack1/OldBucketName/Resource',
              },
            },
          },
        }),
      })
      .on(GetTemplateCommand, {
        StackName: 'Stack2',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            OldQueueName: {
              Type: 'AWS::SQS::Queue',
              UpdateReplacePolicy: 'Delete',
              DeletionPolicy: 'Delete',
              Metadata: {
                'aws:cdk:path': 'Stack2/OldQueueName/Resource',
              },
            },
          },
        }),
      });

    // WHEN
    const cx = await builderFixture(toolkit, 'two-different-stacks');
    await toolkit.refactor(cx, {
      dryRun,
      stacks: {
        strategy: StackSelectionStrategy.PATTERN_MATCH,
        patterns: ['Stack1'],
      },
    });

    // Resources were renamed in both stacks, but we are only including Stack1.
    // So expect to see only changes for Stack1.
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refactor',
        level: 'result',
        code: 'CDK_TOOLKIT_I8900',
        message: expect.stringMatching(/AWS::S3::Bucket.*Stack1\/OldBucketName\/Resource.*Stack1\/MyBucket\/Resource/),
        data: expect.objectContaining({
          typedMappings: [
            {
              sourcePath: 'Stack1/OldBucketName/Resource',
              destinationPath: 'Stack1/MyBucket/Resource',
              type: 'AWS::S3::Bucket',
            },
          ],
        }),
      }),
    );

    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringMatching(/OldQueueName/),
      }),
    );
  });

  test('resource is marked to be excluded for refactoring in the cloud assembly', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      // This would have caused a refactor to be detected,
      // but the resource is marked to be excluded...
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });

    // WHEN
    const cx = await builderFixture(toolkit, 'exclude-refactor');
    await toolkit.refactor(cx, {
      dryRun,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refactor',
        level: 'result',
        code: 'CDK_TOOLKIT_I8900',
        // ...so we don't see it in the output
        message: expect.stringMatching(/Nothing to refactor/),
      }),
    );
  });
});

describe('refactor execution', () => {
  beforeEach(() => {
    process.stdout.isTTY = false;
  });

  test('happy path', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });

    mockSTSClient.on(GetCallerIdentityCommand).resolves({
      Account: '999999999999',
      Arn: 'arn:aws:sts::999999999999:assumed-role/role-name/role-session-name',
    });

    mockCloudFormationClient.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'CDKToolkit',
          CreationTime: new Date(),
          StackStatus: 'UPDATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'BootstrapVersion',
              OutputValue: '28',
            },
          ],
        },
      ],
    });

    mockCloudFormationClient.on(CreateStackRefactorCommand).resolves({
      StackRefactorId: 'refactor-id',
    });

    mockCloudFormationClient.on(DescribeStackRefactorCommand).resolves({
      Status: 'CREATE_COMPLETE',
      ExecutionStatus: 'EXECUTE_COMPLETE',
    });

    mockCloudFormationClient.on(ExecuteStackRefactorCommand).resolves({});

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.refactor(cx, {
      dryRun: false,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/Stack refactor complete/),
      }),
    );
  });

  test('interactive mode, without force', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });

    process.stdout.isTTY = true;

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.refactor(cx, {
      dryRun: false,
    });

    // THEN
    expect(ioHost.requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refactor',
        code: 'CDK_TOOLKIT_I8910',
        defaultResponse: true,
        level: 'info',
        message: 'Do you wish to refactor these resources?',
      }),
    );
  });

  test('interactive mode, with force', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });
    process.stdout.isTTY = true;

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.refactor(cx, {
      dryRun: false,
      force: true,
    });

    // THEN
    // No confirmation is requested from the user
    expect(ioHost.requestSpy).not.toHaveBeenCalled();
  });

  test('refactor execution fails', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });

    mockSTSClient.on(GetCallerIdentityCommand).resolves({
      Account: '999999999999',
      Arn: 'arn:aws:sts::999999999999:assumed-role/role-name/role-session-name',
    });

    mockCloudFormationClient.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'CDKToolkit',
          CreationTime: new Date(),
          StackStatus: 'UPDATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'BootstrapVersion',
              OutputValue: '28',
            },
          ],
        },
      ],
    });

    mockCloudFormationClient.on(CreateStackRefactorCommand).resolves({
      StackRefactorId: 'refactor-id',
    });

    mockCloudFormationClient.on(DescribeStackRefactorCommand).resolves({
      Status: 'CREATE_COMPLETE',
      ExecutionStatus: 'EXECUTE_FAILED',
    });

    mockCloudFormationClient.on(ExecuteStackRefactorCommand).resolves({});

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.refactor(cx, {
      dryRun: false,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refactor',
        code: 'CDK_TOOLKIT_E8900',
        level: 'error',
        message: 'Refactor execution failed for environment aws://123456789012/us-east-1',
      }),
    );
  });

  test('refactor creation fails', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });

    mockSTSClient.on(GetCallerIdentityCommand).resolves({
      Account: '999999999999',
      Arn: 'arn:aws:sts::999999999999:assumed-role/role-name/role-session-name',
    });

    mockCloudFormationClient.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'CDKToolkit',
          CreationTime: new Date(),
          StackStatus: 'UPDATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'BootstrapVersion',
              OutputValue: '28',
            },
          ],
        },
      ],
    });

    mockCloudFormationClient.on(CreateStackRefactorCommand).resolves({
      StackRefactorId: 'refactor-id',
    });

    mockCloudFormationClient.on(DescribeStackRefactorCommand).resolves({
      Status: 'CREATE_FAILED',
    });

    mockCloudFormationClient.on(ExecuteStackRefactorCommand).resolves({});

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.refactor(cx, {
      dryRun: false,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refactor',
        code: 'CDK_TOOLKIT_E8900',
        level: 'error',
        message: 'Refactor execution failed for environment aws://123456789012/us-east-1',
      }),
    );
  });

  test('bootstrap version lower than minimum required', async () => {
    // GIVEN
    givenStackWithResources('Stack1', {
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });

    mockSTSClient.on(GetCallerIdentityCommand).resolves({
      Account: '999999999999',
      Arn: 'arn:aws:sts::999999999999:assumed-role/role-name/role-session-name',
    });

    mockCloudFormationClient.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'CDKToolkit',
          CreationTime: new Date(),
          StackStatus: 'UPDATE_COMPLETE',
          Outputs: [
            {
              OutputKey: 'BootstrapVersion',
              OutputValue: '27',
            },
          ],
        },
      ],
    });

    mockCloudFormationClient.on(CreateStackRefactorCommand).resolves({
      StackRefactorId: 'refactor-id',
    });

    mockCloudFormationClient.on(DescribeStackRefactorCommand).resolves({
      Status: 'CREATE_FAILED',
    });

    mockCloudFormationClient.on(ExecuteStackRefactorCommand).resolves({});

    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-bucket');
    await toolkit.refactor(cx, {
      dryRun: false,
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refactor',
        code: 'CDK_TOOLKIT_E8900',
        level: 'error',
        message:
          "Refactor failed: The CDK toolkit stack in environment aws://123456789012/us-east-1 doesn't support refactoring. Please run 'cdk bootstrap' to update it.",
      }),
    );
  });
});

function givenStackWithResources(stackName: string, resources: Record<string, any>) {
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: [
      {
        StackName: stackName,
        StackId: `arn:aws:cloudformation:us-east-1:999999999999:stack/${stackName}`,
        StackStatus: 'CREATE_COMPLETE',
        CreationTime: new Date(),
      },
    ],
  });

  mockCloudFormationClient
    .on(GetTemplateCommand, {
      StackName: stackName,
    })
    .resolves({
      TemplateBody: JSON.stringify({
        Resources: resources,
      }),
    });
}
