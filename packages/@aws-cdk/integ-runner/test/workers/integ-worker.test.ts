import * as child_process from 'child_process';
import * as builtinFs from 'fs';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as workerpool from 'workerpool';
import { integTestWorker } from '../../lib/workers/extract';
import { runIntegrationTestsInParallel, runIntegrationTests } from '../../lib/workers/integ-test-worker';
let stderrMock: jest.SpyInstance;
let pool: workerpool.WorkerPool;
let spawnSyncMock: jest.SpyInstance;

jest.setTimeout(20_000);

beforeAll(() => {
  pool = workerpool.pool(path.join(__dirname, 'mock-extract_worker.ts'), {
    workerType: 'thread',
    workerThreadOpts: {
      execArgv: ['--require', 'ts-node/register'],
    },
  });
});
beforeEach(() => {
  jest.spyOn(fs, 'moveSync').mockImplementation(() => {
    return true;
  });
  jest.spyOn(fs, 'emptyDirSync').mockImplementation(() => {
    return true;
  });
  jest.spyOn(fs, 'removeSync').mockImplementation(() => {
    return true;
  });

  // fs-extra delegates to the built-in one, this also catches calls done directly
  jest.spyOn(builtinFs, 'rmdirSync').mockImplementation(() => {
    return true;
  });
  jest.spyOn(builtinFs, 'writeFileSync').mockImplementation(() => {
    return true;
  });
  jest.spyOn(builtinFs, 'unlinkSync').mockImplementation(() => {
    return true;
  });

  spawnSyncMock = jest.spyOn(child_process, 'spawnSync')
    .mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from('stderr'),
      stdout: Buffer.from('sdout'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    })
    .mockReturnValueOnce({
      status: 0,
      stderr: Buffer.from('HEAD branch: master\nother'),
      stdout: Buffer.from('HEAD branch: master\nother'),
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
    }).mockReturnValue({
      status: 0,
      stderr: Buffer.from('stack1'),
      stdout: Buffer.from('stack1'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    });
  stderrMock = jest.spyOn(process.stderr, 'write').mockImplementation(() => {
    return true;
  });
  jest.spyOn(process.stdout, 'write').mockImplementation(() => {
    return true;
  });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  jest.restoreAllMocks();
});
afterAll(async () => {
  await pool.terminate();
});

describe('test runner', () => {
  test('no snapshot', async () => {
    // WHEN
    const test = {
      fileName: 'test/test-data/xxxxx.integ-test1.js',
      discoveryRoot: 'test/test-data',
    };
    await integTestWorker({
      tests: [test],
      region: 'us-east-1',
    });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      expect.stringMatching(/node/),
      ['test/test-data/xxxxx.integ-test1.js'],
      expect.objectContaining({
        env: expect.objectContaining({
          CDK_INTEG_ACCOUNT: '12345678',
          CDK_INTEG_REGION: 'test-region',
        }),
      }),
    );
  });

  test('legacy test throws', async () => {
    // WHEN
    const test = {
      fileName: 'test/test-data/xxxxx.integ-test2.js',
      discoveryRoot: 'test/test-data',
    };
    spawnSyncMock.mockReset();
    jest.spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 0,
      stderr: Buffer.from('test-stack'),
      stdout: Buffer.from('test-stack'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    });

    // GIVEN
    const results = await integTestWorker({
      tests: [test],
      region: 'us-east-1',
    });

    // THEN
    expect(results).toEqual([{
      discoveryRoot: 'test/test-data',
      fileName: 'test/test-data/xxxxx.integ-test2.js',
    }]);
  });

  test('has snapshot', async () => {
    // GIVEN
    // Mock the assertion results file to exist and contain success results
    // The test uses xxxxx.test-with-snapshot.js which has an assertion stack
    // We need to mock existsSync to return true for the assertion results file
    // but still allow the real existsSync to be called for other paths
    const existsSyncMock = jest.spyOn(fs, 'existsSync').mockImplementation((filePath: fs.PathLike) => {
      const pathStr = filePath.toString();
      // Return true for assertion results file and snapshot directories
      if (pathStr.includes('assertion-results.json') || pathStr.includes('.snapshot')) {
        return true;
      }
      // For other paths, return true to allow the test to proceed
      return true;
    });
    const readJSONSyncMock = jest.spyOn(fs, 'readJSONSync').mockImplementation((filePath: string) => {
      if (filePath.includes('assertion-results.json')) {
        return {
          BundlingDefaultTestDeployAssertAACA0CAF: {
            AssertionResultsTest: '{"status":"success","message":"All assertions passed"}',
          },
        };
      }
      // For other JSON files, use the real implementation
      const realFs = jest.requireActual('fs-extra') as typeof fs;
      return realFs.readJSONSync(filePath);
    });
    const unlinkSyncMock = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
    });

    // WHEN
    const test = {
      fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    };
    const results = await integTestWorker({
      tests: [test],
      region: 'us-east-3',
    });

    expect(spawnSyncMock.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        expect.stringMatching(/git/),
        ['-C', 'test/test-data', 'remote', 'show', 'origin'],
      ]),
      expect.arrayContaining([
        expect.stringMatching(/git/),
        ['-C', 'test/test-data', 'merge-base', 'HEAD', 'master'],
      ]),
      expect.arrayContaining([
        expect.stringMatching(/git/),
        ['-C', 'test/test-data', 'checkout', 'abc', '--', 'xxxxx.test-with-snapshot.js.snapshot'],
      ]),
    ]));

    expect(results).toEqual([]);

    // Restore mocks
    existsSyncMock.mockRestore();
    readJSONSyncMock.mockRestore();
    unlinkSyncMock.mockRestore();
  });

  test('deploy failed', async () => {
    // WHEN
    const test = {
      fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    };
    jest.spyOn(child_process, 'spawnSync').mockReturnValue({
      status: 1,
      stderr: Buffer.from('stack1'),
      stdout: Buffer.from('stack1'),
      pid: 123,
      output: ['stdout', 'stderr'],
      signal: null,
    });
    const results = await integTestWorker({
      tests: [test],
      region: 'us-east-1',
    });

    expect(results[0]).toEqual({
      fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    });
  });
});

describe('parallel worker', () => {
  test('run all integration tests', async () => {
    const tests = [
      {
        fileName: 'xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
      {
        fileName: 'xxxxx.another-test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
    ];
    await runIntegrationTests({
      tests,
      pool,
      regions: ['us-east-1', 'us-east-2'],
    });

    expect(stderrMock.mock.calls[0][0]).toContain(
      'Running integration tests for failed tests...',
    );
    expect(stderrMock.mock.calls[1][0]).toContain(
      'Running in parallel across regions: us-east-1, us-east-2',
    );
    expect(stderrMock.mock.calls[2][0]).toContain(
      'Running test xxxxx.another-test-with-snapshot.js in us-east-1',
    );
    expect(stderrMock.mock.calls[3][0]).toContain(
      'Running test xxxxx.test-with-snapshot.js in us-east-2',
    );
  });

  test('run tests', async () => {
    const tests = [{
      fileName: 'xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    }];
    const results = await runIntegrationTestsInParallel({
      pool,
      tests,
      regions: ['us-east-1'],
    });

    expect(stderrMock.mock.calls[0][0]).toContain(
      'Running test xxxxx.test-with-snapshot.js in us-east-1',
    );
    expect(results).toEqual({
      failedTests: expect.arrayContaining([
        {
          fileName: 'xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
      ]),
      metrics: expect.arrayContaining([
        {
          duration: expect.anything(),
          region: 'us-east-1',
          tests: {
            'xxxxx.test-with-snapshot.js': expect.anything(),
          },
        },
      ]),
    });
  });

  test('run multiple tests with profiles', async () => {
    const tests = [
      {
        fileName: 'xxxxx.another-test-with-snapshot3.js',
        discoveryRoot: 'test/test-data',
      },
      {
        fileName: 'xxxxx.another-test-with-snapshot2.js',
        discoveryRoot: 'test/test-data',
      },
      {
        fileName: 'xxxxx.another-test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
      {
        fileName: 'xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
    ];
    const results = await runIntegrationTestsInParallel({
      tests,
      pool,
      profiles: ['profile1', 'profile2'],
      regions: ['us-east-1', 'us-east-2'],
    });

    expect(stderrMock.mock.calls[3][0]).toContain(
      'Running test xxxxx.another-test-with-snapshot3.js in profile2/us-east-2',
    );
    expect(stderrMock.mock.calls[2][0]).toContain(
      'Running test xxxxx.another-test-with-snapshot2.js in profile2/us-east-1',
    );
    expect(stderrMock.mock.calls[1][0]).toContain(
      'Running test xxxxx.another-test-with-snapshot.js in profile1/us-east-2',
    );
    expect(stderrMock.mock.calls[0][0]).toContain(
      'Running test xxxxx.test-with-snapshot.js in profile1/us-east-1',
    );
    expect(results).toEqual({
      failedTests: expect.arrayContaining([
        {
          fileName: 'xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
        {
          fileName: 'xxxxx.another-test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
        {
          fileName: 'xxxxx.another-test-with-snapshot2.js',
          discoveryRoot: 'test/test-data',
        },
        {
          fileName: 'xxxxx.another-test-with-snapshot3.js',
          discoveryRoot: 'test/test-data',
        },
      ]),
      metrics: expect.arrayContaining([
        {
          duration: expect.any(Number),
          region: 'us-east-1',
          profile: 'profile1',
          tests: {
            'xxxxx.test-with-snapshot.js': expect.any(Number),
          },
        },
        {
          duration: expect.any(Number),
          region: 'us-east-2',
          profile: 'profile1',
          tests: {
            'xxxxx.another-test-with-snapshot.js': expect.any(Number),
          },
        },
        {
          duration: expect.any(Number),
          region: 'us-east-1',
          profile: 'profile2',
          tests: {
            'xxxxx.another-test-with-snapshot2.js': expect.any(Number),
          },
        },
        {
          duration: expect.any(Number),
          region: 'us-east-2',
          profile: 'profile2',
          tests: {
            'xxxxx.another-test-with-snapshot3.js': expect.any(Number),
          },
        },
      ]),
    });
  });

  test('run multiple tests', async () => {
    const tests = [
      {
        fileName: 'xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
      {
        fileName: 'xxxxx.another-test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
    ];
    const results = await runIntegrationTestsInParallel({
      tests,
      pool,
      regions: ['us-east-1', 'us-east-2'],
    });

    expect(stderrMock.mock.calls[1][0]).toContain(
      'Running test xxxxx.test-with-snapshot.js in us-east-2',
    );
    expect(stderrMock.mock.calls[0][0]).toContain(
      'Running test xxxxx.another-test-with-snapshot.js in us-east-1',
    );
    expect(results).toEqual({
      failedTests: expect.arrayContaining([
        {
          fileName: 'xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
        {
          fileName: 'xxxxx.another-test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
      ]),
      metrics: expect.arrayContaining([
        {
          duration: expect.anything(),
          region: 'us-east-2',
          tests: {
            'xxxxx.test-with-snapshot.js': expect.anything(),
          },
        },
        {
          duration: expect.anything(),
          region: 'us-east-1',
          tests: {
            'xxxxx.another-test-with-snapshot.js': expect.anything(),
          },
        },
      ]),
    });
  });

  test('more tests than regions', async () => {
    const tests = [
      {
        fileName: 'xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
      {
        fileName: 'xxxxx.another-test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
    ];
    const results = await runIntegrationTestsInParallel({
      tests,
      pool,
      regions: ['us-east-1'],
    });

    expect(stderrMock.mock.calls[1][0]).toContain(
      'Running test xxxxx.test-with-snapshot.js in us-east-1',
    );
    expect(stderrMock.mock.calls[0][0]).toContain(
      'Running test xxxxx.another-test-with-snapshot.js in us-east-1',
    );
    expect(results).toEqual({
      failedTests: expect.arrayContaining([
        {
          fileName: 'xxxxx.another-test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
        {
          fileName: 'xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
      ]),
      metrics: expect.arrayContaining([
        {
          duration: expect.anything(),
          region: 'us-east-1',
          tests: {
            'xxxxx.test-with-snapshot.js': expect.anything(),
            'xxxxx.another-test-with-snapshot.js': expect.anything(),
          },
        },
      ]),
    });
  });

  test('more regions than tests', async () => {
    const tests = [
      {
        fileName: 'xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
      {
        fileName: 'xxxxx.another-test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      },
    ];
    const results = await runIntegrationTestsInParallel({
      tests,
      pool,
      regions: ['us-east-1', 'us-east-2', 'us-west-2'],
    });

    expect(stderrMock.mock.calls[1][0]).toContain(
      'Running test xxxxx.test-with-snapshot.js in us-east-2',
    );
    expect(stderrMock.mock.calls[0][0]).toContain(
      'Running test xxxxx.another-test-with-snapshot.js in us-east-1',
    );
    expect(results).toEqual({
      failedTests: expect.arrayContaining([
        {
          fileName: 'xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
        {
          fileName: 'xxxxx.another-test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
      ]),
      metrics: expect.arrayContaining([
        {
          duration: expect.anything(),
          region: 'us-east-2',
          tests: {
            'xxxxx.test-with-snapshot.js': expect.anything(),
          },
        },
        {
          duration: expect.anything(),
          region: 'us-east-1',
          tests: {
            'xxxxx.another-test-with-snapshot.js': expect.anything(),
          },
        },
      ]),
    });
  });
});
