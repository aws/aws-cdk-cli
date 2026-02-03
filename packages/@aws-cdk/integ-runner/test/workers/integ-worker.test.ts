import * as builtinFs from 'fs';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as workerpool from 'workerpool';
import { runIntegrationTestsInParallel, runIntegrationTests } from '../../lib/workers/integ-test-worker';
let stderrMock: jest.SpyInstance;
let pool: workerpool.WorkerPool;

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

// Note: The 'test runner' describe block that tested cli-wrapper specific behavior
// (spawning processes directly via child_process.spawnSync) has been removed.
// The toolkit-lib engine uses the programmatic Toolkit library instead of spawning processes.
// Integration test worker behavior is now tested through the parallel worker tests below
// and through the IntegTestRunner tests in other test files.

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
