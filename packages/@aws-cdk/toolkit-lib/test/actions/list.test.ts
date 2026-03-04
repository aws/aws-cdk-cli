import { ArtifactMetadataEntryType } from '@aws-cdk/cloud-assembly-schema';
import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import { Toolkit } from '../../lib/toolkit';
import { disposableCloudAssemblySource, TestIoHost } from '../_helpers';
import type { TestStackArtifact } from '../_helpers/test-cloud-assembly-source';
import { TestCloudAssemblySource } from '../_helpers/test-cloud-assembly-source';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
});

describe('list', () => {
  test('defaults to listing all stacks', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [MOCK_STACK_A, MOCK_STACK_B, MOCK_STACK_C],
    });

    // WHEN
    const stacks = await toolkit.list(cx);

    // THEN
    const expected = [
      expect.objectContaining({ id: 'Test-Stack-A' }),
      expect.objectContaining({ id: 'Test-Stack-B' }),
      expect.objectContaining({ id: 'Test-Stack-C' }),
    ];
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list',
      level: 'result',
      code: 'CDK_TOOLKIT_I2901',
      message: [
        'Test-Stack-A',
        'Test-Stack-B',
        'Test-Stack-C',
      ].join('\n'),
      data: { stacks: expected },
    }));
    expect(stacks).toEqual(expected);
  });

  test('lists only matched stacks', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [MOCK_STACK_A, MOCK_STACK_B, MOCK_STACK_C],
    });

    // WHEN
    const stacks = await toolkit.list(cx, {
      stacks: {
        patterns: ['Test-Stack-A', 'Test-Stack-C'],
        strategy: StackSelectionStrategy.PATTERN_MATCH,
      },
    });

    // THEN
    const expected = [
      expect.objectContaining({ id: 'Test-Stack-A' }),
      expect.objectContaining({ id: 'Test-Stack-C' }),
    ];
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list',
      level: 'result',
      code: 'CDK_TOOLKIT_I2901',
      message: ['Test-Stack-A', 'Test-Stack-C'].join('\n'),
      data: { stacks: expected },
    }));
    expect(stacks).toEqual(expected);
  });

  test('stacks with no dependencies', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [MOCK_STACK_A, MOCK_STACK_B],
    });

    // WHEN
    const stacks = await toolkit.list(cx, {
      stacks: {
        patterns: ['Test-Stack-A', 'Test-Stack-B'],
        strategy: StackSelectionStrategy.PATTERN_MATCH,
      },
    });

    // THEN
    const expected = [{
      id: 'Test-Stack-A',
      name: 'Test-Stack-A',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_A.metadata,
      dependencies: [],
    },
    {
      id: 'Test-Stack-B',
      name: 'Test-Stack-B',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_B.metadata,
      dependencies: [],
    }];
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list',
      level: 'result',
      code: 'CDK_TOOLKIT_I2901',
      message: ['Test-Stack-A', 'Test-Stack-B'].join('\n'),
      data: { stacks: expected },
    }));
    expect(stacks).toEqual(expected);
  });

  test('stacks with dependent stacks', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [
        MOCK_STACK_A,
        {
          ...MOCK_STACK_B,
          depends: ['Test-Stack-A'],
        },
      ],
    });

    // WHEN
    const stacks = await toolkit.list(cx);

    // THEN
    const expected = [{
      id: 'Test-Stack-A',
      name: 'Test-Stack-A',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_A.metadata,
      dependencies: [],
    },
    {
      id: 'Test-Stack-B',
      name: 'Test-Stack-B',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_B.metadata,
      dependencies: [{
        id: 'Test-Stack-A',
        dependencies: [],
      }],
    }];
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list',
      level: 'result',
      code: 'CDK_TOOLKIT_I2901',
      message: ['Test-Stack-A', 'Test-Stack-B'].join('\n'),
      data: { stacks: expected },
    }));
    expect(stacks).toEqual(expected);
  });

  // In the context where we have a display name set to hieraricalId/stackName
  // we would need to pass in the displayName to list the stacks.
  test('stacks with dependent stacks and have display name set to hieraricalId/stackName', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [
        MOCK_STACK_A,
        {
          ...MOCK_STACK_B,
          depends: ['Test-Stack-A'],
          displayName: 'Test-Stack-A/Test-Stack-B',
        },
      ],
    });

    // WHEN
    const stacks = await toolkit.list(cx);

    // THEN
    const expected = [{
      id: 'Test-Stack-A',
      name: 'Test-Stack-A',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_A.metadata,
      dependencies: [],
    },
    {
      id: 'Test-Stack-A/Test-Stack-B',
      name: 'Test-Stack-B',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_B.metadata,
      dependencies: [{
        id: 'Test-Stack-A',
        dependencies: [],
      }],
    }];
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list',
      level: 'result',
      code: 'CDK_TOOLKIT_I2901',
      message: [
        'Test-Stack-A',
        'Test-Stack-A/Test-Stack-B',
      ].join('\n'),
      data: { stacks: expected },
    }));
    expect(stacks).toEqual(expected);
  });

  test('stacks with display names and have nested dependencies', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [
        MOCK_STACK_A,
        {
          ...MOCK_STACK_B,
          depends: ['Test-Stack-A'],
          displayName: 'Test-Stack-A/Test-Stack-B',
        },
        {
          ...MOCK_STACK_C,
          depends: ['Test-Stack-B'],
          displayName: 'Test-Stack-A/Test-Stack-B/Test-Stack-C',
        },
      ],
    });

    // WHEN
    const stacks = await toolkit.list(cx);

    // THEN
    const expected = [{
      id: 'Test-Stack-A',
      name: 'Test-Stack-A',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_A.metadata,
      dependencies: [],
    },
    {
      id: 'Test-Stack-A/Test-Stack-B',
      name: 'Test-Stack-B',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_B.metadata,
      dependencies: [{
        id: 'Test-Stack-A',
        dependencies: [],
      }],
    },
    {
      id: 'Test-Stack-A/Test-Stack-B/Test-Stack-C',
      name: 'Test-Stack-C',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_C.metadata,
      dependencies: [{
        id: 'Test-Stack-A/Test-Stack-B',
        dependencies: [{
          id: 'Test-Stack-A',
          dependencies: [],
        }],
      }],
    }];
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list',
      level: 'result',
      code: 'CDK_TOOLKIT_I2901',
      message: [
        'Test-Stack-A',
        'Test-Stack-A/Test-Stack-B',
        'Test-Stack-A/Test-Stack-B/Test-Stack-C',
      ].join('\n'),
      data: { stacks: expected },
    }));
    expect(stacks).toEqual(expected);
  });

  test('stacks with nested dependencies', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [
        MOCK_STACK_A,
        {
          ...MOCK_STACK_B,
          depends: [MOCK_STACK_A.stackName],
        },
        {
          ...MOCK_STACK_C,
          depends: [MOCK_STACK_B.stackName],
        },
      ],
    });

    // WHEN
    const stacks = await toolkit.list(cx);

    // THEN
    const expected = [{
      id: 'Test-Stack-A',
      name: 'Test-Stack-A',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_A.metadata,
      dependencies: [],
    },
    {
      id: 'Test-Stack-B',
      name: 'Test-Stack-B',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_B.metadata,
      dependencies: [{
        id: 'Test-Stack-A',
        dependencies: [],
      }],
    },
    {
      id: 'Test-Stack-C',
      name: 'Test-Stack-C',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_C.metadata,
      dependencies: [{
        id: 'Test-Stack-B',
        dependencies: [{
          id: 'Test-Stack-A',
          dependencies: [],
        }],
      }],
    }];
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list',
      level: 'result',
      code: 'CDK_TOOLKIT_I2901',
      message: [
        'Test-Stack-A',
        'Test-Stack-B',
        'Test-Stack-C',
      ].join('\n'),
      data: { stacks: expected },
    }));
    expect(stacks).toEqual(expected);
  });

  // In the context of stacks with cross-stack or cross-region references,
  // the dependency mechanism is responsible for appropriately applying dependencies at the correct hierarchy level,
  // typically at the top-level stacks.
  // This involves handling the establishment of cross-references between stacks or nested stacks
  // and generating assets for nested stack templates as necessary.
  test('stacks with cross stack referencing', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [
        {
          ...MOCK_STACK_A,
          depends: [MOCK_STACK_C.stackName],
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
        },
        MOCK_STACK_C,
      ],
    });

    // WHEN
    const stacks = await toolkit.list(cx);

    // THEN
    const expected = [{
      id: 'Test-Stack-C',
      name: 'Test-Stack-C',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_C.metadata,
      dependencies: [],
    },
    {
      id: 'Test-Stack-A',
      name: 'Test-Stack-A',
      environment: {
        account: '123456789012',
        region: 'bermuda-triangle-1',
        name: 'aws://123456789012/bermuda-triangle-1',
      },
      metadata: MOCK_STACK_A.metadata,
      dependencies: [{
        id: 'Test-Stack-C',
        dependencies: [],
      }],
    }];
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'list',
      level: 'result',
      code: 'CDK_TOOLKIT_I2901',
      message: [
        'Test-Stack-C',
        'Test-Stack-A',
      ].join('\n'),
      data: { stacks: expected },
    }));
    expect(stacks).toEqual(expected);
  });

  test('stacks with circular dependencies should error out', async () => {
    // GIVEN
    const cx = new TestCloudAssemblySource({
      stacks: [
        {
          ...MOCK_STACK_A,
          depends: [MOCK_STACK_B.stackName],
        },
        {
          ...MOCK_STACK_B,
          depends: [MOCK_STACK_A.stackName],
        },
      ],
    });

    // THEN
    await expect(() => toolkit.list(cx)).rejects.toThrow('Could not determine ordering');
    expect(ioHost.notifySpy).not.toHaveBeenCalledWith(expect.objectContaining({
      code: 'CDK_TOOLKIT_I2901',
    }));
  });

  test('action disposes of assembly produced by source', async () => {
    // GIVEN
    const [assemblySource, mockDispose, realDispose] = await disposableCloudAssemblySource(toolkit);

    // WHEN
    await toolkit.list(assemblySource, {
      stacks: { strategy: StackSelectionStrategy.ALL_STACKS },
    });

    // THEN
    expect(mockDispose).toHaveBeenCalled();
    await realDispose();
  });
});

const MOCK_STACK_A: TestStackArtifact = {
  stackName: 'Test-Stack-A',
  template: { Resources: { TemplateName: 'Test-Stack-A' } },
  env: 'aws://123456789012/bermuda-triangle-1',
  metadata: {
    '/Test-Stack-A': [
      {
        type: ArtifactMetadataEntryType.STACK_TAGS,
        data: [],
      },
    ],
  },
};
const MOCK_STACK_B: TestStackArtifact = {
  stackName: 'Test-Stack-B',
  template: { Resources: { TemplateName: 'Test-Stack-B' } },
  env: 'aws://123456789012/bermuda-triangle-1',
  metadata: {
    '/Test-Stack-B': [
      {
        type: ArtifactMetadataEntryType.STACK_TAGS,
        data: [],
      },
    ],
  },
};
const MOCK_STACK_C: TestStackArtifact = {
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
    '/Test-Stack-C': [
      {
        type: ArtifactMetadataEntryType.STACK_TAGS,
        data: [],
      },
    ],
  },
};
