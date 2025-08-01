import * as child_process from 'child_process';
import * as builtinFs from 'fs';
import { HotswapMode } from '@aws-cdk/cdk-cli-wrapper';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import { AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY } from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import { IntegTestRunner, IntegTest } from '../../lib/runner';
import { MockCdkProvider } from '../helpers';

let cdkMock: MockCdkProvider;
let spawnSyncMock: jest.SpyInstance;
let removeSyncMock: jest.SpyInstance;
beforeEach(() => {
  cdkMock = new MockCdkProvider({ directory: 'test/test-data' });
  cdkMock.mockList(jest.fn().mockImplementation(() => ['stackabc']));
  jest.spyOn(Manifest, 'saveIntegManifest').mockImplementation();

  spawnSyncMock = jest.spyOn(child_process, 'spawnSync').mockReturnValue({
    status: 0,
    stderr: Buffer.from('stderr'),
    stdout: Buffer.from('stdout'),
    pid: 123,
    output: ['stdout', 'stderr'],
    signal: null,
  });
  jest.spyOn(fs, 'moveSync').mockImplementation(() => {
    return true;
  });
  removeSyncMock = jest.spyOn(fs, 'removeSync').mockImplementation(() => {
    return true;
  });

  // fs-extra delegates to the built-in one, this also catches calls done directly
  jest.spyOn(builtinFs, 'writeFileSync').mockImplementation(() => {
    return true;
  });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

describe('IntegTest runIntegTests', () => {
  test('with defaults', async () => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot',
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(3);
    expect(cdkMock.mocks.destroy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(2);
    expect(cdkMock.mocks.deploy).toHaveBeenCalledWith({
      app: 'xxxxx.test-with-snapshot.js.snapshot',
      requireApproval: 'never',
      pathMetadata: false,
      assetMetadata: false,
      context: expect.not.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      profile: undefined,
      versionReporting: false,
      lookups: false,
      stacks: ['test-stack'],
    });
    expect(cdkMock.mocks.deploy).toHaveBeenCalledWith({
      app: 'node xxxxx.test-with-snapshot.js',
      requireApproval: 'never',
      pathMetadata: false,
      assetMetadata: false,
      output: 'cdk-integ.out.xxxxx.test-with-snapshot.js.snapshot',
      profile: undefined,
      context: expect.not.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      versionReporting: false,
      lookups: false,
      stacks: ['test-stack', 'new-test-stack'],
    });
    expect(cdkMock.mocks.destroy).toHaveBeenCalledWith({
      app: 'node xxxxx.test-with-snapshot.js',
      pathMetadata: false,
      assetMetadata: false,
      context: expect.not.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      versionReporting: false,
      profile: undefined,
      force: true,
      all: true,
      output: 'cdk-integ.out.xxxxx.test-with-snapshot.js.snapshot',
    });
  });

  test('no snapshot', async () => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.integ-test1.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.integ-test1',
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.destroy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(2);
    expect(cdkMock.mocks.deploy).toHaveBeenCalledWith({
      app: 'node xxxxx.integ-test1.js',
      requireApproval: 'never',
      pathMetadata: false,
      assetMetadata: false,
      versionReporting: false,
      profile: undefined,
      context: expect.not.objectContaining({
        [AVAILABILITY_ZONE_FALLBACK_CONTEXT_KEY]: ['test-region-1a', 'test-region-1b', 'test-region-1c'],
      }),
      lookups: false,
      stacks: ['stack1'],
      output: 'cdk-integ.out.xxxxx.integ-test1.js.snapshot',
    });
    expect(cdkMock.mocks.destroy).toHaveBeenCalledWith({
      app: 'node xxxxx.integ-test1.js',
      pathMetadata: false,
      assetMetadata: false,
      versionReporting: false,
      context: expect.any(Object),
      force: true,
      all: true,
      output: 'cdk-integ.out.xxxxx.integ-test1.js.snapshot',
    });
  });

  test('with lookups', async () => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot-assets-diff.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot-assets-diff',
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.destroy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(2);
    expect(cdkMock.mocks.deploy).toHaveBeenCalledWith({
      app: 'node xxxxx.test-with-snapshot-assets-diff.js',
      requireApproval: 'never',
      pathMetadata: false,
      assetMetadata: false,
      context: expect.not.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      versionReporting: false,
      lookups: true,
      stacks: ['test-stack'],
      output: 'cdk-integ.out.xxxxx.test-with-snapshot-assets-diff.js.snapshot',
      profile: undefined,
    });
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledWith({
      execCmd: ['node', 'xxxxx.test-with-snapshot-assets-diff.js'],
      env: expect.objectContaining({
        CDK_INTEG_ACCOUNT: '12345678',
        CDK_INTEG_REGION: 'test-region',
      }),
      context: expect.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      output: 'xxxxx.test-with-snapshot-assets-diff.js.snapshot',
    });
    expect(cdkMock.mocks.destroy).toHaveBeenCalledWith({
      app: 'node xxxxx.test-with-snapshot-assets-diff.js',
      pathMetadata: false,
      assetMetadata: false,
      context: expect.not.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      versionReporting: false,
      force: true,
      all: true,
      output: 'cdk-integ.out.xxxxx.test-with-snapshot-assets-diff.js.snapshot',
    });
  });

  test('with an assertion stack', async () => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot',
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(3);
    expect(cdkMock.mocks.destroy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(2);
    expect(cdkMock.mocks.deploy).toHaveBeenNthCalledWith(1, expect.objectContaining({
      app: 'xxxxx.test-with-snapshot.js.snapshot',
      context: expect.any(Object),
      stacks: ['test-stack'],
    }));
    expect(cdkMock.mocks.deploy).toHaveBeenNthCalledWith(2, expect.not.objectContaining({
      rollback: false,
    }));
    expect(cdkMock.mocks.deploy).toHaveBeenNthCalledWith(3, expect.objectContaining({
      app: 'node xxxxx.test-with-snapshot.js',
      stacks: ['Bundling/DefaultTest/DeployAssert'],
      rollback: false,
    }));
    expect(cdkMock.mocks.destroy).toHaveBeenCalledWith({
      app: 'node xxxxx.test-with-snapshot.js',
      pathMetadata: false,
      assetMetadata: false,
      context: expect.not.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      versionReporting: false,
      force: true,
      all: true,
      output: 'cdk-integ.out.xxxxx.test-with-snapshot.js.snapshot',
    });
  });

  test('no clean', async () => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.integ-test1.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.integ-test1',
      clean: false,
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.destroy).toHaveBeenCalledTimes(0);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(2);
  });

  test('dryrun', async () => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.integ-test1.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.integ-test1',
      dryRun: true,
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(0);
    expect(cdkMock.mocks.destroy).toHaveBeenCalledTimes(0);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(2);
  });

  test('generate snapshot', async () => {
    // WHEN
    const runner = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.integ-test1.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await runner.actualTests();

    // THEN
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledWith({
      execCmd: ['node', 'xxxxx.integ-test1.js'],
      output: 'cdk-integ.out.xxxxx.integ-test1.js.snapshot',
      env: expect.objectContaining({
        CDK_INTEG_ACCOUNT: '12345678',
        CDK_INTEG_REGION: 'test-region',
      }),
      context: expect.any(Object),
    });
  });

  test('with profile', async () => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.integ-test1.js',
        discoveryRoot: 'test/test-data',
      }),
      profile: 'test-profile',
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.integ-test1',
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.destroy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(2);
    expect(cdkMock.mocks.deploy).toHaveBeenCalledWith({
      app: 'node xxxxx.integ-test1.js',
      requireApproval: 'never',
      pathMetadata: false,
      assetMetadata: false,
      versionReporting: false,
      context: expect.not.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      profile: 'test-profile',
      lookups: false,
      stacks: ['stack1'],
      output: 'cdk-integ.out.xxxxx.integ-test1.js.snapshot',
    });
    expect(cdkMock.mocks.destroy).toHaveBeenCalledWith({
      app: 'node xxxxx.integ-test1.js',
      pathMetadata: false,
      assetMetadata: false,
      versionReporting: false,
      context: expect.not.objectContaining({
        'vpc-provider:account=12345678:filter.isDefault=true:region=test-region:returnAsymmetricSubnets=true': expect.objectContaining({
          vpcId: 'vpc-60900905',
        }),
      }),
      profile: 'test-profile',
      force: true,
      all: true,
      output: 'cdk-integ.out.xxxxx.integ-test1.js.snapshot',
    });
  });

  test('with hooks', async () => {
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot-assets.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot-assets',
    });

    // THEN
    expect(spawnSyncMock.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        'echo', ['"preDeploy hook"'],
      ]),
      expect.arrayContaining([
        'echo', ['"postDeploy hook"'],
      ]),
      expect.arrayContaining([
        'echo', ['"preDestroy hook"'],
      ]),
      expect.arrayContaining([
        'echo', ['"postDestroy hook"'],
      ]),
      expect.arrayContaining([
        'ls', [],
      ]),
      expect.arrayContaining([
        'echo', ['-n', '"No new line"'],
      ]),
    ]));
  });

  test('git is used to checkout latest snapshot', async () => {
    // GIVEN
    spawnSyncMock = jest.spyOn(child_process, 'spawnSync').mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from('HEAD branch: main'),
      stdout: Buffer.from('HEAD branch: main'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    }).mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from('abc'),
      stdout: Buffer.from('abc'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    });

    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot',
    });

    // THEN
    expect(spawnSyncMock.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        'git', ['-C', expect.any(String), 'remote', 'show', 'origin'],
      ]),
      expect.arrayContaining([
        'git', ['-C', expect.any(String), 'merge-base', 'HEAD', 'main'],
      ]),
      expect.arrayContaining([
        'git', ['-C', expect.any(String), 'checkout', 'abc', '--', 'xxxxx.test-with-snapshot.js.snapshot'],
      ]),
    ]));
  });

  test('git is used and cannot determine origin', async () => {
    // GIVEN
    spawnSyncMock = jest.spyOn(child_process, 'spawnSync').mockReturnValueOnce({
      status: 1,
      stderr: Buffer.from('HEAD branch: main'),
      stdout: Buffer.from('HEAD branch: main'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    });
    const stderrMock = jest.spyOn(process.stderr, 'write').mockImplementation(() => {
      return true;
    });

    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot',
    });

    // THEN
    expect(stderrMock.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        expect.stringMatching(/Could not determine git origin branch/),
      ]),
    ]));
  });

  test('git is used and cannot checkout snapshot', async () => {
    // GIVEN
    spawnSyncMock = jest.spyOn(child_process, 'spawnSync').mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from('HEAD branch: main'),
      stdout: Buffer.from('HEAD branch: main'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    }).mockReturnValueOnce({
      status: 1,
      stderr: Buffer.from('HEAD branch: main'),
      stdout: Buffer.from('HEAD branch: main'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    });
    const stderrMock = jest.spyOn(process.stderr, 'write').mockImplementation(() => {
      return true;
    });

    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot',
    });

    // THEN
    expect(stderrMock.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        expect.stringMatching(/Could not checkout snapshot directory/),
      ]),
    ]));
  });

  test('with assets manifest, assets are removed if stackUpdateWorkflow is disabled', async () => {
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot-assets.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot-assets',
    });

    expect(removeSyncMock.mock.calls).toEqual([
      ['test/test-data/cdk-integ.out.xxxxx.test-with-snapshot-assets.js.snapshot'],
      ['test/test-data/xxxxx.test-with-snapshot-assets.js.snapshot'],
      [
        'test/test-data/xxxxx.test-with-snapshot-assets.js.snapshot/asset.be270bbdebe0851c887569796e3997437cca54ce86893ed94788500448e92824',
      ],
      ['test/test-data/cdk-integ.out.xxxxx.test-with-snapshot-assets.js.snapshot'],
    ]);
  });

  test('with assembly manifest, assets are removed if stackUpdateWorkflow is disabled', async () => {
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot-assets-diff.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot-assets-diff',
    });

    expect(removeSyncMock.mock.calls).toEqual([
      ['test/test-data/xxxxx.test-with-snapshot-assets-diff.js.snapshot'],
      [
        'test/test-data/xxxxx.test-with-snapshot-assets-diff.js.snapshot/asset.fec1c56a3f23d9d27f58815e0c34c810cc02f431ac63a078f9b5d2aa44cc3509',
      ],
    ]);
  });

  test.each`
    verbosity | verbose      | debug
    ${0}      | ${undefined} | ${undefined}
    ${1}      | ${undefined} | ${undefined}
    ${2}      | ${undefined} | ${undefined}
    ${3}      | ${true}      | ${undefined}
    ${4}      | ${true}      | ${true}
`('with verbosity set to $verbosity', async ({ verbosity, verbose, debug }) => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot',
      verbosity: verbosity,
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({
      verbose,
      debug,
    }));
    expect(cdkMock.mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({
      verbose,
      debug,
    }));
    expect(cdkMock.mocks.destroy).toHaveBeenCalledWith(expect.objectContaining({
      verbose,
      debug,
    }));
  });

  test('with custom app run command', async () => {
    // WHEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
        appCommand: 'node --no-warnings {filePath}',
      }),
    });
    await integTest.runIntegTestCase({
      testCaseName: 'xxxxx.test-with-snapshot',
    });

    // THEN
    expect(cdkMock.mocks.deploy).toHaveBeenCalledTimes(3);
    expect(cdkMock.mocks.destroy).toHaveBeenCalledTimes(1);
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledTimes(2);
    expect(cdkMock.mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({
      app: 'node --no-warnings xxxxx.test-with-snapshot.js',
    }));
    expect(cdkMock.mocks.synthFast).toHaveBeenCalledWith(expect.objectContaining({
      execCmd: ['node', '--no-warnings', 'xxxxx.test-with-snapshot.js'],
    }));
    expect(cdkMock.mocks.destroy).toHaveBeenCalledWith(expect.objectContaining({
      app: 'node --no-warnings xxxxx.test-with-snapshot.js',
    }));
  });
});

describe('IntegTest watchIntegTest', () => {
  test('default watch', async () => {
    // GIVEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
        appCommand: 'node --no-warnings {filePath}',
      }),
    });

    // WHEN
    await integTest.watchIntegTest({
      testCaseName: 'xxxxx.test-with-snapshot',
    });

    // THEN
    expect(cdkMock.mocks.watch).toHaveBeenCalledWith(expect.objectContaining({
      app: 'node --no-warnings xxxxx.test-with-snapshot.js',
      hotswap: HotswapMode.FALL_BACK,
      watch: true,
      traceLogs: false,
      deploymentMethod: 'direct',
      verbose: undefined,
    }), expect.anything());
  });

  test('verbose watch', async () => {
    // GIVEN
    const integTest = new IntegTestRunner({
      cdk: cdkMock.cdk,
      test: new IntegTest({
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
        appCommand: 'node --no-warnings {filePath}',
      }),
    });

    // WHEN
    await integTest.watchIntegTest({
      testCaseName: 'xxxxx.test-with-snapshot',
      verbosity: 2,
    });

    // THEN
    expect(cdkMock.mocks.watch).toHaveBeenCalledWith(expect.objectContaining({
      app: 'node --no-warnings xxxxx.test-with-snapshot.js',
      hotswap: HotswapMode.FALL_BACK,
      watch: true,
      traceLogs: true,
      deploymentMethod: 'direct',
      verbose: undefined,
    }), expect.anything());
  });

  test('with error', async () => {
    await expect(async () => {
      // GIVEN
      const runner = new IntegTestRunner({
        cdk: cdkMock.cdk,
        test: new IntegTest({
          fileName: 'test/test-data/xxxxx.test-with-error.js',
          discoveryRoot: 'test/test-data',
        }),
      });
      // WHEN
      await runner.actualTests();

    // THEN
    }).rejects.toThrow('xxxxx.test-with-error is a new test. Please use the IntegTest construct to configure the test\nhttps://github.com/aws/aws-cdk/tree/main/packages/%40aws-cdk/integ-tests-alpha');
  });
});
