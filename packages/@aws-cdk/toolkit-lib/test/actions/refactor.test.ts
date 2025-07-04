import {
  CreateStackRefactorCommand,
  DescribeStackRefactorCommand,
  DescribeStacksCommand,
  ExecuteStackRefactorCommand,
  GetTemplateCommand,
  ListStacksCommand,
} from '@aws-sdk/client-cloudformation';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { MappingSource, type RefactorOptions, Toolkit } from '../../lib';
import { SdkProvider } from '../../lib/api/aws-auth/private';
import { builderFixture, TestIoHost } from '../_helpers';
import { mockCloudFormationClient, MockSdk, mockSTSClient } from '../_helpers/mock-sdk';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost, unstableFeatures: ['refactor'] });

jest.spyOn(SdkProvider.prototype, '_makeSdk').mockReturnValue(new MockSdk());

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
  mockCloudFormationClient.reset();
});

test('requires acknowledgment that the feature is unstable', async () => {
  // GIVEN
  const tk = new Toolkit({ ioHost /* unstable not acknowledged */ });
  const cx = await builderFixture(tk, 'stack-with-bucket');

  // WHEN
  await expect(
    tk.refactor(cx, {
      dryRun: true,
    }),
  ).rejects.toThrow("Unstable feature 'refactor' is not enabled. Please enable it under 'unstableFeatures'");
});

test('detects the same resource in different locations', async () => {
  // GIVEN
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: [
      {
        StackName: 'Stack1',
        StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/Stack1',
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
          OldLogicalID: {
            Type: 'AWS::S3::Bucket',
            UpdateReplacePolicy: 'Retain',
            DeletionPolicy: 'Retain',
            Metadata: {
              'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
            },
          },
        },
      }),
    });

  // WHEN
  const cx = await builderFixture(toolkit, 'stack-with-bucket');
  await toolkit.refactor(cx, {
    dryRun: true,
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

test('only considers deployed stacks that match the given filter', async () => {
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
      {
        StackName: 'CDKToolkit',
        StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/CDKToolkit',
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
          OldLogicalID: {
            Type: 'AWS::S3::Bucket',
            UpdateReplacePolicy: 'Retain',
            DeletionPolicy: 'Retain',
            Metadata: {
              'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
            },
          },
        },
      }),
    });

  mockCloudFormationClient
    .on(GetTemplateCommand, {
      StackName: 'Stack2',
    })
    .resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          Queue: {
            Type: 'AWS::SQS::Queue',
            UpdateReplacePolicy: 'Delete',
            DeletionPolicy: 'Delete',
            Metadata: {
              'aws:cdk:path': 'Stack2/Queue/Resource',
            },
          },
        },
      }),
    });

  mockCloudFormationClient
    .on(GetTemplateCommand, {
      StackName: 'CDKToolkit',
    })
    .resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          CdkBootstrapVersion: {
            Type: 'AWS::SSM::Parameter',
            Properties: {
              Type: 'String',
              Name: {
                'Fn::Sub': '/cdk-bootstrap/${Qualifier}/version',
              },
              Value: '1',
            },
          },
        },
      }),
    });

  await expectRefactorBehavior(
    'stack-with-bucket',
    {
      dryRun: true,
      // We are not passing any filter, which means that Stack2 will also be included in the comparison.
      // This results in the set of deployed resources being different from the local resources, which
      // results in an error.
    },
    {
      action: 'refactor',
      level: 'error',
      code: 'CDK_TOOLKIT_E8900',
      message: expect.stringMatching(/A refactor operation cannot add, remove or update resources/),
    },
  );

  await expectRefactorBehavior(
    'stack-with-bucket',
    {
      dryRun: true,
      // To avoid the error, we tell the toolkit to only consider Stack1 in the deployed stacks.
      deployedStacks: ['Stack1'],
    },
    {
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
    },
  );

  await expectRefactorBehavior(
    'two-different-stacks',
    {
      dryRun: true,
      // In this case, we are not passing any filter, either, but local and deployed are
      // the same, except for the bootstrap stack. But that is ignored by default.
    },
    {
      action: 'refactor',
      level: 'result',
      code: 'CDK_TOOLKIT_I8900',
      data: expect.objectContaining({
        typedMappings: [
          {
            sourcePath: 'Stack1/OldLogicalID/Resource',
            destinationPath: 'Stack1/MyBucket/Resource',
            type: 'AWS::S3::Bucket',
          },
          {
            sourcePath: 'Stack2/Queue/Resource',
            destinationPath: 'Stack2/MyQueue/Resource',
            type: 'AWS::SQS::Queue',
          },
        ],
      }),
    },
  );

  await expectRefactorBehavior(
    'two-different-stacks',
    {
      dryRun: true,
      // But if we pass a wildcard, even the bootstrap stack will be included in the comparison.
      deployedStacks: ['*'],
    },
    {
      action: 'refactor',
      level: 'error',
      code: 'CDK_TOOLKIT_E8900',
      message: expect.stringMatching(/A refactor operation cannot add, remove or update resources/),
    },
  );
});

test('detects ambiguous mappings', async () => {
  // GIVEN
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: [
      {
        StackName: 'Stack1',
        StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/Stack1',
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
          // These two buckets were replaced with two other buckets
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
        },
      }),
    });

  // WHEN
  const cx = await builderFixture(toolkit, 'stack-with-two-buckets');
  await toolkit.refactor(cx, {
    dryRun: true,
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
      │ + │ Stack1/MyBucket1/Resource │
      │   │ Stack1/MyBucket2/Resource │
      └───┴───────────────────────────┘
       */
      message: expect.stringMatching(
        /-.*Stack1\/CatPhotos\/Resource.*\s+.*Stack1\/DogPhotos\/Resource.*\s+.*\s+.*\+.*Stack1\/MyBucket1\/Resource.*\s+.*Stack1\/MyBucket2\/Resource/gm,
      ),
      data: {
        ambiguousPaths: [
          [
            ['Stack1/CatPhotos/Resource', 'Stack1/DogPhotos/Resource'],
            ['Stack1/MyBucket1/Resource', 'Stack1/MyBucket2/Resource'],
          ],
        ],
      },
    }),
  );
});

test('detects modifications to the infrastructure', async () => {
  // GIVEN
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: [
      {
        StackName: 'Stack1',
        StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/Stack1',
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
          // This resource would be refactored
          OldName: {
            Type: 'AWS::S3::Bucket',
            UpdateReplacePolicy: 'Retain',
            DeletionPolicy: 'Retain',
            Metadata: {
              'aws:cdk:path': 'Stack1/OldName/Resource',
            },
          },
          // But there is an additional resource that will prevent it
          Queue: {
            Type: 'AWS::S3::Queue',
            UpdateReplacePolicy: 'Retain',
            DeletionPolicy: 'Retain',
            Metadata: {
              'aws:cdk:path': 'Stack1/Queue/Resource',
            },
          },
        },
      }),
    });

  // WHEN
  const cx = await builderFixture(toolkit, 'stack-with-bucket');
  await toolkit.refactor(cx, {
    dryRun: true,
  });

  // THEN
  expect(ioHost.notifySpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'refactor',
      level: 'error',
      code: 'CDK_TOOLKIT_E8900',
      message: expect.stringMatching(/A refactor operation cannot add, remove or update resources/),
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
    dryRun: true,
    localStacks: ['Stack1'],
    deployedStacks: ['Stack1'],
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
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: [
      {
        StackName: 'Stack1',
        StackId: 'arn:aws:cloudformation:us-east-1:999999999999:stack/Stack1',
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
        },
      }),
    });

  // WHEN
  const cx = await builderFixture(toolkit, 'exclude-refactor');
  await toolkit.refactor(cx, {
    dryRun: true,
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

test('uses the explicit mapping when provided, instead of computing it on-the-fly', async () => {
  // GIVEN
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: [
      {
        StackName: 'Stack1',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Stack1',
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
          OldLogicalID: {
            Type: 'AWS::S3::Bucket',
            UpdateReplacePolicy: 'Retain',
            DeletionPolicy: 'Retain',
            Metadata: {
              'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
            },
          },
        },
      }),
    });

  // WHEN
  const cx = await builderFixture(toolkit, 'stack-with-bucket');
  await toolkit.refactor(cx, {
    dryRun: true,
    mappingSource: MappingSource.explicit([
      {
        account: '123456789012',
        region: 'us-east-1',
        resources: {
          'Stack1.OldLogicalID': 'Stack1.NewLogicalID',
        },
      },
    ]),
  });

  // THEN
  expect(ioHost.notifySpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'refactor',
      level: 'result',
      code: 'CDK_TOOLKIT_I8900',
      message: expect.stringMatching(/AWS::S3::Bucket.*Stack1\/OldLogicalID\/Resource.*Stack1\.NewLogicalID/),
      data: expect.objectContaining({
        typedMappings: [
          {
            sourcePath: 'Stack1/OldLogicalID/Resource',
            destinationPath: 'Stack1.NewLogicalID',
            type: 'AWS::S3::Bucket',
          },
        ],
      }),
    }),
  );
});

test('uses the reverse of an explicit mapping when provided', async () => {
  // GIVEN
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: [
      {
        StackName: 'Stack1',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Stack1',
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
          // Suppose we had already mapped OldLogicalID -> NewLogicalID...
          NewLogicalID: {
            Type: 'AWS::S3::Bucket',
            UpdateReplacePolicy: 'Retain',
            DeletionPolicy: 'Retain',
            Metadata: {
              'aws:cdk:path': 'Stack1/NewLogicalID/Resource',
            },
          },
        },
      }),
    });

  // WHEN
  const cx = await builderFixture(toolkit, 'stack-with-bucket');
  await toolkit.refactor(cx, {
    dryRun: true,
    // ... this is the mapping we used, and now we want to revert it
    mappingSource: MappingSource.reverse([
      {
        account: '123456789012',
        region: 'us-east-1',
        resources: {
          'Stack1.OldLogicalID': 'Stack1.NewLogicalID',
        },
      },
    ]),
  });

  // THEN
  expect(ioHost.notifySpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'refactor',
      level: 'result',
      code: 'CDK_TOOLKIT_I8900',
      message: expect.stringMatching(/AWS::S3::Bucket.*Stack1\/NewLogicalID\/Resource.*Stack1\.OldLogicalID/),
      data: expect.objectContaining({
        typedMappings: [
          {
            sourcePath: 'Stack1/NewLogicalID/Resource',
            destinationPath: 'Stack1.OldLogicalID',
            type: 'AWS::S3::Bucket',
          },
        ],
      }),
    }),
  );
});

test('computes one set of mappings per environment', async () => {
  // GIVEN
  mockCloudFormationClient
    .on(ListStacksCommand)
    // We are relying on the fact that these calls are made in the order that the
    // stacks are passed. So the first call is for environment1 and the second is
    // for environment2. This is not ideal, but as far as I know there is no other
    // way to control the behavior of the mock SDK clients.
    .resolvesOnce({
      StackSummaries: [
        {
          StackName: 'Stack1',
          StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Stack1',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    })
    .resolvesOnce({
      StackSummaries: [
        {
          StackName: 'Stack2',
          StackId: 'arn:aws:cloudformation:us-east-2:123456789012:stack/Stack2',
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
    });

  mockCloudFormationClient
    .on(GetTemplateCommand, {
      StackName: 'Stack2',
    })
    .resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          OldBucketName: {
            Type: 'AWS::S3::Bucket',
            UpdateReplacePolicy: 'Retain',
            DeletionPolicy: 'Retain',
            Metadata: {
              'aws:cdk:path': 'Stack2/OldBucketName/Resource',
            },
          },
        },
      }),
    });

  // WHEN
  const cx = await builderFixture(toolkit, 'multiple-environments');
  await toolkit.refactor(cx, {
    dryRun: true,
  });

  // THEN
  expect(ioHost.notifySpy).toHaveBeenCalledTimes(4);

  expect(ioHost.notifySpy).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      message: expect.stringMatching('aws://123456789012/us-east-1'),
    }),
  );

  expect(ioHost.notifySpy).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      action: 'refactor',
      level: 'result',
      code: 'CDK_TOOLKIT_I8900',
      message: expect.stringMatching(
        /AWS::S3::Bucket.*Stack1\/OldBucketName\/Resource.*Stack1\/NewBucketNameInStack1\/Resource/,
      ),
      data: expect.objectContaining({
        typedMappings: [
          {
            sourcePath: 'Stack1/OldBucketName/Resource',
            destinationPath: 'Stack1/NewBucketNameInStack1/Resource',
            type: 'AWS::S3::Bucket',
          },
        ],
      }),
    }),
  );

  expect(ioHost.notifySpy).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({
      message: expect.stringMatching('aws://123456789012/us-east-2'),
    }),
  );

  expect(ioHost.notifySpy).toHaveBeenNthCalledWith(
    4,
    expect.objectContaining({
      action: 'refactor',
      level: 'result',
      code: 'CDK_TOOLKIT_I8900',
      message: expect.stringMatching(
        /AWS::S3::Bucket.*Stack2\/OldBucketName\/Resource.*Stack2\/NewBucketNameInStack2\/Resource/,
      ),
      data: expect.objectContaining({
        typedMappings: [
          {
            sourcePath: 'Stack2/OldBucketName/Resource',
            destinationPath: 'Stack2/NewBucketNameInStack2/Resource',
            type: 'AWS::S3::Bucket',
          },
        ],
      }),
    }),
  );
});

describe('refactor execution', () => {
  beforeEach(() => {
    process.stdout.isTTY = false;
  });

  test('happy path', async () => {
    // GIVEN
    givenDeployedStackWithResources('Stack1', {
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
      Account: '333333333333',
      Arn: 'arn:aws:sts::333333333333:assumed-role/role-name/role-session-name',
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
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(CreateStackRefactorCommand, {
      EnableStackCreation: true,
      ResourceMappings: [
        {
          Destination: { LogicalResourceId: 'MyBucketF68F3FF0', StackName: 'Stack1' },
          Source: { LogicalResourceId: 'OldLogicalID', StackName: 'Stack1' },
        },
      ],
      StackDefinitions: [
        {
          StackName: 'Stack1',
          TemplateBody: JSON.stringify({
            Resources: {
              MyBucketF68F3FF0: {
                Type: 'AWS::S3::Bucket',
                UpdateReplacePolicy: 'Retain',
                DeletionPolicy: 'Retain',
                Metadata: { 'aws:cdk:path': 'Stack1/OldLogicalID/Resource' },
              },
              CDKMetadata: {
                Type: 'AWS::CDK::Metadata',
                Properties: {
                  Analytics:
                    'v2:deflate64:H4sIAAAAAAAA/zPSMzIw1DNQTCwv1k1OydbNyUzSqw4uSUzO1kksL44vNtardipNzk4t0XFOy4Owamt18vJTUvWyivXLjIz0DM30DBSzijMzdYtK80oyc1P1giA0AJXmpMZbAAAA',
                },
                Metadata: { 'aws:cdk:path': 'Stack1/CDKMetadata/Default' },
                Condition: 'CDKMetadataAvailable',
              },
            },
            Conditions: {
              CDKMetadataAvailable: {
                'Fn::Or': [
                  {
                    'Fn::Or': [
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'af-south-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-east-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-northeast-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-northeast-2'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-northeast-3'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-south-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-south-2'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-southeast-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-southeast-2'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-southeast-3'] },
                    ],
                  },
                  {
                    'Fn::Or': [
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ap-southeast-4'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ca-central-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'ca-west-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'cn-north-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'cn-northwest-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-central-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-central-2'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-north-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-south-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-south-2'] },
                    ],
                  },
                  {
                    'Fn::Or': [
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-west-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-west-2'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'eu-west-3'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'il-central-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'me-central-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'me-south-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'sa-east-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'us-east-1'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'us-east-2'] },
                      { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'us-west-1'] },
                    ],
                  },
                  { 'Fn::Equals': [{ Ref: 'AWS::Region' }, 'us-west-2'] },
                ],
              },
            },
            Parameters: {
              BootstrapVersion: {
                Type: 'AWS::SSM::Parameter::Value<String>',
                Default: '/cdk-bootstrap/hnb659fds/version',
                Description:
                  'Version of the CDK Bootstrap resources in this environment, automatically retrieved from SSM Parameter Store. [cdk:skip]',
              },
            },
            Rules: {
              CheckBootstrapVersion: {
                Assertions: [
                  {
                    Assert: {
                      'Fn::Not': [{ 'Fn::Contains': [['1', '2', '3', '4', '5'], { Ref: 'BootstrapVersion' }] }],
                    },
                    AssertDescription:
                      "CDK bootstrap stack version 6 required. Please run 'cdk bootstrap' with a recent version of the CDK CLI.",
                  },
                ],
              },
            },
          }),
        },
      ],
    });

    expect(ioHost.notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/Stack refactor complete/),
      }),
    );
  });

  test('interactive mode, without force', async () => {
    // GIVEN
    givenDeployedStackWithResources('Stack1', {
      OldLogicalID: {
        Type: 'AWS::S3::Bucket',
        UpdateReplacePolicy: 'Retain',
        DeletionPolicy: 'Retain',
        Metadata: {
          'aws:cdk:path': 'Stack1/OldLogicalID/Resource',
        },
      },
    });

    try {
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
          defaultResponse: 'y',
          level: 'info',
          message: 'Do you wish to refactor these resources?',
        }),
      );
    } finally {
      process.stdout.isTTY = false;
    }
  });

  test('interactive mode, with force', async () => {
    // GIVEN
    givenDeployedStackWithResources('Stack1', {
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
    givenDeployedStackWithResources('Stack1', {
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
      Account: '333333333333',
      Arn: 'arn:aws:sts::333333333333:assumed-role/role-name/role-session-name',
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
      StatusReason: 'Some error occurred during execution',
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
        message: expect.stringMatching('Some error occurred during execution'),
      }),
    );
  });

  test('refactor creation fails', async () => {
    // GIVEN
    givenDeployedStackWithResources('Stack1', {
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
      Account: '333333333333',
      Arn: 'arn:aws:sts::333333333333:assumed-role/role-name/role-session-name',
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
      StatusReason: 'Some error occurred during creation',
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
        message: expect.stringMatching('Some error occurred during creation'),
      }),
    );
  });

  test('bootstrap version lower than minimum required', async () => {
    // GIVEN
    givenDeployedStackWithResources('Stack1', {
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
      Account: '333333333333',
      Arn: 'arn:aws:sts::333333333333:assumed-role/role-name/role-session-name',
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
        message: expect.stringMatching(
          "The CDK toolkit stack in environment aws://123456789012/us-east-1 doesn't support refactoring. Please run 'cdk bootstrap aws://123456789012/us-east-1' to update it.",
        ),
      }),
    );
  });
});

function givenDeployedStackWithResources(stackName: string, resources: Record<string, any>) {
  mockCloudFormationClient.on(ListStacksCommand).resolves({
    StackSummaries: [
      {
        StackName: stackName,
        StackId: `arn:aws:cloudformation:us-east-1:333333333333:stack/${stackName}`,
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

async function expectRefactorBehavior<E = {}>(fixtureName: string, input: RefactorOptions, output: E) {
  const host = new TestIoHost();
  const tk = new Toolkit({ ioHost: host, unstableFeatures: ['refactor'] });
  await tk.refactor(await builderFixture(tk, fixtureName), input);
  expect(host.notifySpy).toHaveBeenCalledWith(expect.objectContaining(output));
}
