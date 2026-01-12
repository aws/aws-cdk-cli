import * as path from 'path';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { CliIoHost } from '../../lib/cli/io-host';
import { Deployments } from '../../lib/api/deployments';
import { MockCloudExecutable, TestStackArtifact } from '../_helpers/assembly';
import { instanceMockFrom } from '../_helpers/as-mock';

// Mock stacks for testing
const MOCK_STACK_WITH_ASSET: TestStackArtifact = {
  stackName: 'Test-Stack-Asset',
  template: { Resources: { TemplateName: 'Test-Stack-Asset' } },
  env: 'aws://123456789012/bermuda-triangle-1',
  assetManifest: {
    version: Manifest.version(),
    files: {
      xyz: {
        displayName: 'Asset Display Name',
        source: {
          path: path.resolve(__dirname, '..', '..', 'LICENSE'),
        },
        destinations: {
          desto: {
            bucketName: 'some-bucket',
            objectKey: 'some-key',
            assumeRoleArn: 'arn:aws:role',
          },
        },
      },
    },
  },
  displayName: 'Test-Stack-Asset',
};

const MOCK_STACK_A: TestStackArtifact = {
  stackName: 'Test-Stack-A',
  template: { Resources: { TemplateName: 'Test-Stack-A' } },
  env: 'aws://123456789012/bermuda-triangle-1',
  displayName: 'Test-Stack-A',
};

const MOCK_STACK_B: TestStackArtifact = {
  stackName: 'Test-Stack-B',
  template: { Resources: { TemplateName: 'Test-Stack-B' } },
  env: 'aws://123456789012/bermuda-triangle-1',
  displayName: 'Test-Stack-B',
  depends: [MOCK_STACK_WITH_ASSET.stackName],
};

let cloudExecutable: MockCloudExecutable;
let ioHost: CliIoHost;

beforeEach(async () => {
  jest.clearAllMocks();

  cloudExecutable = await MockCloudExecutable.create({
    stacks: [MOCK_STACK_WITH_ASSET],
  });

  ioHost = CliIoHost.instance();
});

describe('cdk publish', () => {
  test('publishes assets successfully', async () => {
    // GIVEN
    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_WITH_ASSET.stackName] },
    });

    // THEN
    expect(mockDeployments.buildSingleAsset).toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).toHaveBeenCalled();
  });

  test('calls removePublishedAssets to skip already published assets when --force is not provided', async () => {
    // GIVEN
    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(true); // Asset already published

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_WITH_ASSET.stackName] },
    });

    // THEN
    // removePublishedAssets checks if assets are already published
    expect(mockDeployments.isSingleAssetPublished).toHaveBeenCalled();
    // Already-published assets are removed from work graph, so build/publish should not be called
    expect(mockDeployments.buildSingleAsset).not.toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).not.toHaveBeenCalled();
  });

  test('skips removePublishedAssets and passes forcePublish flag when --force is provided', async () => {
    // GIVEN
    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    // Note: isSingleAssetPublished is NOT mocked because it should not be called with --force

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_WITH_ASSET.stackName] },
      force: true,
    });

    // THEN
    // With --force, removePublishedAssets is skipped, so isSingleAssetPublished should not be called
    expect(mockDeployments.isSingleAssetPublished).not.toHaveBeenCalled();
    // Assets should be built and published even if already published
    expect(mockDeployments.buildSingleAsset).toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        forcePublish: true,
      }),
    );
  });

  test('publishes assets for multiple stacks', async () => {
    // GIVEN
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MOCK_STACK_WITH_ASSET, MOCK_STACK_A],
    });

    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN
    await toolkit.publish({
      selector: { patterns: ['*'] },
    });

    // THEN
    // Should process assets from the stack that has assets
    expect(mockDeployments.buildSingleAsset).toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).toHaveBeenCalled();
  });

  test('handles stacks with no assets', async () => {
    // GIVEN
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MOCK_STACK_A], // Stack without assets
    });

    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_A.stackName] },
    });

    // THEN
    // Should not attempt to build or publish assets
    expect(mockDeployments.buildSingleAsset).not.toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).not.toHaveBeenCalled();
  });

  test('respects roleArn option', async () => {
    // GIVEN
    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    const roleArn = 'arn:aws:iam::123456789012:role/PublishRole';

    // WHEN
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_WITH_ASSET.stackName] },
      roleArn,
    });

    // THEN
    expect(mockDeployments.buildSingleAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        roleArn,
      }),
    );
    expect(mockDeployments.publishSingleAsset).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        roleArn,
      }),
    );
  });

  test('throws error when no stacks are selected', async () => {
    // GIVEN
    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: instanceMockFrom(Deployments), // Not used, error occurs during stack selection
    });

    // WHEN/THEN - try to publish a non-existent stack
    await expect(toolkit.publish({
      selector: { patterns: ['NonExistentStack'] },
    })).rejects.toThrow('No stacks match the name(s) NonExistentStack');
  });

  test('includes dependencies by default', async () => {
    // GIVEN - Stack with dependency
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MOCK_STACK_WITH_ASSET, MOCK_STACK_B],
    });

    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN - publish Test-Stack-B (default behavior includes dependencies)
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_B.stackName] },
    });

    // THEN - Should include dependency (MOCK_STACK_WITH_ASSET) and publish its assets
    expect(mockDeployments.buildSingleAsset).toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).toHaveBeenCalled();
  });

  test('excludes dependencies with exclusively option', async () => {
    // GIVEN - Stack with dependency
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MOCK_STACK_WITH_ASSET, MOCK_STACK_B],
    });

    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN - publish Test-Stack-B exclusively (without dependencies)
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_B.stackName] },
      exclusively: true,
    });

    // THEN - Should not include dependency, so no assets are published
    expect(mockDeployments.buildSingleAsset).not.toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).not.toHaveBeenCalled();
  });

  test('publishes multiple assets from the same stack', async () => {
    // GIVEN - Stack with multiple assets
    const MOCK_STACK_MULTI_ASSET: TestStackArtifact = {
      stackName: 'Test-Stack-Multi-Asset',
      template: { Resources: { TemplateName: 'Test-Stack-Multi-Asset' } },
      env: 'aws://123456789012/bermuda-triangle-1',
      assetManifest: {
        version: Manifest.version(),
        files: {
          asset1: {
            displayName: 'Asset 1',
            source: {
              path: path.resolve(__dirname, '..', '..', 'LICENSE'),
            },
            destinations: {
              dest1: {
                bucketName: 'bucket-1',
                objectKey: 'key-1',
                assumeRoleArn: 'arn:aws:role',
              },
            },
          },
          asset2: {
            displayName: 'Asset 2',
            source: {
              path: path.resolve(__dirname, '..', '..', 'README.md'),
            },
            destinations: {
              dest2: {
                bucketName: 'bucket-2',
                objectKey: 'key-2',
                assumeRoleArn: 'arn:aws:role',
              },
            },
          },
        },
      },
      displayName: 'Test-Stack-Multi-Asset',
    };

    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MOCK_STACK_MULTI_ASSET],
    });

    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_MULTI_ASSET.stackName] },
    });

    // THEN - Should build and publish both assets
    expect(mockDeployments.buildSingleAsset).toHaveBeenCalledTimes(2);
    expect(mockDeployments.publishSingleAsset).toHaveBeenCalledTimes(2);
  });

  test('publishes Docker image assets', async () => {
    // GIVEN - Stack with Docker asset
    const MOCK_STACK_DOCKER: TestStackArtifact = {
      stackName: 'Test-Stack-Docker',
      template: { Resources: { TemplateName: 'Test-Stack-Docker' } },
      env: 'aws://123456789012/bermuda-triangle-1',
      assetManifest: {
        version: Manifest.version(),
        dockerImages: {
          dockerAsset: {
            displayName: 'Docker Image',
            source: {
              directory: path.resolve(__dirname, '..', '..'),
            },
            destinations: {
              dest: {
                repositoryName: 'my-repo',
                imageTag: 'latest',
                assumeRoleArn: 'arn:aws:role',
              },
            },
          },
        },
      },
      displayName: 'Test-Stack-Docker',
    };

    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MOCK_STACK_DOCKER],
    });

    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN
    await toolkit.publish({
      selector: { patterns: [MOCK_STACK_DOCKER.stackName] },
    });

    // THEN - Should build and publish Docker asset
    expect(mockDeployments.buildSingleAsset).toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).toHaveBeenCalled();
  });

  test('publishes all stacks with allTopLevel selector', async () => {
    // GIVEN
    cloudExecutable = await MockCloudExecutable.create({
      stacks: [MOCK_STACK_WITH_ASSET, MOCK_STACK_A],
    });

    const mockDeployments = instanceMockFrom(Deployments);
    mockDeployments.buildSingleAsset.mockResolvedValue(undefined);
    mockDeployments.publishSingleAsset.mockResolvedValue(undefined);
    mockDeployments.isSingleAssetPublished.mockResolvedValue(false);

    const toolkit = new CdkToolkit({
      ioHost,
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: mockDeployments,
    });

    // WHEN - Use allTopLevel to select all stacks (equivalent to --all)
    await toolkit.publish({
      selector: { patterns: [], allTopLevel: true },
    });

    // THEN - Should process assets from all stacks
    expect(mockDeployments.buildSingleAsset).toHaveBeenCalled();
    expect(mockDeployments.publishSingleAsset).toHaveBeenCalled();
  });
});
