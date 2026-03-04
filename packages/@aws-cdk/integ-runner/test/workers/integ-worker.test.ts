import * as builtinFs from 'fs';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as workerpool from 'workerpool';
import { IntegTestRunner } from '../../lib/runner';
import { integTestWorker } from '../../lib/workers/extract';
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

// Mock workerpool.workerEmit since we're not running in a worker context
jest.mock('workerpool', () => {
  const actual = jest.requireActual('workerpool');
  return {
    ...actual,
    workerEmit: jest.fn(),
  };
});

describe('integTestWorker', () => {
  let mockActualTests: jest.Mock;
  let mockRunIntegTestCase: jest.Mock;

  beforeEach(() => {
    mockActualTests = jest.fn();
    mockRunIntegTestCase = jest.fn();

    jest.spyOn(IntegTestRunner.prototype, 'actualTests').mockImplementation(mockActualTests);
    jest.spyOn(IntegTestRunner.prototype, 'runIntegTestCase').mockImplementation(mockRunIntegTestCase);
  });

  test('successful test run emits success diagnostic', async () => {
    mockActualTests.mockResolvedValue({
      'test-case-1': { stacks: ['Stack1'] },
    });
    mockRunIntegTestCase.mockResolvedValue({
      AssertionResults1: { status: 'success', message: 'Assertion passed' },
    });

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
    });

    expect(results).toEqual([]);
    expect(workerpool.workerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'TEST_SUCCESS',
        testName: expect.stringContaining('test-case-1'),
      }),
    );
  });

  test('failed assertion emits failure diagnostic and returns test as failed', async () => {
    mockActualTests.mockResolvedValue({
      'test-case-1': { stacks: ['Stack1'] },
    });
    mockRunIntegTestCase.mockResolvedValue({
      AssertionResults1: { status: 'fail', message: 'Assertion failed: expected X got Y' },
    });

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
    });

    expect(results).toEqual([{
      fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    }]);
    expect(workerpool.workerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'ASSERTION_FAILED',
      }),
    );
  });

  test('test case execution error emits failure diagnostic', async () => {
    mockActualTests.mockResolvedValue({
      'test-case-1': { stacks: ['Stack1'] },
    });
    mockRunIntegTestCase.mockRejectedValue(new Error('Deployment failed'));

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
    });

    expect(results).toEqual([{
      fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    }]);
    expect(workerpool.workerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'TEST_FAILED',
        message: expect.stringContaining('Deployment failed'),
      }),
    );
  });

  test('no tests defined emits error diagnostic', async () => {
    mockActualTests.mockResolvedValue({});

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
    });

    expect(results).toEqual([{
      fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    }]);
    expect(workerpool.workerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'TEST_ERROR',
        message: expect.stringContaining('No tests defined'),
      }),
    );
  });

  test('runs multiple test cases within a single test file', async () => {
    mockActualTests.mockResolvedValue({
      'test-case-1': { stacks: ['Stack1'] },
      'test-case-2': { stacks: ['Stack2'] },
    });
    mockRunIntegTestCase.mockResolvedValue(undefined);

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
    });

    expect(results).toEqual([]);
    expect(mockRunIntegTestCase).toHaveBeenCalledTimes(2);
    expect(mockRunIntegTestCase).toHaveBeenCalledWith(
      expect.objectContaining({ testCaseName: 'test-case-1' }),
    );
    expect(mockRunIntegTestCase).toHaveBeenCalledWith(
      expect.objectContaining({ testCaseName: 'test-case-2' }),
    );
  });

  test('processes multiple test files in batch', async () => {
    mockActualTests.mockResolvedValue({
      'test-case-1': { stacks: ['Stack1'] },
    });
    mockRunIntegTestCase.mockResolvedValue(undefined);

    const results = await integTestWorker({
      tests: [
        {
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
        {
          fileName: 'test/test-data/xxxxx.another-test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        },
      ],
      region: 'us-east-1',
    });

    expect(results).toEqual([]);
    expect(mockActualTests).toHaveBeenCalledTimes(2);
  });

  test('passes profile and region to IntegTestRunner', async () => {
    mockActualTests.mockResolvedValue({
      'test-case-1': { stacks: ['Stack1'] },
    });
    mockRunIntegTestCase.mockResolvedValue(undefined);

    await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-west-2',
      profile: 'test-profile',
    });

    // Verify runIntegTestCase was called (runner was created and used)
    expect(mockRunIntegTestCase).toHaveBeenCalled();
  });

  test('legacy test without snapshot throws and returns test as failed', async () => {
    // When actualTests throws (e.g., legacy test without snapshot),
    // the worker should catch the error and return the test as failed
    mockActualTests.mockRejectedValue(
      new Error('xxxxx.integ-test2 is a new test. Please use the IntegTest construct to configure the test'),
    );

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.integ-test2.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
    });

    expect(results).toEqual([{
      fileName: 'test/test-data/xxxxx.integ-test2.js',
      discoveryRoot: 'test/test-data',
    }]);
    expect(workerpool.workerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'TEST_ERROR',
        message: expect.stringContaining('Please use the IntegTest construct'),
      }),
    );
  });

  test('deployment failure returns test as failed', async () => {
    mockActualTests.mockResolvedValue({
      'test-case-1': { stacks: ['Stack1'] },
    });
    mockRunIntegTestCase.mockRejectedValue(
      new Error('Stack deployment failed: CREATE_FAILED'),
    );

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
    });

    expect(results).toEqual([{
      fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
      discoveryRoot: 'test/test-data',
    }]);
    expect(workerpool.workerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'TEST_FAILED',
        message: expect.stringContaining('Stack deployment failed'),
      }),
    );
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
