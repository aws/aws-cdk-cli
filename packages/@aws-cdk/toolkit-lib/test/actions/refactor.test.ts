import { GetTemplateCommand, ListStacksCommand } from '@aws-sdk/client-cloudformation';
import { StackSelectionStrategy, Toolkit } from '../../lib';
import { SdkProvider } from '../../lib/api/shared-private';
import { builderFixture, TestIoHost } from '../_helpers';
import { mockCloudFormationClient, MockSdkProvider } from '../_helpers/mock-sdk';

// these tests often run a bit longer than the default
jest.setTimeout(10_000);

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });
const mockSdkProvider = new MockSdkProvider();

// we don't need to use AWS CLI compatible defaults here, since everything is mocked anyway
jest.spyOn(SdkProvider, 'withAwsCliCompatibleDefaults').mockResolvedValue(mockSdkProvider);

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
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

test('warns when stack selector is passed', async () => {
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
    stacks: {
      strategy: StackSelectionStrategy.PATTERN_MATCH,
      patterns: ['Stack1'],
    },
  });

  expect(ioHost.notifySpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'refactor',
      level: 'warn',
      code: 'CDK_TOOLKIT_W8010',
      message:
        'Refactor does not yet support stack selection. Proceeding with the default behavior (considering all stacks).',
    }),
  );
});
