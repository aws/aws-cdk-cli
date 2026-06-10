import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import type { StackDetails } from '@aws-cdk/toolkit-lib';
import { Deployments } from '../../lib/api/deployments';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { formatStackList } from '../../lib/commands/list-stacks';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';
import type { TestStackArtifact } from '../_helpers';

const env = {
  account: '123456789012',
  region: 'bermuda-triangle-1',
  name: 'aws://123456789012/bermuda-triangle-1',
};

// The `list` command delegates stack selection and dependency ordering to the
// toolkit-lib `list` action, which emits the selected stacks as the payload of
// a single CDK_TOOLKIT_I2901 result message. These tests drive `CdkToolkit.list`
// and assert on that payload to keep coverage of the selection/ordering behavior.
describe('CdkToolkit.list', () => {
  const ioHost = CliIoHost.instance();
  let cloudFormation: jest.Mocked<Deployments>;
  let notifySpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    cloudFormation = instanceMockFrom(Deployments);
    notifySpy = jest.spyOn(ioHost, 'notify');
  });

  /**
   * Run `cdk list` and return the selected stacks (id, name, environment and
   * dependencies) from the emitted CDK_TOOLKIT_I2901 message. Metadata is
   * dropped so assertions stay focused on selection and ordering.
   */
  async function runList(cloudExecutable: MockCloudExecutable, selectors: string[]) {
    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    notifySpy.mockClear();
    await toolkit.list(selectors);

    const msg = notifySpy.mock.calls
      .map(call => call[0])
      .find((m: any) => m.code === 'CDK_TOOLKIT_I2901');
    if (!msg) {
      throw new Error('expected a CDK_TOOLKIT_I2901 message to be emitted');
    }
    return (msg.data as { stacks: StackDetails[] }).stacks.map(stack => ({
      id: stack.id,
      name: stack.name,
      environment: stack.environment,
      dependencies: stack.dependencies,
    }));
  }

  test('stacks with no dependencies', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        MockStack.MOCK_STACK_A,
        {
          stackName: 'Test-Stack-B',
          template: { Resources: { TemplateName: 'Test-Stack-B' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-B': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
        },
      ],
    });

    const stacks = await runList(cloudExecutable, ['Test-Stack-A', 'Test-Stack-B']);

    expect(stacks).toEqual([
      { id: 'Test-Stack-A', name: 'Test-Stack-A', environment: env, dependencies: [] },
      { id: 'Test-Stack-B', name: 'Test-Stack-B', environment: env, dependencies: [] },
    ]);
  });

  test('stacks with dependent stacks', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        MockStack.MOCK_STACK_A,
        {
          stackName: 'Test-Stack-B',
          template: { Resources: { TemplateName: 'Test-Stack-B' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-B': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-A'],
        },
      ],
    });

    const stacks = await runList(cloudExecutable, ['Test-Stack-A', 'Test-Stack-B']);

    expect(stacks).toEqual([
      { id: 'Test-Stack-A', name: 'Test-Stack-A', environment: env, dependencies: [] },
      {
        id: 'Test-Stack-B',
        name: 'Test-Stack-B',
        environment: env,
        dependencies: [{ id: 'Test-Stack-A', dependencies: [] }],
      },
    ]);
  });

  // In the context where we have a display name set to hierarchicalId/stackName
  // we would need to pass in the displayName to list the stacks.
  test('stacks with dependent stacks and display name set to hierarchicalId/stackName', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        MockStack.MOCK_STACK_A,
        {
          stackName: 'Test-Stack-B',
          template: { Resources: { TemplateName: 'Test-Stack-B' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-B': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-A'],
          displayName: 'Test-Stack-A/Test-Stack-B',
        },
      ],
    });

    const stacks = await runList(cloudExecutable, ['Test-Stack-A', 'Test-Stack-A/Test-Stack-B']);

    expect(stacks).toEqual([
      { id: 'Test-Stack-A', name: 'Test-Stack-A', environment: env, dependencies: [] },
      {
        id: 'Test-Stack-A/Test-Stack-B',
        name: 'Test-Stack-B',
        environment: env,
        dependencies: [{ id: 'Test-Stack-A', dependencies: [] }],
      },
    ]);
  });

  test('stacks with display names and nested dependencies', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        MockStack.MOCK_STACK_A,
        {
          stackName: 'Test-Stack-B',
          template: { Resources: { TemplateName: 'Test-Stack-B' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-B': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-A'],
          displayName: 'Test-Stack-A/Test-Stack-B',
        },
        {
          stackName: 'Test-Stack-C',
          template: { Resources: { TemplateName: 'Test-Stack-C' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-C': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-B'],
          displayName: 'Test-Stack-A/Test-Stack-B/Test-Stack-C',
        },
      ],
    });

    const stacks = await runList(cloudExecutable, [
      'Test-Stack-A',
      'Test-Stack-A/Test-Stack-B',
      'Test-Stack-A/Test-Stack-B/Test-Stack-C',
    ]);

    expect(stacks).toEqual([
      { id: 'Test-Stack-A', name: 'Test-Stack-A', environment: env, dependencies: [] },
      {
        id: 'Test-Stack-A/Test-Stack-B',
        name: 'Test-Stack-B',
        environment: env,
        dependencies: [{ id: 'Test-Stack-A', dependencies: [] }],
      },
      {
        id: 'Test-Stack-A/Test-Stack-B/Test-Stack-C',
        name: 'Test-Stack-C',
        environment: env,
        dependencies: [
          {
            id: 'Test-Stack-A/Test-Stack-B',
            dependencies: [{ id: 'Test-Stack-A', dependencies: [] }],
          },
        ],
      },
    ]);
  });

  test('stacks with nested dependencies', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        MockStack.MOCK_STACK_A,
        {
          stackName: 'Test-Stack-B',
          template: { Resources: { TemplateName: 'Test-Stack-B' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-B': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-A'],
        },
        {
          stackName: 'Test-Stack-C',
          template: { Resources: { TemplateName: 'Test-Stack-C' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-C': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-B'],
        },
      ],
    });

    const stacks = await runList(cloudExecutable, ['Test-Stack-A', 'Test-Stack-B', 'Test-Stack-C']);

    expect(stacks).toEqual([
      { id: 'Test-Stack-A', name: 'Test-Stack-A', environment: env, dependencies: [] },
      {
        id: 'Test-Stack-B',
        name: 'Test-Stack-B',
        environment: env,
        dependencies: [{ id: 'Test-Stack-A', dependencies: [] }],
      },
      {
        id: 'Test-Stack-C',
        name: 'Test-Stack-C',
        environment: env,
        dependencies: [
          {
            id: 'Test-Stack-B',
            dependencies: [{ id: 'Test-Stack-A', dependencies: [] }],
          },
        ],
      },
    ]);
  });

  // In the context of stacks with cross-stack or cross-region references, the
  // dependency mechanism applies dependencies at the correct hierarchy level.
  test('stacks with cross stack referencing', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'Test-Stack-A',
          template: {
            Resources: {
              MyBucket1Reference: {
                Type: 'AWS::CloudFormation::Stack',
                Properties: {
                  TemplateURL: 'XXXXXXXXXXXXXXXXXXXXXXXXX',
                  Parameters: {
                    BucketName: { 'Fn::GetAtt': ['MyBucket1', 'Arn'] },
                  },
                },
              },
            },
          },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-A': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-C'],
        },
        MockStack.MOCK_STACK_C,
      ],
    });

    const stacks = await runList(cloudExecutable, ['Test-Stack-A', 'Test-Stack-C']);

    expect(stacks).toEqual([
      { id: 'Test-Stack-C', name: 'Test-Stack-C', environment: env, dependencies: [] },
      {
        id: 'Test-Stack-A',
        name: 'Test-Stack-A',
        environment: env,
        dependencies: [{ id: 'Test-Stack-C', dependencies: [] }],
      },
    ]);
  });

  test('stacks with circular dependencies should error out', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [
        {
          stackName: 'Test-Stack-A',
          template: { Resources: { TemplateName: 'Test-Stack-A' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-A': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-B'],
        },
        {
          stackName: 'Test-Stack-B',
          template: { Resources: { TemplateName: 'Test-Stack-B' } },
          env: 'aws://123456789012/bermuda-triangle-1',
          metadata: {
            '/Test-Stack-B': [{ type: cxschema.ArtifactMetadataEntryType.STACK_TAGS }],
          },
          depends: ['Test-Stack-A'],
        },
      ],
    });

    await expect(runList(cloudExecutable, ['Test-Stack-A', 'Test-Stack-B']))
      .rejects.toThrow('Could not determine ordering');
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
