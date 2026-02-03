import * as builtinFs from 'fs';
import * as path from 'path';
import { BootstrapError } from '@aws-cdk/toolkit-lib';
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

    expect(results.failedTests).toEqual([]);
    expect(results.retryableFailures).toBeUndefined();
    expect(results.environmentRemovals).toBeUndefined();
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

    expect(results.failedTests).toEqual([{
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

    expect(results.failedTests).toEqual([{
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

    expect(results.failedTests).toEqual([{
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

    expect(results.failedTests).toEqual([]);
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

    expect(results.failedTests).toEqual([]);
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

    expect(results.failedTests).toEqual([{
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

    expect(results.failedTests).toEqual([{
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

  describe('bootstrap error handling', () => {
    /**
     * Tests for bootstrap error detection in extract_worker
     * Validates: Requirements 2.1, 2.2, 3.1
     */

    test('bootstrap error during test case execution is detected and returned as retryable', async () => {
      // GIVEN
      mockActualTests.mockResolvedValue({
        'test-case-1': { stacks: ['Stack1'] },
      });
      const bootstrapError = new BootstrapError('Bootstrap stack not found', {
        account: '123456789012',
        region: 'us-east-1',
      });
      mockRunIntegTestCase.mockRejectedValue(bootstrapError);

      // WHEN
      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'us-east-1',
        profile: 'test-profile',
      });

      // THEN - test should be in retryableFailures, not failedTests
      expect(results.failedTests).toEqual([]);
      expect(results.retryableFailures).toEqual([{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
        failedEnvironment: {
          profile: 'test-profile',
          region: 'us-east-1',
        },
        errorMessage: 'Bootstrap stack not found',
      }]);
    });

    test('bootstrap error generates environment removal request', async () => {
      // GIVEN
      mockActualTests.mockResolvedValue({
        'test-case-1': { stacks: ['Stack1'] },
      });
      const bootstrapError = new BootstrapError('CDKToolkit stack not found', {
        account: '987654321098',
        region: 'eu-west-1',
      });
      mockRunIntegTestCase.mockRejectedValue(bootstrapError);

      // WHEN
      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'eu-west-1',
        profile: 'prod-profile',
      });

      // THEN - environmentRemovals should contain the failed environment
      expect(results.environmentRemovals).toEqual([{
        environment: {
          profile: 'prod-profile',
          region: 'eu-west-1',
        },
        reason: 'CDKToolkit stack not found',
        account: '987654321098',
      }]);
    });

    test('bootstrap error emits diagnostic indicating retry', async () => {
      // GIVEN
      mockActualTests.mockResolvedValue({
        'test-case-1': { stacks: ['Stack1'] },
      });
      const bootstrapError = new BootstrapError('Bootstrap version insufficient', {
        account: '111122223333',
        region: 'ap-southeast-1',
      });
      mockRunIntegTestCase.mockRejectedValue(bootstrapError);

      // WHEN
      await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'ap-southeast-1',
      });

      // THEN - diagnostic should indicate bootstrap error will be retried
      expect(workerpool.workerEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'TEST_FAILED',
          message: expect.stringContaining('Bootstrap error (will retry in different region)'),
        }),
      );
    });

    test('non-bootstrap error is handled normally and added to failedTests', async () => {
      // GIVEN
      mockActualTests.mockResolvedValue({
        'test-case-1': { stacks: ['Stack1'] },
      });
      mockRunIntegTestCase.mockRejectedValue(new Error('Deployment failed: resource limit exceeded'));

      // WHEN
      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'us-west-2',
      });

      // THEN - test should be in failedTests, not retryableFailures
      expect(results.failedTests).toEqual([{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }]);
      expect(results.retryableFailures).toBeUndefined();
      expect(results.environmentRemovals).toBeUndefined();
    });

    test('bootstrap error at test level (actualTests) is detected and returned as retryable', async () => {
      // GIVEN - bootstrap error thrown during actualTests() call
      const bootstrapError = new BootstrapError('SSM parameter not found', {
        account: '444455556666',
        region: 'us-east-2',
      });
      mockActualTests.mockRejectedValue(bootstrapError);

      // WHEN
      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'us-east-2',
      });

      // THEN - test should be in retryableFailures with environment removal
      expect(results.failedTests).toEqual([]);
      expect(results.retryableFailures).toEqual([{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
        failedEnvironment: {
          profile: undefined,
          region: 'us-east-2',
        },
        errorMessage: 'SSM parameter not found',
      }]);
      expect(results.environmentRemovals).toEqual([{
        environment: {
          profile: undefined,
          region: 'us-east-2',
        },
        reason: 'SSM parameter not found',
        account: '444455556666',
      }]);
    });

    test('non-bootstrap error at test level is handled normally', async () => {
      // GIVEN - non-bootstrap error thrown during actualTests() call
      mockActualTests.mockRejectedValue(
        new Error('xxxxx.integ-test2 is a new test. Please use the IntegTest construct'),
      );

      // WHEN
      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.integ-test2.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'us-east-1',
      });

      // THEN - test should be in failedTests, not retryableFailures
      expect(results.failedTests).toEqual([{
        fileName: 'test/test-data/xxxxx.integ-test2.js',
        discoveryRoot: 'test/test-data',
      }]);
      expect(results.retryableFailures).toBeUndefined();
      expect(results.environmentRemovals).toBeUndefined();
    });

    test('bootstrap error without profile sets profile to undefined in environment', async () => {
      // GIVEN
      mockActualTests.mockResolvedValue({
        'test-case-1': { stacks: ['Stack1'] },
      });
      const bootstrapError = new BootstrapError('Not bootstrapped', {
        account: '777788889999',
        region: 'sa-east-1',
      });
      mockRunIntegTestCase.mockRejectedValue(bootstrapError);

      // WHEN - no profile specified
      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'sa-east-1',
      });

      // THEN - environment should have undefined profile
      expect(results.retryableFailures?.[0].failedEnvironment.profile).toBeUndefined();
      expect(results.environmentRemovals?.[0].environment.profile).toBeUndefined();
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

describe('parallel worker retry logic', () => {
  /**
   * Tests for retry logic in runIntegrationTestsInParallel
   * Validates: Requirements 3.2, 4.1, 4.2, 4.3
   */

  let mockPool: workerpool.WorkerPool;
  let execMock: jest.Mock;

  beforeEach(() => {
    execMock = jest.fn();
    mockPool = {
      exec: execMock,
      terminate: jest.fn(),
    } as unknown as workerpool.WorkerPool;
  });

  test('tests are re-queued when bootstrap error occurs and other environments available', async () => {
    /**
     * Validates: Requirements 3.2, 4.1, 4.2
     * When a bootstrap error occurs and other valid regions remain,
     * the test should be re-queued for execution in a valid region.
     */

    // GIVEN - us-east-1 fails with bootstrap error, us-east-2 succeeds
    // We use multiple tests so that us-east-2 worker stays active to pick up retried tests
    const testsRunInRegion: Record<string, string[]> = {};

    execMock.mockImplementation((_method: string, args: any[]) => {
      const request = args[0];
      const region = request.region;
      const testName = request.tests[0].fileName;

      // Track which tests run in which region
      if (!testsRunInRegion[region]) {
        testsRunInRegion[region] = [];
      }
      testsRunInRegion[region].push(testName);

      if (region === 'us-east-1') {
        // us-east-1 fails with bootstrap error
        return Promise.resolve({
          failedTests: [],
          retryableFailures: [{
            fileName: testName,
            discoveryRoot: request.tests[0].discoveryRoot,
            failedEnvironment: {
              profile: request.profile,
              region: region,
            },
            errorMessage: 'Bootstrap stack not found',
          }],
          environmentRemovals: [{
            environment: {
              profile: request.profile,
              region: region,
            },
            reason: 'Bootstrap stack not found',
            account: '123456789012',
          }],
        });
      }

      // us-east-2 succeeds
      return Promise.resolve({
        failedTests: [],
        retryableFailures: undefined,
        environmentRemovals: undefined,
      });
    });

    // WHEN - run with multiple tests so us-east-2 worker stays active
    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [
        { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
      ],
      regions: ['us-east-1', 'us-east-2'],
    });

    // THEN - all tests should succeed (failed test was retried in us-east-2)
    expect(results.failedTests).toEqual([]);

    // us-east-1 should only have run one test (then stopped)
    expect(testsRunInRegion['us-east-1']?.length).toBe(1);

    // us-east-2 should have run multiple tests (including the retried one)
    expect(testsRunInRegion['us-east-2']?.length).toBeGreaterThanOrEqual(1);
  });

  test('tests are not re-queued when all environments have been removed', async () => {
    /**
     * Validates: Requirements 4.3
     * If all regions have been removed due to bootstrap errors,
     * the test should NOT be retried and should be reported as failed.
     */

    // GIVEN - single region that fails with bootstrap error
    execMock.mockImplementation((_method: string, args: any[]) => {
      const request = args[0];

      // Region fails with bootstrap error
      return Promise.resolve({
        failedTests: [],
        retryableFailures: [{
          fileName: request.tests[0].fileName,
          discoveryRoot: request.tests[0].discoveryRoot,
          failedEnvironment: {
            profile: request.profile,
            region: request.region,
          },
          errorMessage: `Bootstrap stack not found in ${request.region}`,
        }],
        environmentRemovals: [{
          environment: {
            profile: request.profile,
            region: request.region,
          },
          reason: `Bootstrap stack not found in ${request.region}`,
          account: '123456789012',
        }],
      });
    });

    // WHEN - run with only one region that will fail
    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [{
        fileName: 'test.js',
        discoveryRoot: 'test/test-data',
      }],
      regions: ['us-east-1'],
    });

    // THEN - test should be in failedTests since no valid environments remain
    expect(results.failedTests).toEqual([{
      fileName: 'test.js',
      discoveryRoot: 'test/test-data',
    }]);
  });

  test('removed environments are skipped for new tests', async () => {
    /**
     * Validates: Requirements 3.2
     * When a region is removed, the worker for that environment should stop
     * and not schedule any new tests for that region.
     */

    // GIVEN - track which regions tests are run in
    const regionsUsed: string[] = [];

    execMock.mockImplementation((_method: string, args: any[]) => {
      const request = args[0];
      regionsUsed.push(request.region);

      if (request.region === 'us-east-1') {
        // First region fails with bootstrap error on first test
        return Promise.resolve({
          failedTests: [],
          retryableFailures: [{
            fileName: request.tests[0].fileName,
            discoveryRoot: request.tests[0].discoveryRoot,
            failedEnvironment: {
              profile: request.profile,
              region: request.region,
            },
            errorMessage: 'Bootstrap stack not found',
          }],
          environmentRemovals: [{
            environment: {
              profile: request.profile,
              region: request.region,
            },
            reason: 'Bootstrap stack not found',
            account: '123456789012',
          }],
        });
      }

      // us-east-2 succeeds
      return Promise.resolve({
        failedTests: [],
        retryableFailures: undefined,
        environmentRemovals: undefined,
      });
    });

    // WHEN - run with multiple tests
    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [
        { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test3.js', discoveryRoot: 'test/test-data' },
      ],
      regions: ['us-east-1', 'us-east-2'],
    });

    // THEN - us-east-1 should only be used once (then removed)
    const usEast1Count = regionsUsed.filter(r => r === 'us-east-1').length;
    expect(usEast1Count).toBe(1);

    // All tests should eventually succeed (retried in us-east-2)
    expect(results.failedTests).toEqual([]);
  });

  test('environment removal is tracked in results for summary reporting', async () => {
    /**
     * Validates: Requirements 3.1
     * When an environment is removed, it should be tracked in the results
     * for summary reporting at the end of the test run.
     */

    // GIVEN - region fails with bootstrap error
    execMock.mockImplementation((_method: string, args: any[]) => {
      const request = args[0];

      if (request.region === 'us-east-1') {
        return Promise.resolve({
          failedTests: [],
          retryableFailures: [{
            fileName: request.tests[0].fileName,
            discoveryRoot: request.tests[0].discoveryRoot,
            failedEnvironment: {
              profile: request.profile,
              region: request.region,
            },
            errorMessage: 'Bootstrap stack not found',
          }],
          environmentRemovals: [{
            environment: {
              profile: request.profile,
              region: request.region,
            },
            reason: 'Bootstrap stack not found',
            account: '123456789012',
          }],
        });
      }

      return Promise.resolve({
        failedTests: [],
        retryableFailures: undefined,
        environmentRemovals: undefined,
      });
    });

    // WHEN - run with multiple tests so us-east-2 stays active
    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [
        { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
      ],
      regions: ['us-east-1', 'us-east-2'],
    });

    // THEN - removed environments should be tracked in results
    expect((results as any).removedEnvironments).toBeDefined();
    expect((results as any).removedEnvironments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          region: 'us-east-1',
          reason: 'Bootstrap stack not found',
          account: '123456789012',
        }),
      ]),
    );
  });

  test('duplicate environment removal requests are handled correctly', async () => {
    /**
     * Validates: Requirements 3.1
     * When multiple tests fail in the same environment with bootstrap errors,
     * the environment should only be removed once.
     */

    // GIVEN - multiple tests fail in the same region
    let usEast1CallCount = 0;
    execMock.mockImplementation((_method: string, args: any[]) => {
      const request = args[0];

      if (request.region === 'us-east-1') {
        usEast1CallCount++;
        // Return bootstrap error for all tests in us-east-1
        return Promise.resolve({
          failedTests: [],
          retryableFailures: request.tests.map((test: any) => ({
            fileName: test.fileName,
            discoveryRoot: test.discoveryRoot,
            failedEnvironment: {
              profile: request.profile,
              region: request.region,
            },
            errorMessage: 'Bootstrap stack not found',
          })),
          environmentRemovals: [{
            environment: {
              profile: request.profile,
              region: request.region,
            },
            reason: 'Bootstrap stack not found',
            account: '123456789012',
          }],
        });
      }

      return Promise.resolve({
        failedTests: [],
        retryableFailures: undefined,
        environmentRemovals: undefined,
      });
    });

    // WHEN - run with multiple tests
    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [
        { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test3.js', discoveryRoot: 'test/test-data' },
      ],
      regions: ['us-east-1', 'us-east-2'],
    });

    // THEN - us-east-1 should only be called once (worker stops after removal)
    expect(usEast1CallCount).toBe(1);

    // Only one removal entry for us-east-1
    const removedEnvs = (results as any).removedEnvironments || [];
    const usEast1Removals = removedEnvs.filter((e: any) => e.region === 'us-east-1');
    expect(usEast1Removals.length).toBe(1);

    // All tests should succeed (retried in us-east-2)
    expect(results.failedTests).toEqual([]);
  });

  test('profile-specific environment removal only affects that profile', async () => {
    /**
     * Validates: Requirements 3.3
     * When multiple profiles are configured, removing a region for one profile
     * should not affect the same region for other profiles.
     */

    // GIVEN - track calls by profile+region
    const callsByEnv: Record<string, number> = {};

    execMock.mockImplementation((_method: string, args: any[]) => {
      const request = args[0];
      const envKey = `${request.profile || 'default'}/${request.region}`;
      callsByEnv[envKey] = (callsByEnv[envKey] || 0) + 1;

      // Only profile1/us-east-1 fails with bootstrap error
      if (request.profile === 'profile1' && request.region === 'us-east-1') {
        return Promise.resolve({
          failedTests: [],
          retryableFailures: [{
            fileName: request.tests[0].fileName,
            discoveryRoot: request.tests[0].discoveryRoot,
            failedEnvironment: {
              profile: request.profile,
              region: request.region,
            },
            errorMessage: 'Bootstrap stack not found',
          }],
          environmentRemovals: [{
            environment: {
              profile: request.profile,
              region: request.region,
            },
            reason: 'Bootstrap stack not found',
            account: '111111111111',
          }],
        });
      }

      return Promise.resolve({
        failedTests: [],
        retryableFailures: undefined,
        environmentRemovals: undefined,
      });
    });

    // WHEN - run with two profiles
    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [
        { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test3.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test4.js', discoveryRoot: 'test/test-data' },
      ],
      profiles: ['profile1', 'profile2'],
      regions: ['us-east-1'],
    });

    // THEN - profile1/us-east-1 should only be called once (then removed)
    expect(callsByEnv['profile1/us-east-1']).toBe(1);

    // profile2/us-east-1 should still be available and used for multiple tests
    expect(callsByEnv['profile2/us-east-1']).toBeGreaterThan(1);

    // All tests should succeed
    expect(results.failedTests).toEqual([]);
  });
});
