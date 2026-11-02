import builtinFs from 'fs';
import * as path from 'path';
import { BootstrapError, ToolkitError } from '@aws-cdk/toolkit-lib';
import fs from 'fs-extra';
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
  jest.restoreAllMocks();
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
  let mockRunIntegTestCase: jest.Mock;

  beforeEach(() => {
    mockRunIntegTestCase = jest.fn();

    jest.spyOn(IntegTestRunner.prototype, 'runIntegTestCase').mockImplementation(mockRunIntegTestCase);
  });

  test('successful test run emits success diagnostic', async () => {
    mockRunIntegTestCase.mockResolvedValue({
      AssertionResults1: { status: 'success', message: 'Assertion passed' },
    });

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
      testingUsingMocksLeaveDirectories: true,
    });

    expect(results).toEqual([]);
    expect(workerpool.workerEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'TEST_SUCCESS',
        testName: expect.stringContaining('xxxxx.test-with-snapshot'),
      }),
    );
  });

  test('failed assertion emits failure diagnostic and returns test as failed', async () => {
    mockRunIntegTestCase.mockResolvedValue({
      AssertionResults1: { status: 'fail', message: 'Assertion failed: expected X got Y' },
    });

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
      testingUsingMocksLeaveDirectories: true,
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
    mockRunIntegTestCase.mockRejectedValue(new Error('Deployment failed'));

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
      testingUsingMocksLeaveDirectories: true,
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

  test('processes multiple test files in batch', async () => {
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
      testingUsingMocksLeaveDirectories: true,
      region: 'us-east-1',
    });

    expect(results).toEqual([]);
  });

  test('passes profile and region to IntegTestRunner', async () => {
    mockRunIntegTestCase.mockResolvedValue(undefined);

    await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-west-2',
      profile: 'test-profile',
      testingUsingMocksLeaveDirectories: true,
    });

    // Verify runIntegTestCase was called (runner was created and used)
    expect(mockRunIntegTestCase).toHaveBeenCalled();
  });

  test('deployment failure returns test as failed', async () => {
    mockRunIntegTestCase.mockRejectedValue(
      new Error('Stack deployment failed: CREATE_FAILED'),
    );

    const results = await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
      testingUsingMocksLeaveDirectories: true,
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

  describe('bootstrap error handling', () => {
    test('bootstrap error emits NOT_BOOTSTRAPPED diagnostic with environment instead of failing the test', async () => {
      mockRunIntegTestCase.mockRejectedValue(
        new BootstrapError('SsmParameterNotFound', 'SSM parameter /cdk-bootstrap/hnb659fds/version not found', {
          account: '123456789012',
          region: 'us-east-1',
        }),
      );

      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'us-east-1',
        profile: 'test-profile',
        testingUsingMocksLeaveDirectories: true,
      });

      // the test is not failed; the orchestrator decides whether to retry it
      expect(results).toEqual([]);
      expect(workerpool.workerEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'NOT_BOOTSTRAPPED',
          message: expect.stringContaining('SSM parameter /cdk-bootstrap/hnb659fds/version not found'),
          environment: {
            profile: 'test-profile',
            region: 'us-east-1',
            account: '123456789012',
          },
        }),
      );
    });

    test('bootstrap error is detected when wrapped as the cause of another error', async () => {
      // GIVEN - the shape a bootstrap failure actually has by the time it
      // reaches the worker: BootstrapError, wrapped by Deployments (which adds
      // the stack name), wrapped again by Toolkit (which adds the banner)
      const bootstrapError = new BootstrapError('OutdatedBootstrapStack', 'This CDK deployment requires bootstrap stack version 6', {
        account: '123456789012',
        region: 'eu-west-1',
      });
      const withStackName = ToolkitError.withCause('BootstrapVersionValidation', 'Stack1: requires bootstrap stack version 6', bootstrapError);
      const withBanner = ToolkitError.withCause('BootstrapVersionValidation', '❌  Stack1 failed: requires bootstrap stack version 6', withStackName);
      mockRunIntegTestCase.mockRejectedValue(withBanner);

      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'eu-west-1',
        testingUsingMocksLeaveDirectories: true,
      });

      expect(results).toEqual([]);
      expect(workerpool.workerEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'NOT_BOOTSTRAPPED',
          environment: expect.objectContaining({
            profile: undefined,
            region: 'eu-west-1',
            account: '123456789012',
          }),
        }),
      );
    });

    test('non-bootstrap error is still reported as TEST_FAILED', async () => {
      mockRunIntegTestCase.mockRejectedValue(new Error('resource limit exceeded'));

      const results = await integTestWorker({
        tests: [{
          fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
          discoveryRoot: 'test/test-data',
        }],
        region: 'us-west-2',
        testingUsingMocksLeaveDirectories: true,
      });

      expect(results).toEqual([{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }]);
      expect(workerpool.workerEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'TEST_FAILED',
        }),
      );
      expect(workerpool.workerEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'NOT_BOOTSTRAPPED',
        }),
      );
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
      testingUsingMocksLeaveDirectories: true,
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
      testEnvironments: { removed: [] },
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
      testEnvironments: { removed: [] },
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
      testEnvironments: { removed: [] },
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
      testEnvironments: { removed: [] },
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
      testEnvironments: { removed: [] },
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

describe('integTestWorker roleArn', () => {
  let mockActualTests: jest.Mock;
  let mockRunIntegTestCase: jest.Mock;

  beforeEach(() => {
    mockActualTests = jest.fn();
    mockRunIntegTestCase = jest.fn();

    jest.spyOn(IntegTestRunner.prototype, 'runIntegTestCase').mockImplementation(mockRunIntegTestCase);
  });

  test('passes roleArn to runIntegTestCase', async () => {
    mockActualTests.mockResolvedValue({
      'test-case-1': { stacks: ['Stack1'] },
    });
    mockRunIntegTestCase.mockResolvedValue(undefined);

    await integTestWorker({
      tests: [{
        fileName: 'test/test-data/xxxxx.test-with-snapshot.js',
        discoveryRoot: 'test/test-data',
      }],
      region: 'us-east-1',
      roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      testingUsingMocksLeaveDirectories: true,
    });

    expect(mockRunIntegTestCase).toHaveBeenCalledWith(
      expect.objectContaining({ roleArn: 'arn:aws:iam::123456789012:role/MyRole' }),
    );
  });
});

describe('parallel worker bootstrap retry', () => {
  let execMock: jest.Mock;
  let mockPool: workerpool.WorkerPool;

  beforeEach(() => {
    execMock = jest.fn();
    mockPool = {
      exec: execMock,
    } as unknown as workerpool.WorkerPool;
  });

  /**
   * Creates a mock `pool.exec` implementation.
   *
   * Environments matched by `isNotBootstrapped` emit a NOT_BOOTSTRAPPED
   * diagnostic (like the real extract_worker does when it catches a
   * BootstrapError); all other environments succeed.
   */
  function mockExecWithBootstrapFailures(
    isNotBootstrapped: (region: string, profile?: string) => boolean,
    testsRunInEnv?: Record<string, string[]>,
  ) {
    return (_method: string, args: any[], opts?: { on?: (msg: any) => void }) => {
      const request = args[0];
      const testName = request.tests[0].fileName;
      const envName = `${request.profile ? request.profile + '/' : ''}${request.region}`;

      if (testsRunInEnv) {
        (testsRunInEnv[envName] = testsRunInEnv[envName] ?? []).push(testName);
      }

      if (isNotBootstrapped(request.region, request.profile)) {
        opts?.on?.({
          reason: 'NOT_BOOTSTRAPPED',
          testName: `${testName} (${envName})`,
          message: 'Environment is not bootstrapped',
          environment: {
            profile: request.profile,
            region: request.region,
            account: '123456789012',
          },
        });
        // the worker does not fail the test, the orchestrator decides
        return Promise.resolve([]);
      }

      opts?.on?.({
        reason: 'TEST_SUCCESS',
        testName: `${testName} (${envName})`,
        message: 'NO ASSERTIONS',
      });
      return Promise.resolve([]);
    };
  }

  test('test is retried in another environment when a bootstrap error occurs', async () => {
    const testsRunInEnv: Record<string, string[]> = {};
    execMock.mockImplementation(mockExecWithBootstrapFailures((region) => region === 'us-east-1', testsRunInEnv));

    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [
        { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
      ],
      regions: ['us-east-1', 'us-east-2'],
    });

    // all tests eventually pass, the bootstrap-failed one is retried in us-east-2
    expect(results.failedTests).toEqual([]);
    // us-east-1 stops after the bootstrap error
    expect(testsRunInEnv['us-east-1']).toHaveLength(1);
    // us-east-2 runs the remaining test plus the retried one
    const allEast2Tests = testsRunInEnv['us-east-2'];
    expect(allEast2Tests).toEqual(expect.arrayContaining(['test1.js', 'test2.js']));
    // the removal is recorded for the end-of-run summary
    expect(results.testEnvironments.removed).toEqual([
      expect.objectContaining({
        region: 'us-east-1',
        account: '123456789012',
        reason: 'Environment is not bootstrapped',
      }),
    ]);
  });

  test('tests fail when no bootstrapped environments remain', async () => {
    execMock.mockImplementation(mockExecWithBootstrapFailures(() => true));

    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [
        { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
      ],
      regions: ['us-east-1'],
    });

    // the first test fails when the only environment is removed;
    // the queued second test can never be scheduled and fails too
    expect(results.failedTests).toEqual(expect.arrayContaining([
      { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
      { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
    ]));
    expect(results.failedTests).toHaveLength(2);
    expect(results.testEnvironments.removed).toHaveLength(1);
  });

  test('removed environment is not used for subsequent tests', async () => {
    const testsRunInEnv: Record<string, string[]> = {};
    execMock.mockImplementation(mockExecWithBootstrapFailures((region) => region === 'us-east-1', testsRunInEnv));

    const results = await runIntegrationTestsInParallel({
      pool: mockPool,
      tests: [
        { fileName: 'test1.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test2.js', discoveryRoot: 'test/test-data' },
        { fileName: 'test3.js', discoveryRoot: 'test/test-data' },
      ],
      regions: ['us-east-1', 'us-east-2'],
    });

    expect(testsRunInEnv['us-east-1']).toHaveLength(1);
    expect(results.failedTests).toEqual([]);
    // environment is only recorded as removed once
    expect(results.testEnvironments.removed).toHaveLength(1);
  });

  test('removing an environment for one profile does not affect other profiles', async () => {
    const testsRunInEnv: Record<string, string[]> = {};
    execMock.mockImplementation(
      mockExecWithBootstrapFailures((region, profile) => region === 'us-east-1' && profile === 'profile1', testsRunInEnv),
    );

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

    expect(results.failedTests).toEqual([]);
    // profile1/us-east-1 stops after the bootstrap error
    expect(testsRunInEnv['profile1/us-east-1']).toHaveLength(1);
    // profile2/us-east-1 keeps running tests
    expect(testsRunInEnv['profile2/us-east-1'].length).toBeGreaterThan(1);
    expect(results.testEnvironments.removed).toEqual([
      expect.objectContaining({
        profile: 'profile1',
        region: 'us-east-1',
      }),
    ]);
  });
});
