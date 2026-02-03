import * as chalk from 'chalk';
import type * as workerpool from 'workerpool';
import type { IntegBatchResponse, IntegTestOptions, IntegRunnerMetrics, IntegTestWorkerConfig, EnvironmentRemovalRequest } from './common';
import { printResults, printSummary } from './common';
import { EnvironmentPool, type RemovedEnvironmentInfo, type TestEnvironment } from './environment-pool';
import * as logger from '../logger';
import type { IntegTestWorkerResponse } from './extract/extract_worker';

/**
 * Options for an integration test batch
 */
export interface IntegTestBatchRequest extends IntegTestOptions {
  /**
   * The AWS region to run this batch in
   */
  readonly region: string;

  /**
   * The AWS profile to use when running this test
   */
  readonly profile?: string;
}

/**
 * Options for running all integration tests
 */
export interface IntegTestRunOptions extends IntegTestOptions {
  /**
   * The regions to run the integration tests across.
   * This allows the runner to run integration tests in parallel
   */
  readonly regions: string[];

  /**
   * List of AWS profiles. This will be used in conjunction with `regions`
   * to run tests in parallel across accounts + regions
   */
  readonly profiles?: string[];

  /**
   * The workerpool to use
   */
  readonly pool: workerpool.WorkerPool;
}

/**
 * Result of running integration tests
 */
export interface IntegTestRunResult {
  /**
   * Whether all tests succeeded
   */
  readonly success: boolean;

  /**
   * Metrics from the test run
   */
  readonly metrics: IntegRunnerMetrics[];

  /**
   * Environments that were removed due to bootstrap errors
   */
  readonly removedEnvironments: RemovedEnvironmentInfo[];
}

/**
 * Run Integration tests.
 */
export async function runIntegrationTests(options: IntegTestRunOptions): Promise<IntegTestRunResult> {
  logger.highlight('\nRunning integration tests for failed tests...\n');
  logger.print(
    'Running in parallel across %sregions: %s',
    options.profiles ? `profiles ${options.profiles.join(', ')} and `: '',
    options.regions.join(', '));
  const totalTests = options.tests.length;

  const responses = await runIntegrationTestsInParallel(options);
  logger.highlight('\nTest Results: \n');
  printSummary(totalTests, responses.failedTests.length);
  return {
    success: responses.failedTests.length === 0,
    metrics: responses.metrics,
    removedEnvironments: (responses as any).removedEnvironments ?? [],
  };
}

/**
 * Represents a worker for a single account + region
 */
interface AccountWorker {
  /**
   * The region the worker should run in
   */
  readonly region: string;

  /**
   * The AWS profile that the worker should use
   * This will be passed as the '--profile' option to the CDK CLI
   *
   * @default - default profile
   */
  readonly profile?: string;
}

/**
 * Returns a list of AccountWorkers based on the list of regions and profiles
 * given to the CLI.
 */
function getAccountWorkers(regions: string[], profiles?: string[]): AccountWorker[] {
  const workers: AccountWorker[] = [];
  function pushWorker(profile?: string) {
    for (const region of regions) {
      workers.push({
        region,
        profile,
      });
    }
  }
  if (profiles && profiles.length > 0) {
    for (const profile of profiles ?? []) {
      pushWorker(profile);
    }
  } else {
    pushWorker();
  }
  return workers;
}

/**
 * Runs a set of integration tests in parallel across a list of AWS regions.
 * Only a single test can be run at a time in a given region. Once a region
 * is done running a test, the next test will be pulled from the queue
 */
export async function runIntegrationTestsInParallel(
  options: IntegTestRunOptions,
): Promise<IntegBatchResponse> {
  const queue = options.tests;
  const results: IntegBatchResponse = {
    metrics: [],
    failedTests: [],
  };
  const accountWorkers: AccountWorker[] = getAccountWorkers(options.regions, options.profiles);

  // Create EnvironmentPool from initial environments
  const initialEnvironments: TestEnvironment[] = accountWorkers.map(w => ({
    profile: w.profile,
    region: w.region,
  }));
  const environmentPool = new EnvironmentPool(initialEnvironments);

  // Track retryable failures that need to be re-queued
  const retryQueue: IntegTestWorkerConfig[] = [];

  async function runTest(worker: AccountWorker): Promise<void> {
    const start = Date.now();
    const tests: { [testName: string]: number } = {};
    const workerEnv: TestEnvironment = { profile: worker.profile, region: worker.region };

    do {
      // Check if this worker's environment is still available
      if (!environmentPool.isAvailable(workerEnv)) {
        // Environment was removed due to bootstrap error, stop this worker
        break;
      }

      // Try to get a test from the main queue first, then from retry queue
      let test = queue.pop();
      if (!test && retryQueue.length > 0) {
        test = retryQueue.pop();
      }
      if (!test) break;

      const testStart = Date.now();
      logger.highlight(`Running test ${test.fileName} in ${worker.profile ? worker.profile + '/' : ''}${worker.region}`);
      const response: IntegTestWorkerResponse = await options.pool.exec('integTestWorker', [{
        watch: options.watch,
        region: worker.region,
        profile: worker.profile,
        tests: [test],
        clean: options.clean,
        dryRun: options.dryRun,
        verbosity: options.verbosity,
        updateWorkflow: options.updateWorkflow,
      }], {
        on: printResults,
      });

      // Process environment removals
      if (response.environmentRemovals) {
        for (const removal of response.environmentRemovals) {
          if (environmentPool.isAvailable(removal.environment)) {
            environmentPool.removeEnvironment(removal.environment, removal.reason, removal.account);
            emitEnvironmentRemovedWarning(removal);
          }
        }
      }

      // Process retryable failures - re-queue if valid environments remain
      if (response.retryableFailures) {
        for (const failure of response.retryableFailures) {
          const availableEnvs = environmentPool.getAvailableEnvironments();
          if (availableEnvs.length > 0) {
            // Re-queue the test for retry in a different environment
            retryQueue.push({
              fileName: failure.fileName,
              discoveryRoot: failure.discoveryRoot,
            });
            emitTestRetryInfo(failure.fileName);
          } else {
            // No valid environments remain - add to failed tests
            results.failedTests.push({
              fileName: failure.fileName,
              discoveryRoot: failure.discoveryRoot,
            });
            logger.print(chalk.red(`  No valid environments remaining for test ${failure.fileName}`));
          }
        }
      }

      // Add non-retryable failures to results
      results.failedTests.push(...response.failedTests);
      tests[test.fileName] = (Date.now() - testStart) / 1000;
    } while (queue.length > 0 || retryQueue.length > 0);

    const metrics: IntegRunnerMetrics = {
      region: worker.region,
      profile: worker.profile,
      duration: (Date.now() - start) / 1000,
      tests,
    };
    if (Object.keys(tests).length > 0) {
      results.metrics.push(metrics);
    }
  }

  const workers = accountWorkers.map((worker) => runTest(worker));
  // Workers are their own concurrency limits
  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  await Promise.all(workers);

  // Store removed environments in results for summary reporting
  const removedEnvs = environmentPool.getRemovedEnvironments();
  if (removedEnvs.length > 0) {
    (results as any).removedEnvironments = removedEnvs;
  }

  return results;
}

/**
 * Emits a warning when an environment is removed due to a bootstrap error
 */
function emitEnvironmentRemovedWarning(removal: EnvironmentRemovalRequest): void {
  const profileStr = removal.environment.profile ? `${removal.environment.profile}/` : '';
  const accountStr = removal.account ? `aws://${removal.account}/${removal.environment.region}` : removal.environment.region;

  logger.warning(
    chalk.yellow(`\n⚠️  Environment ${profileStr}${removal.environment.region} removed due to bootstrap error`),
  );
  logger.warning(chalk.yellow(`   Reason: ${removal.reason}`));
  logger.warning(chalk.yellow(`   Run: ${chalk.blue(`cdk bootstrap ${accountStr}`)}\n`));
}

/**
 * Emits an info message when a test is being retried in a different environment
 */
function emitTestRetryInfo(testFileName: string): void {
  logger.print(`  ℹ️  Test ${chalk.cyan(testFileName)} will be retried in a different environment`);
}
