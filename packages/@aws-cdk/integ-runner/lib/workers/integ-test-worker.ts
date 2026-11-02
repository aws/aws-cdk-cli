import chalk from 'chalk';
import type * as workerpool from 'workerpool';
import type { IntegBatchResponse, IntegTestOptions, IntegRunnerMetrics, IntegTestWorkerConfig, Diagnostic } from './common';
import { DiagnosticReason, formatEnvironmentName, printResults, printSummary } from './common';
import type { EnvironmentSummary } from './environment-pool';
import { EnvironmentPool } from './environment-pool';
import * as logger from '../logger';
import { testNameFromInfo, type IntegTestInfo } from '../runner/integration-tests';
import { flatten } from '../utils';

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

  /**
   * In unit test mode, leave the synth output directories, don't clean them.
   *
   * Many of our tests use mocks and don't actually synth output directories, they are
   * static and must not be deleted.
   */
  readonly testingUsingMocksLeaveDirectories?: boolean;

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
 * Run Integration tests.
 */
export async function runIntegrationTests(options: IntegTestRunOptions): Promise<{
  success: boolean;
  metrics: IntegRunnerMetrics[];
  testEnvironments: EnvironmentSummary;
}> {
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
    testEnvironments: responses.testEnvironments,
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
 *
 * When a test fails because its environment is not bootstrapped, the
 * environment is removed from the pool and the test is retried in the
 * remaining environments (in a follow-up round). If no environments remain,
 * the affected tests are reported as failed.
 */
export async function runIntegrationTestsInParallel(
  options: IntegTestRunOptions,
): Promise<IntegBatchResponse> {
  const accountWorkers: AccountWorker[] = getAccountWorkers(options.regions, options.profiles);
  const environmentPool = new EnvironmentPool(accountWorkers.map(w => ({ profile: w.profile, region: w.region })));

  const failedTests: IntegTestInfo[] = [];
  // Aggregated metrics per worker; a worker may participate in multiple rounds
  const workerMetrics = new Map<AccountWorker, { duration: number; tests: { [testName: string]: number } }>();

  async function runTestsForWorker(worker: AccountWorker, queue: IntegTestWorkerConfig[], retryQueue: IntegTestWorkerConfig[]): Promise<void> {
    const start = Date.now();
    const metrics = workerMetrics.get(worker) ?? { duration: 0, tests: {} };
    workerMetrics.set(worker, metrics);

    do {
      // The environment may have been removed because of a bootstrap error; stop this worker
      if (!environmentPool.isAvailable(worker)) break;
      const test = queue.pop();
      if (!test) break;
      const testStart = Date.now();

      logger.highlight(`Running test ${testNameFromInfo(test)} in ${formatEnvironmentName(worker)}`);
      const response: IntegTestInfo[][] = await options.pool.exec('integTestWorker', [{
        watch: options.watch,
        region: worker.region,
        profile: worker.profile,
        tests: [test],
        clean: options.clean,
        dryRun: options.dryRun,
        verbosity: options.verbosity,
        updateWorkflow: options.updateWorkflow,
        updateFromTags: options.updateFromTags,
        proxy: options.proxy,
        caBundlePath: options.caBundlePath,
        roleArn: options.roleArn,
        allowDeleteFailures: options.allowDeleteFailures,
      }], {
        on: (diagnostic: Diagnostic) => {
          printResults(diagnostic);
          if (diagnostic.reason === DiagnosticReason.NOT_BOOTSTRAPPED) {
            handleNotBootstrapped(diagnostic, test, retryQueue);
          }
        },
      });

      failedTests.push(...flatten(response));
      metrics.tests[test.fileName] = (Date.now() - testStart) / 1000;
    } while (queue.length > 0);

    metrics.duration += (Date.now() - start) / 1000;
  }

  /**
   * A test could not run because its environment is not bootstrapped.
   *
   * Remove the environment from the pool so no further tests are scheduled
   * there, and queue the test for a retry in the remaining environments.
   */
  function handleNotBootstrapped(diagnostic: Diagnostic, test: IntegTestWorkerConfig, retryQueue: IntegTestWorkerConfig[]): void {
    const environment = diagnostic.environment;
    if (environment && environmentPool.remove(environment, diagnostic.message)) {
      const bootstrapTarget = environment.account ? `aws://${environment.account}/${environment.region}` : environment.region;
      const profileArg = environment.profile ? ` --profile ${environment.profile}` : '';
      logger.warning('Environment %s is not bootstrapped, removing it from the test run.', formatEnvironmentName(environment));
      logger.warning('To use this environment, run: %s', chalk.blue(`cdk bootstrap${profileArg} ${bootstrapTarget}`));
    }

    if (environmentPool.hasAvailable()) {
      logger.print('Test %s will be retried in another environment', chalk.cyan(testNameFromInfo(test)));
      retryQueue.push(test);
    } else {
      logger.print(chalk.red(`No bootstrapped environments remaining to run test ${testNameFromInfo(test)}`));
      failedTests.push(test);
    }
  }

  // Run rounds of tests until the queue is drained or no environments remain.
  // The first round runs all tests; subsequent rounds only run tests that hit
  // a bootstrap error in a previous round. Each additional round implies an
  // environment was removed, so the number of rounds is bounded.
  let queue = [...options.tests];
  while (queue.length > 0) {
    const activeWorkers = accountWorkers.filter((worker) => environmentPool.isAvailable(worker));
    if (activeWorkers.length === 0) {
      for (const test of queue) {
        logger.print(chalk.red(`No bootstrapped environments remaining to run test ${testNameFromInfo(test)}`));
      }
      failedTests.push(...queue);
      break;
    }

    const retryQueue: IntegTestWorkerConfig[] = [];
    // Workers are their own concurrency limits
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all(activeWorkers.map((worker) => runTestsForWorker(worker, queue, retryQueue)));

    // The next round runs the tests that hit a bootstrap error, plus any
    // tests that were never attempted because all workers stopped early
    // (which can only happen when their environments were removed).
    queue = [...queue, ...retryQueue];
  }

  return {
    failedTests,
    metrics: Array.from(workerMetrics.entries())
      .filter(([_, m]) => Object.keys(m.tests).length > 0)
      .map(([worker, m]) => ({
        region: worker.region,
        profile: worker.profile,
        duration: m.duration,
        tests: m.tests,
      })),
    testEnvironments: environmentPool.summary(),
  };
}
