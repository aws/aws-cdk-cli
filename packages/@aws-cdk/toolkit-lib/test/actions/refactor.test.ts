import { GetTemplateCommand, ListStacksCommand } from '@aws-sdk/client-cloudformation';
import { MappingSource, StackSelectionStrategy, Toolkit } from '../../lib';
import { SdkProvider } from '../../lib/api/aws-auth/private';
import { builderFixture, TestIoHost } from '../_helpers';
import { mockCloudFormationClient, MockSdk } from '../_helpers/mock-sdk';

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

test('fails when dry-run is false', async () => {
  const cx = await builderFixture(toolkit, 'stack-with-bucket');
  await expect(
    toolkit.refactor(cx, {
      dryRun: false,
    }),
  ).rejects.toThrow('Refactor is not available yet. Too see the proposed changes, use the --dry-run flag.');
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
    mappingSource: MappingSource.reverse([{
      account: '123456789012',
      region: 'us-east-1',
      resources: {
        'Stack1.OldLogicalID': 'Stack1.NewLogicalID',
      },
    }]),
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
  expect(ioHost.notifySpy).toHaveBeenCalledTimes(3);

  expect(ioHost.notifySpy).toHaveBeenNthCalledWith(2, expect.objectContaining({
    message: expect.stringMatching('aws://123456789012/us-east-1'),
  }));

  expect(ioHost.notifySpy).toHaveBeenNthCalledWith(2,
    expect.objectContaining({
      action: 'refactor',
      level: 'result',
      code: 'CDK_TOOLKIT_I8900',
      message: expect.stringMatching(/AWS::S3::Bucket.*Stack1\/OldBucketName\/Resource.*Stack1\/NewBucketNameInStack1\/Resource/),
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

  expect(ioHost.notifySpy).toHaveBeenNthCalledWith(3, expect.objectContaining({
    message: expect.stringMatching('aws://123456789012/us-east-2'),
  }));

  expect(ioHost.notifySpy).toHaveBeenNthCalledWith(3,
    expect.objectContaining({
      action: 'refactor',
      level: 'result',
      code: 'CDK_TOOLKIT_I8900',
      message: expect.stringMatching(/AWS::S3::Bucket.*Stack2\/OldBucketName\/Resource.*Stack2\/NewBucketNameInStack2\/Resource/),
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
