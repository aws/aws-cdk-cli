import * as workerpool from 'workerpool';
import { IntegSnapshotRunner, IntegTestRunner } from '../../runner';
import type { IntegTestInfo } from '../../runner/integration-tests';
import { IntegTest } from '../../runner/integration-tests';
import { detectBootstrapError } from '../bootstrap-error-detection';
import type { IntegTestWorkerConfig, SnapshotVerificationOptions, Diagnostic, EnvironmentRemovalRequest, RetryableTestFailure } from '../common';
import { DiagnosticReason, formatAssertionResults, formatError } from '../common';
import type { TestEnvironment } from '../environment-pool';
import type { IntegTestBatchRequest } from '../integ-test-worker';
import type { IntegWatchOptions } from '../integ-watch-worker';

/**
 * Response from the integTestWorker function
 */
export interface IntegTestWorkerResponse {
  /**
   * Tests that failed (non-retryable)
   */
  readonly failedTests: IntegTestWorkerConfig[];

  /**
   * Tests that failed but may succeed if retried in a different environment
   */
  readonly retryableFailures?: RetryableTestFailure[];

  /**
   * Environments that should be removed from the pool
   */
  readonly environmentRemovals?: EnvironmentRemovalRequest[];
}

/**
 * Runs a single integration test batch request.
 * If the test does not have an existing snapshot,
 * this will first generate a snapshot and then execute
 * the integration tests.
 *
 * If the tests succeed it will then save the snapshot
 */
export async function integTestWorker(request: IntegTestBatchRequest): Promise<IntegTestWorkerResponse> {
  const failures: IntegTestInfo[] = [];
  const retryableFailures: RetryableTestFailure[] = [];
  const environmentRemovals: EnvironmentRemovalRequest[] = [];
  const verbosity = request.verbosity ?? 0;

  // Create the current environment from the request
  const currentEnvironment: TestEnvironment = {
    profile: request.profile,
    region: request.region,
  };

  for (const testInfo of request.tests) {
    const test = new IntegTest({
      ...testInfo,
      watch: request.watch,
    }); // Hydrate from data
    const start = Date.now();

    try {
      const runner = new IntegTestRunner({
        test,
        profile: request.profile,
        region: request.region,
        env: {
          CDK_DOCKER: process.env.CDK_DOCKER ?? 'docker',
        },
        showOutput: verbosity >= 2,
      }, testInfo.destructiveChanges);

      const tests = await runner.actualTests();

      if (!tests || Object.keys(tests).length === 0) {
        throw new Error(`No tests defined for ${runner.testName}`);
      }
      for (const testCaseName of Object.keys(tests)) {
        try {
          const results = await runner.runIntegTestCase({
            testCaseName,
            clean: request.clean,
            dryRun: request.dryRun,
            updateWorkflow: request.updateWorkflow,
            verbosity,
          });
          if (results && Object.values(results).some(result => result.status === 'fail')) {
            failures.push(testInfo);
            workerpool.workerEmit({
              reason: DiagnosticReason.ASSERTION_FAILED,
              testName: `${runner.testName}-${testCaseName} (${request.profile}/${request.region})`,
              message: formatAssertionResults(results),
              duration: (Date.now() - start) / 1000,
            });
          } else {
            workerpool.workerEmit({
              reason: DiagnosticReason.TEST_SUCCESS,
              testName: `${runner.testName}-${testCaseName}`,
              message: results ? formatAssertionResults(results) : 'NO ASSERTIONS',
              duration: (Date.now() - start) / 1000,
            });
          }
        } catch (e) {
          // Check if this is a bootstrap error
          const bootstrapInfo = detectBootstrapError(e);
          if (bootstrapInfo.isBootstrapError) {
            // This is a retryable failure - add to retryable list
            retryableFailures.push({
              ...testInfo,
              failedEnvironment: currentEnvironment,
              errorMessage: bootstrapInfo.message,
            });

            // Request environment removal
            environmentRemovals.push({
              environment: currentEnvironment,
              reason: bootstrapInfo.message,
              account: bootstrapInfo.account,
            });

            workerpool.workerEmit({
              reason: DiagnosticReason.TEST_FAILED,
              testName: `${runner.testName}-${testCaseName} (${request.profile}/${request.region})`,
              message: `Bootstrap error (will retry in different region): ${formatError(e)}`,
              duration: (Date.now() - start) / 1000,
            });
          } else {
            // Non-bootstrap error - regular failure
            failures.push(testInfo);
            workerpool.workerEmit({
              reason: DiagnosticReason.TEST_FAILED,
              testName: `${runner.testName}-${testCaseName} (${request.profile}/${request.region})`,
              message: `Integration test failed: ${formatError(e)}`,
              duration: (Date.now() - start) / 1000,
            });
          }
        }
      }
    } catch (e) {
      // Check if this is a bootstrap error at the test level
      const bootstrapInfo = detectBootstrapError(e);
      if (bootstrapInfo.isBootstrapError) {
        // This is a retryable failure - add to retryable list
        retryableFailures.push({
          ...testInfo,
          failedEnvironment: currentEnvironment,
          errorMessage: bootstrapInfo.message,
        });

        // Request environment removal
        environmentRemovals.push({
          environment: currentEnvironment,
          reason: bootstrapInfo.message,
          account: bootstrapInfo.account,
        });

        workerpool.workerEmit({
          reason: DiagnosticReason.TEST_ERROR,
          testName: `${testInfo.fileName} (${request.profile}/${request.region})`,
          message: `Bootstrap error (will retry in different region): ${formatError(e)}`,
          duration: (Date.now() - start) / 1000,
        });
      } else {
        // Non-bootstrap error - regular failure
        failures.push(testInfo);
        workerpool.workerEmit({
          reason: DiagnosticReason.TEST_ERROR,
          testName: `${testInfo.fileName} (${request.profile}/${request.region})`,
          message: `Error during integration test: ${formatError(e)}`,
          duration: (Date.now() - start) / 1000,
        });
      }
    }
  }

  return {
    failedTests: failures,
    retryableFailures: retryableFailures.length > 0 ? retryableFailures : undefined,
    environmentRemovals: environmentRemovals.length > 0 ? environmentRemovals : undefined,
  };
}

export async function watchTestWorker(options: IntegWatchOptions): Promise<void> {
  const verbosity = options.verbosity ?? 0;
  const test = new IntegTest(options);
  const runner = new IntegTestRunner({
    test,
    profile: options.profile,
    region: options.region,
    env: {
      CDK_DOCKER: process.env.CDK_DOCKER ?? 'docker',
    },
    showOutput: verbosity >= 2,
  });
  runner.createCdkContextJson();
  const tests = await runner.actualTests();

  if (!tests || Object.keys(tests).length === 0) {
    throw new Error(`No tests defined for ${runner.testName}`);
  }
  for (const testCaseName of Object.keys(tests)) {
    await runner.watchIntegTest({
      testCaseName,
      verbosity,
    });
  }
}

/**
 * Runs a single snapshot test batch request.
 * For each integration test this will check to see
 * if there is an existing snapshot, and if there is will
 * check if there are any changes
 */
export async function snapshotTestWorker(testInfo: IntegTestInfo, options: SnapshotVerificationOptions = {}): Promise<IntegTestWorkerConfig[]> {
  const failedTests = new Array<IntegTestWorkerConfig>();
  const start = Date.now();
  const test = new IntegTest(testInfo); // Hydrate the data record again

  const timer = setTimeout(() => {
    workerpool.workerEmit({
      reason: DiagnosticReason.TEST_WARNING,
      testName: test.testName,
      message: 'Test is taking a very long time',
      duration: (Date.now() - start) / 1000,
    });
  }, 60_000);

  try {
    const runner = new IntegSnapshotRunner({
      test,
      showOutput: options.verbose ?? false,
    });
    if (!runner.hasSnapshot()) {
      workerpool.workerEmit({
        reason: DiagnosticReason.NO_SNAPSHOT,
        testName: test.testName,
        message: 'No Snapshot',
        duration: (Date.now() - start) / 1000,
      });
      failedTests.push(test.info);
    } else {
      const { diagnostics, destructiveChanges } = await runner.testSnapshot(options);
      if (diagnostics.length > 0) {
        diagnostics.forEach(diagnostic => workerpool.workerEmit({
          ...diagnostic,
          duration: (Date.now() - start) / 1000,
        } as Diagnostic));
        failedTests.push({
          ...test.info,
          destructiveChanges,
        });
      } else {
        workerpool.workerEmit({
          reason: DiagnosticReason.SNAPSHOT_SUCCESS,
          testName: test.testName,
          message: 'Success',
          duration: (Date.now() - start) / 1000,
        } as Diagnostic);
      }
    }
  } catch (e: any) {
    failedTests.push(test.info);
    workerpool.workerEmit({
      message: formatError(e),
      testName: test.testName,
      reason: DiagnosticReason.SNAPSHOT_ERROR,
      duration: (Date.now() - start) / 1000,
    } as Diagnostic);
  } finally {
    clearTimeout(timer);
  }

  return failedTests;
}

workerpool.worker({
  snapshotTestWorker,
  integTestWorker,
  watchTestWorker,
});
