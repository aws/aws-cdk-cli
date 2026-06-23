import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import type { StackDetails } from '@aws-cdk/toolkit-lib';
import { Deployments } from '../../lib/api/deployments';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { formatStackList } from '../../lib/commands/list-stacks';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';
import type { TestStackArtifact } from '../_helpers';
import { IoHostRecorder } from '../_helpers/io-recorder';

const env = {
  account: '123456789012',
  region: 'bermuda-triangle-1',
  name: 'aws://123456789012/bermuda-triangle-1',
};

// `cdk list` selects and orders stacks via the toolkit-lib `list` action and
// renders them through CliIoHost listeners (the stack listing, and under
// `--json` the suppression of the synthesis-time line). These tests run the
// command end-to-end and snapshot everything the user sees (via IoHostRecorder),
// so the committed NDJSON is the assertion — selection, ordering and rendering
// all show up there.
describe('cdk list', () => {
  const ioHost = CliIoHost.instance();
  let recorder: IoHostRecorder;

  beforeEach(() => {
    jest.resetAllMocks();
    // Exercise the real notify path so the output listeners actually run.
    jest.spyOn(ioHost, 'notify').mockImplementation(((m: any) => CliIoHost.prototype.notify.call(ioHost, m)) as any);
    recorder = IoHostRecorder.create(ioHost);
  });

  afterEach(async () => {
    await recorder.matchSnapshot();
  });

  async function list(
    stacks: TestStackArtifact[],
    selectors: string[],
    options?: { long?: boolean; json?: boolean; showDeps?: boolean },
  ) {
    const cloudExecutable = await MockCloudExecutable.create({ stacks }, undefined, ioHost, 'list');
    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: instanceMockFrom(Deployments),
    });
    await toolkit.list(selectors, options);
  }

  function stackB(extra: Partial<TestStackArtifact> = {}): TestStackArtifact {
    return {
      stackName: 'Test-Stack-B',
      template: { Resources: { TemplateName: 'Test-Stack-B' } },
      env: 'aws://123456789012/bermuda-triangle-1',
      metadata: { '/Test-Stack-B': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }] },
      ...extra,
    };
  }

  test('lists the selected stacks', async () => {
    await list([MockStack.MOCK_STACK_A, stackB()], ['Test-Stack-A', 'Test-Stack-B']);
  });

  test('shows the dependencies between stacks', async () => {
    await list(
      [MockStack.MOCK_STACK_A, stackB({ depends: ['Test-Stack-A'] })],
      ['Test-Stack-A', 'Test-Stack-B'],
      { showDeps: true },
    );
  });

  test('lists a multi-level dependency chain in order', async () => {
    await list(
      [
        MockStack.MOCK_STACK_A,
        stackB({ depends: ['Test-Stack-A'] }),
        {
          stackName: 'Test-Stack-C',
          template: { Resources: { TemplateName: 'Test-Stack-C' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: { '/Test-Stack-C': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }] },
          depends: ['Test-Stack-B'],
        },
      ],
      ['Test-Stack-A', 'Test-Stack-B', 'Test-Stack-C'],
      { showDeps: true },
    );
  });

  test('shows nested dependencies addressed by display name', async () => {
    await list(
      [
        MockStack.MOCK_STACK_A,
        stackB({ depends: ['Test-Stack-A'], displayName: 'Test-Stack-A/Test-Stack-B' }),
        {
          stackName: 'Test-Stack-C',
          template: { Resources: { TemplateName: 'Test-Stack-C' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: { '/Test-Stack-C': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }] },
          depends: ['Test-Stack-B'],
          displayName: 'Test-Stack-A/Test-Stack-B/Test-Stack-C',
        },
      ],
      ['Test-Stack-A', 'Test-Stack-A/Test-Stack-B', 'Test-Stack-A/Test-Stack-B/Test-Stack-C'],
      { showDeps: true },
    );
  });

  test('orders cross-stack references by dependency', async () => {
    await list(
      [
        {
          stackName: 'Test-Stack-A',
          template: {
            Resources: {
              MyBucket1Reference: {
                Type: 'AWS::CloudFormation::Stack',
                Properties: {
                  TemplateURL: 'XXXXXXXXXXXXXXXXXXXXXXXXX',
                  Parameters: { BucketName: { 'Fn::GetAtt': ['MyBucket1', 'Arn'] } },
                },
              },
            },
          },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: { '/Test-Stack-A': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }] },
          depends: ['Test-Stack-C'],
        },
        MockStack.MOCK_STACK_C,
      ],
      ['Test-Stack-A', 'Test-Stack-C'],
      { showDeps: true },
    );
  });

  test('prints machine-readable JSON without the synthesis-time line', async () => {
    await list([MockStack.MOCK_STACK_A, stackB()], ['Test-Stack-A', 'Test-Stack-B'], { json: true });
  });

  test('lists full stack details with --long', async () => {
    await list([MockStack.MOCK_STACK_A, stackB()], ['Test-Stack-A', 'Test-Stack-B'], { long: true });
  });

  test('fails when stacks have a circular dependency', async () => {
    await expect(list(
      [
        {
          stackName: 'Test-Stack-A',
          template: { Resources: { TemplateName: 'Test-Stack-A' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: { '/Test-Stack-A': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }] },
          depends: ['Test-Stack-B'],
        },
        stackB({ depends: ['Test-Stack-A'] }),
      ],
      ['Test-Stack-A', 'Test-Stack-B'],
    )).rejects.toThrow('Could not determine ordering');
  });
});

describe('formatStackList', () => {
  const stacks: StackDetails[] = [
    { id: 'Stack-A', name: 'Stack-A', environment: env, dependencies: [] },
    { id: 'Stack-B', name: 'Stack-B', environment: env, dependencies: [{ id: 'Stack-A', dependencies: [] }] },
  ];

  test('by default lists the stack ids, one per line', () => {
    expect(formatStackList(stacks)).toEqual('Stack-A\nStack-B');
  });

  test('--json alone still only lists the stack ids', () => {
    expect(formatStackList(stacks, { json: true })).toEqual('Stack-A\nStack-B');
  });

  test('--long --json serializes id, name and environment', () => {
    expect(JSON.parse(formatStackList(stacks, { long: true, json: true }))).toEqual([
      { id: 'Stack-A', name: 'Stack-A', environment: env },
      { id: 'Stack-B', name: 'Stack-B', environment: env },
    ]);
  });

  test('--show-dependencies --json serializes id and dependencies', () => {
    expect(JSON.parse(formatStackList(stacks, { showDeps: true, json: true }))).toEqual([
      { id: 'Stack-A', dependencies: [] },
      { id: 'Stack-B', dependencies: [{ id: 'Stack-A', dependencies: [] }] },
    ]);
  });

  test('--long --show-dependencies --json serializes the full stack details', () => {
    expect(JSON.parse(formatStackList(stacks, { long: true, showDeps: true, json: true }))).toEqual(stacks);
  });

  test('--long --show-dependencies --json omits (potentially huge) metadata', () => {
    const withMetadata: StackDetails[] = [
      { id: 'Stack-A', name: 'Stack-A', environment: env, dependencies: [], metadata: { '/Stack-A': [] } },
    ];

    expect(JSON.parse(formatStackList(withMetadata, { long: true, showDeps: true, json: true }))).toEqual([
      { id: 'Stack-A', name: 'Stack-A', environment: env, dependencies: [] },
    ]);
  });
});

class MockStack {
  public static readonly MOCK_STACK_A: TestStackArtifact = {
    stackName: 'Test-Stack-A',
    template: { Resources: { TemplateName: 'Test-Stack-A' } },
    env: 'aws://123456789012/bermuda-triangle-1',
    metadata: {
      '/Test-Stack-A': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
    },
  };
  public static readonly MOCK_STACK_C: TestStackArtifact = {
    stackName: 'Test-Stack-C',
    template: {
      Resources: {
        MyBucket1: {
          Type: 'AWS::S3::Bucket',
          Properties: {
            AccessControl: 'PublicRead',
          },
          DeletionPolicy: 'Retain',
        },
      },
    },
    env: 'aws://123456789012/bermuda-triangle-1',
    metadata: {
      '/Test-Stack-C': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
    },
  };
}
