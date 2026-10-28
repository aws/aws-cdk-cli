import chalk from 'chalk';
import type * as workerpool from 'workerpool';
import type { IntegBatchResponse, IntegTestOptions, IntegRunnerMetrics, IntegTestWorkerConfig, Diagnostic } from './common';
import { DiagnosticReason, formatEnvironmentName, printResults, printSummary } from './common';
import type { EnvironmentSummary } from './environment-pool';
import { EnvironmentPool } from './environment-pool';
import * as logger from '../logger';
import { IntegTest, testNameFromInfo, type IntegTestInfo } from '../runner/integration-tests';
import { IntegManifestReader, NoManifestError } from '../runner/private/integ-manifest';
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
 * The regions a test is allowed to run in, as declared by the `regions` field
 * of its integ manifest (`integ.json`).
 *
 * Returns `undefined` when the test declares no restriction (it may run in any
 * region): it has no readable manifest (a legacy or brand-new test), or no test
 * case sets `regions`. When multiple test cases set `regions`, the whole test
 * app is deployed to a single region, so the intersection of their allowlists
 * is returned (the chosen region must satisfy every constrained test case).
 */
function declaredRegions(test: IntegTestInfo): string[] | undefined {
  let testCases;
  try {
    testCases = IntegManifestReader.fromPath(IntegTest.hydrate(test).snapshotDir).tests.testCases;
  } catch (e) {
    // A missing manifest is a legacy or brand-new test that declares no
    // restriction. A present-but-invalid manifest is a real error and must NOT
    // be treated as "no restriction" (that would silently drop the region
    // allowlist, the very bug this change prevents), so let it propagate to be
    // reported against the specific test.
    if (e instanceof NoManifestError) {
      return undefined;
    }
    throw e;
  }

  const declared = Object.values(testCases)
    .map((testCase) => testCase.regions)
    .filter((regions): regions is string[] => regions !== undefined && regions.length > 0);

  if (declared.length === 0) {
    return undefined;
  }

  return declared.reduce((acc, regions) => acc.filter((region) => regions.includes(region)));
}

/**
 * Index of the last element matching `predicate`, or -1 if none match.
 */
function lastIndexMatching<A>(xs: A[], predicate: (x: A) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) {
    if (predicate(xs[i])) {
      return i;
    }
  }
  return -1;
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

  // The regions available in this run (the pool tests are scheduled across).
  const poolRegions = new Set(accountWorkers.map((worker) => worker.region));

  // For each test, the subset of pool regions it is allowed to run in, as
  // declared by its integ manifest `regions`. A test that declares no
  // restriction is unconstrained and is left out of this map (it may run in
  // any region).
  const eligibleRegions = new Map<IntegTestWorkerConfig, Set<string>>();

  /**
   * Take the next test from the queue that may run in `region`.
   *
   * A region-constrained test eligible for this region is taken before an
   * unconstrained one, so an unconstrained test cannot starve a constrained
   * test by grabbing its only eligible region. Returns `undefined` if no
   * remaining test may run here.
   */
  function takeTestForRegion(q: IntegTestWorkerConfig[], region: string): IntegTestWorkerConfig | undefined {
    let idx = lastIndexMatching(q, (test) => eligibleRegions.get(test)?.has(region) ?? false);
    if (idx < 0) {
      idx = lastIndexMatching(q, (test) => !eligibleRegions.has(test));
    }
    return idx < 0 ? undefined : q.splice(idx, 1)[0];
  }

  // Whether some still-available environment may run this test.
  const hasEligibleEnvironment = (test: IntegTestWorkerConfig): boolean => {
    const eligible = eligibleRegions.get(test);
    return accountWorkers.some((worker) =>
      environmentPool.isAvailable(worker) && (eligible?.has(worker.region) ?? !eligibleRegions.has(test)));
  };

  async function runTestsForWorker(worker: AccountWorker, queue: IntegTestWorkerConfig[], retryQueue: IntegTestWorkerConfig[]): Promise<void> {
    const start = Date.now();
    const metrics = workerMetrics.get(worker) ?? { duration: 0, tests: {} };
    workerMetrics.set(worker, metrics);

    do {
      // The environment may have been removed because of a bootstrap error; stop this worker
      if (!environmentPool.isAvailable(worker)) break;
      const test = takeTestForRegion(queue, worker.region);
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

  // Build the run queue, honoring each test's declared `regions` allowlist.
  // A test that restricts itself to regions, none of which are in the pool, can
  // never be scheduled; report it as an error rather than silently skipping it
  // (a silent skip would make a wrongly-configured run look green).
  let queue: IntegTestWorkerConfig[] = [];
  for (const test of options.tests) {
    let declared: string[] | undefined;
    try {
      declared = declaredRegions(test);
    } catch (e) {
      // The test's integ manifest exists but could not be read; report it
      // rather than silently dropping its region restriction and running it
      // in a region it may have meant to exclude.
      printResults({
        reason: DiagnosticReason.TEST_ERROR,
        testName: testNameFromInfo(test),
        message: `could not read integ manifest to determine allowed regions: ${e instanceof Error ? e.message : String(e)}`,
        duration: 0,
      });
      failedTests.push(test);
      continue;
    }

    if (declared === undefined) {
      // No region restriction; may run in any pool region.
      queue.push(test);
      continue;
    }

    if (declared.length === 0) {
      // The test's own test cases declare disjoint `regions`, so no single
      // region can satisfy all of them and it can never be scheduled.
      printResults({
        reason: DiagnosticReason.TEST_ERROR,
        testName: testNameFromInfo(test),
        message: 'test cases declare disjoint `regions` allowlists, so no single region can run them all; reconcile the regions declared across the test cases',
        duration: 0,
      });
      failedTests.push(test);
      continue;
    }

    const eligible = declared.filter((region) => poolRegions.has(region));
    if (eligible.length === 0) {
      printResults({
        reason: DiagnosticReason.TEST_ERROR,
        testName: testNameFromInfo(test),
        message: `test restricts deployment to regions [${declared.join(', ')}], none of which are in the deployment region pool [${options.regions.join(', ')}]; add one of these regions to --parallel-regions to run this test`,
        duration: 0,
      });
      failedTests.push(test);
      continue;
    }

    eligibleRegions.set(test, new Set(eligible));
    queue.push(test);
  }

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

    // A test can be left in the queue when no active worker's region is in its
    // allowlist (e.g. the only eligible environments were removed). If no
    // remaining environment can ever run it, report it and drop it, so every
    // round makes progress and the loop terminates.
    const runnable: IntegTestWorkerConfig[] = [];
    for (const test of queue) {
      if (hasEligibleEnvironment(test)) {
        runnable.push(test);
      } else {
        logger.print(chalk.red(`No eligible environment remaining to run test ${testNameFromInfo(test)}`));
        failedTests.push(test);
      }
    }
    queue = runnable;
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
