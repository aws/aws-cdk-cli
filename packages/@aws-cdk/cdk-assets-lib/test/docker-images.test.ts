jest.mock('child_process');

import 'aws-sdk-client-mock-jest';

import * as fs from 'fs';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import type { GetAuthorizationTokenResponse } from '@aws-sdk/client-ecr';
import {
  DescribeImagesCommand,
  DescribeRepositoriesCommand,
  GetAuthorizationTokenCommand,
} from '@aws-sdk/client-ecr';
import { MockAws, mockEcr, resetDefaultAwsMockBehavior } from './mock-aws';
import { mockSpawn } from './mock-child_process';
import mockfs from './mock-fs';
import type { IAws } from '../lib';
import { AssetManifest, AssetPublishing } from '../lib';
import * as dockercreds from '../lib/private/docker-credentials';

let aws: IAws;
const absoluteDockerPath = mockfs.path('/simple/cdk.out/dockerdir');

const err = new Error('File does not exist');
err.name = 'ImageNotFoundException';

beforeEach(() => {
  jest.resetAllMocks();
  resetDefaultAwsMockBehavior();
  delete process.env.CDK_DOCKER;

  // By default, assume no externally-configured credentials.
  jest.spyOn(dockercreds, 'cdkCredentialsConfig').mockReturnValue(undefined);

  mockfs({
    '/simple/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: 'dockerdir',
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'abcdef',
            },
          },
        },
      },
    }),
    '/multi/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset1: {
          source: {
            directory: 'dockerdir',
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'theAsset1',
            },
          },
        },
        theAsset2: {
          source: {
            directory: 'dockerdir',
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'theAsset2',
            },
          },
        },
      },
    }),
    '/multi2/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset1: {
          source: {
            directory: 'dockerdir',
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              account: '12345',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'theAsset1',
            },
          },
        },
        theAsset2: {
          source: {
            directory: 'dockerdir',
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              account: '12346',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo2',
              imageTag: 'theAsset2',
            },
          },
        },
      },
    }),
    '/external/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theExternalAsset: {
          source: {
            executable: ['sometool'],
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'ghijkl',
            },
          },
        },
      },
    }),
    '/simple/cdk.out/dockerdir/Dockerfile': 'FROM scratch',
    '/abs/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: absoluteDockerPath,
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'abcdef',
            },
          },
        },
      },
    }),
    '/default-network/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: 'dockerdir',
            networkMode: 'default',
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'nopqr',
            },
          },
        },
      },
    }),
    '/default-network/cdk.out/dockerdir/Dockerfile': 'FROM scratch',
    '/platform-arm64/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: 'dockerdir',
            platform: 'linux/arm64',
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'nopqr',
            },
          },
        },
      },
    }),
    '/cache/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: 'dockerdir',
            cacheFrom: [{ type: 'registry', params: { ref: 'abcdef' } }],
            cacheTo: { type: 'inline' },
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'nopqr',
            },
          },
        },
      },
    }),
    '/cache-from-multiple/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: 'dockerdir',
            cacheFrom: [
              { type: 'registry', params: { ref: 'cache:ref' } },
              { type: 'registry', params: { ref: 'cache:main' } },
              { type: 'gha' },
            ],
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'nopqr',
            },
          },
        },
      },
    }),
    '/cache-to-complex/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: 'dockerdir',
            cacheTo: {
              type: 'registry',
              params: { ref: 'cache:main', mode: 'max', compression: 'zstd' },
            },
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'nopqr',
            },
          },
        },
      },
    }),
    '/nocache/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: 'dockerdir',
            cacheDisabled: true,
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'nopqr',
            },
          },
        },
      },
    }),
    '/platform-arm64/cdk.out/dockerdir/Dockerfile': 'FROM scratch',
    '/build-contexts/cdk.out/assets.json': JSON.stringify({
      version: Manifest.version(),
      dockerImages: {
        theAsset: {
          source: {
            directory: 'dockerdir',
            dockerBuildContexts: {
              mycontext: '../context',
              alpine: 'docker-image://alpine:latest',
            },
          },
          destinations: {
            theDestination: {
              region: 'us-north-50',
              assumeRoleArn: 'arn:aws:role',
              repositoryName: 'repo',
              imageTag: 'nopqr',
            },
          },
        },
      },
    }),
    '/build-contexts/cdk.out/dockerdir/Dockerfile': 'FROM scratch',
  });
  aws = new MockAws();
  mockEcr.on(DescribeImagesCommand).rejects(err);

  // Set consistent mocks
  mockEcr.on(GetAuthorizationTokenCommand).resolves({
    authorizationData: [{ authorizationToken: 'dXNlcjpwYXNz', proxyEndpoint: 'https://proxy.com/' }],
  });
});

afterEach(() => {
  mockfs.restore();
});

test('logging in twice for two repository domains (containing account id & region)', async () => {
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/multi2/cdk.out')), {
    aws,
    throwOnError: true,
  });

  mockEcr.on(DescribeRepositoriesCommand).callsFake((input) => {
    const repos: Record<string, string> = {
      repo: '12345.amazonaws.com/repo',
      repo2: '12346.amazonaws.com/repo2',
    };
    const url = repos[input.repositoryNames[0]];
    if (!url) {
      throw new Error(`Unexpected repo: ${JSON.stringify(input)}`);
    }
    return {
      repositories: [{ repositoryUri: url }],
    };
  });

  const responses: GetAuthorizationTokenResponse[] = [
    {
      authorizationData: [{ authorizationToken: 'dXNlcjpwYXNz', proxyEndpoint: 'https://12345.proxy.com/' }],
    },
    {
      authorizationData: [{ authorizationToken: 'dXNlcjpwYXNz', proxyEndpoint: 'https://12346.proxy.com/' }],
    },
  ];

  let i = 0;
  // For some reason, `mockResolvedValueOnce()` doesn't work here, but this does.
  mockEcr.on(GetAuthorizationTokenCommand).callsFake(() => {
    return responses[i++];
  });

  const expectAllSpawns = mockSpawn(
    {
      commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', '12345.proxy.com'],
    },
    { commandLine: ['docker', 'inspect', 'cdkasset-theasset1'], exitCode: 1 },
    {
      commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset1', '.'],
      cwd: 'multi2/cdk.out/dockerdir',
    },
    {
      commandLine: ['docker', 'tag', 'cdkasset-theasset1', '12345.amazonaws.com/repo:theAsset1'],
    },
    { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:theAsset1'] },
    {
      commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', '12346.proxy.com'],
    },
    { commandLine: ['docker', 'inspect', 'cdkasset-theasset2'], exitCode: 1 },
    {
      commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset2', '.'],
      cwd: 'multi2/cdk.out/dockerdir',
    },
    {
      commandLine: ['docker', 'tag', 'cdkasset-theasset2', '12346.amazonaws.com/repo2:theAsset2'],
    },
    { commandLine: ['docker', 'push', '12346.amazonaws.com/repo2:theAsset2'] },
  );

  await pub.publish();

  expectAllSpawns();
  expect(true).toBeTruthy(); // Expect no exception, satisfy linter
});

test('pass destination properties to AWS client', async () => {
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), {
    aws,
    throwOnError: false,
  });

  const ecrClient = jest.spyOn(aws, 'ecrClient');

  await pub.publish();

  expect(ecrClient).toHaveBeenCalledWith({
    region: 'us-north-50',
    assumeRoleArn: 'arn:aws:role',
  });
});

describe('with a complete manifest', () => {
  let pub: AssetPublishing;
  beforeEach(() => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });
  });

  test('Do nothing if docker image already exists', async () => {
    mockEcr.on(DescribeImagesCommand).resolves({});

    await pub.publish();

    expect(mockEcr).toHaveReceivedCommandWith(DescribeImagesCommand, {
      imageIds: [{ imageTag: 'abcdef' }],
      repositoryName: 'repo',
    });
  });

  test('successful run does not need to query account ID', async () => {
    mockEcr.on(DescribeImagesCommand).resolves({});

    await pub.publish();

    const discoverCurrentAccount = jest.spyOn(aws, 'discoverCurrentAccount');
    expect(discoverCurrentAccount).not.toHaveBeenCalled();
  });

  test('upload docker image if not uploaded yet but exists locally', async () => {
    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'] },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:abcdef'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:abcdef'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });

  test('build and upload docker image if not exists anywhere', async () => {
    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'], exitCode: 1 },
      {
        commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset', '.'],
        cwd: absoluteDockerPath,
      },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:abcdef'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:abcdef'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });

  test('build with networkMode option', async () => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/default-network/cdk.out')), {
      aws,
    });
    const defaultNetworkDockerpath = '/default-network/cdk.out/dockerdir';

    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'], exitCode: 1 },
      {
        commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset', '--network', 'default', '.'],
        cwd: defaultNetworkDockerpath,
      },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:nopqr'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:nopqr'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });

  test('build with platform option', async () => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/platform-arm64/cdk.out')), {
      aws,
    });
    const defaultNetworkDockerpath = '/platform-arm64/cdk.out/dockerdir';

    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'], exitCode: 1 },
      {
        commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset', '--platform', 'linux/arm64', '.'],
        cwd: defaultNetworkDockerpath,
      },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:nopqr'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:nopqr'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });

  test('build with cache option', async () => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/cache/cdk.out')), { aws });
    const defaultNetworkDockerpath = '/cache/cdk.out/dockerdir';

    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'], exitCode: 1 },
      {
        commandLine: [
          'docker',
          'build',
          '--tag',
          'cdkasset-theasset',
          '--cache-from',
          'type=registry,ref=abcdef',
          '--cache-to',
          'type=inline',
          '.',
        ],
        cwd: defaultNetworkDockerpath,
      },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:nopqr'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:nopqr'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });

  test('build with cache disabled', async () => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/nocache/cdk.out')), { aws });
    const defaultNetworkDockerpath = '/nocache/cdk.out/dockerdir';

    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'], exitCode: 1 },
      {
        commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset', '--no-cache', '.'],
        cwd: defaultNetworkDockerpath,
      },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:nopqr'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:nopqr'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });

  test('build with multiple cache from option', async () => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/cache-from-multiple/cdk.out')), {
      aws,
    });
    const defaultNetworkDockerpath = '/cache-from-multiple/cdk.out/dockerdir';

    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'], exitCode: 1 },
      {
        commandLine: [
          'docker',
          'build',
          '--tag',
          'cdkasset-theasset',
          '--cache-from',
          'type=registry,ref=cache:ref',
          '--cache-from',
          'type=registry,ref=cache:main',
          '--cache-from',
          'type=gha',
          '.',
        ],
        cwd: defaultNetworkDockerpath,
      },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:nopqr'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:nopqr'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });

  test('build with cache to complex option', async () => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/cache-to-complex/cdk.out')), {
      aws,
    });
    const defaultNetworkDockerpath = '/cache-to-complex/cdk.out/dockerdir';

    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'], exitCode: 1 },
      {
        commandLine: [
          'docker',
          'build',
          '--tag',
          'cdkasset-theasset',
          '--cache-to',
          'type=registry,ref=cache:main,mode=max,compression=zstd',
          '.',
        ],
        cwd: defaultNetworkDockerpath,
      },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:nopqr'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:nopqr'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });

  test('build with buildContexts option', async () => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/build-contexts/cdk.out')), {
      aws,
    });
    const buildContextsDockerpath = '/build-contexts/cdk.out/dockerdir';

    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['docker', 'inspect', 'cdkasset-theasset'], exitCode: 1 },
      {
        commandLine: [
          'docker',
          'build',
          '--build-context',
          'mycontext=../context',
          '--build-context',
          'alpine=docker-image://alpine:latest',
          '--tag',
          'cdkasset-theasset',
          '.',
        ],
        cwd: buildContextsDockerpath,
      },
      { commandLine: ['docker', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:nopqr'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:nopqr'] },
    );

    await pub.publish();

    expectAllSpawns();
    expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  });
});

describe('external assets', () => {
  let pub: AssetPublishing;
  const externalTag = 'external:tag';
  beforeEach(() => {
    pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/external/cdk.out')), { aws });
  });

  test('upload externally generated Docker image', async () => {
    const expectAllSpawns = mockSpawn(
      {
        commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
      },
      { commandLine: ['sometool'], stdout: externalTag, cwd: '/external/cdk.out' },
      { commandLine: ['docker', 'tag', externalTag, '12345.amazonaws.com/repo:ghijkl'] },
      { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:ghijkl'] },
    );

    const ecrClient = jest.spyOn(aws, 'ecrClient');

    await pub.publish();

    expect(ecrClient).toHaveBeenCalledWith({
      region: 'us-north-50',
      assumeRoleArn: 'arn:aws:role',
    });

    expectAllSpawns();
  });
});

test('correctly identify Docker directory if path is absolute', async () => {
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/abs/cdk.out')), { aws });
  const expectAllSpawns = mockSpawn(
    // Only care about the 'build' command line
    { commandLine: ['docker', 'login'], prefix: true },
    { commandLine: ['docker', 'inspect'], exitCode: 1, prefix: true },
    {
      commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset', '.'],
      cwd: absoluteDockerPath,
    },
    { commandLine: ['docker', 'tag'], prefix: true },
    { commandLine: ['docker', 'push'], prefix: true },
  );

  await pub.publish();

  expect(true).toBeTruthy(); // Expect no exception, satisfy linter
  expectAllSpawns();
});

test('when external credentials are present, explicit Docker config directories are used', async () => {
  // Setup -- Mock that we have CDK credentials, and mock fs operations.
  jest.spyOn(dockercreds, 'cdkCredentialsConfig').mockReturnValue({ version: '0.1', domainCredentials: {} });
  jest.spyOn(fs, 'mkdtempSync').mockImplementationOnce(() => '/tmp/mockedTempDir');
  jest.spyOn(fs, 'writeFileSync').mockImplementation(jest.fn());

  let pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), { aws });

  const expectAllSpawns = mockSpawn(
    // Initally use the first created directory with the CDK credentials
    {
      commandLine: ['docker', '--config', '/tmp/mockedTempDir', 'inspect', 'cdkasset-theasset'],
      exitCode: 1,
    },
    {
      commandLine: ['docker', '--config', '/tmp/mockedTempDir', 'build', '--tag', 'cdkasset-theasset', '.'],
      cwd: absoluteDockerPath,
    },
    {
      commandLine: [
        'docker',
        '--config',
        '/tmp/mockedTempDir',
        'tag',
        'cdkasset-theasset',
        '12345.amazonaws.com/repo:abcdef',
      ],
    },
    // Prior to push, revert to the default config directory
    { commandLine: ['docker', 'login'], prefix: true },
    { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:abcdef'] },
  );

  await pub.publish();

  expectAllSpawns();
});

test('logging in only once for two assets', async () => {
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/multi/cdk.out')), {
    aws,
    throwOnError: false,
  });

  const expectAllSpawns = mockSpawn(
    {
      commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
    },
    { commandLine: ['docker', 'inspect', 'cdkasset-theasset1'], exitCode: 1 },
    {
      commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset1', '.'],
      cwd: '/multi/cdk.out/dockerdir',
    },
    { commandLine: ['docker', 'tag', 'cdkasset-theasset1', '12345.amazonaws.com/repo:theAsset1'] },
    { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:theAsset1'] },
    { commandLine: ['docker', 'inspect', 'cdkasset-theasset2'], exitCode: 1 },
    {
      commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset2', '.'],
      cwd: '/multi/cdk.out/dockerdir',
    },
    { commandLine: ['docker', 'tag', 'cdkasset-theasset2', '12345.amazonaws.com/repo:theAsset2'] },
    { commandLine: ['docker', 'push', '12345.amazonaws.com/repo:theAsset2'] },
  );

  await pub.publish();

  expectAllSpawns();
  expect(true).toBeTruthy(); // Expect no exception, satisfy linter
});

test('building only', async () => {
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/multi/cdk.out')), {
    aws,
    throwOnError: false,
    buildAssets: true,
    publishAssets: false,
  });

  const expectAllSpawns = mockSpawn(
    {
      commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
    },
    { commandLine: ['docker', 'inspect', 'cdkasset-theasset1'], exitCode: 1 },
    {
      commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset1', '.'],
      cwd: '/multi/cdk.out/dockerdir',
    },
    { commandLine: ['docker', 'tag', 'cdkasset-theasset1', '12345.amazonaws.com/repo:theAsset1'] },
    { commandLine: ['docker', 'inspect', 'cdkasset-theasset2'], exitCode: 1 },
    {
      commandLine: ['docker', 'build', '--tag', 'cdkasset-theasset2', '.'],
      cwd: '/multi/cdk.out/dockerdir',
    },
    { commandLine: ['docker', 'tag', 'cdkasset-theasset2', '12345.amazonaws.com/repo:theAsset2'] },
  );

  await pub.publish();

  expectAllSpawns();
  expect(true).toBeTruthy(); // Expect no exception, satisfy linter
});

test('publishing only', async () => {
  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/multi/cdk.out')), {
    aws,
    throwOnError: false,
    buildAssets: false,
    publishAssets: true,
  });

  const expectAllSpawns = mockSpawn(
    {
      commandLine: ['docker', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
    },
    { commandLine: ['docker', 'push', '12345.amazonaws.com/aws-cdk/assets:theAsset1'] },
    { commandLine: ['docker', 'push', '12345.amazonaws.com/aws-cdk/assets:theAsset2'] },
  );

  await pub.publish();

  expectAllSpawns();
  expect(true).toBeTruthy(); // Expect no exception, satisfy linter
});

test('overriding the docker command', async () => {
  process.env.CDK_DOCKER = 'custom';

  const pub = new AssetPublishing(AssetManifest.fromPath(mockfs.path('/simple/cdk.out')), {
    aws,
    throwOnError: false,
  });

  const expectAllSpawns = mockSpawn(
    {
      commandLine: ['custom', 'login', '--username', 'user', '--password-stdin', 'proxy.com'],
    },
    { commandLine: ['custom', 'inspect', 'cdkasset-theasset'] },
    { commandLine: ['custom', 'tag', 'cdkasset-theasset', '12345.amazonaws.com/repo:abcdef'] },
    { commandLine: ['custom', 'push', '12345.amazonaws.com/repo:abcdef'] },
  );

  await pub.publish();

  expectAllSpawns();
  expect(true).toBeTruthy(); // Expect no exception, satisfy linter
});
