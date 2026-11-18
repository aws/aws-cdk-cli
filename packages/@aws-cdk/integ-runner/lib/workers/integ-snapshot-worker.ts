import type * as workerpool from 'workerpool';
import type { Diagnostic, IntegTestWorkerConfig, SnapshotVerificationOptions } from './common';
import { DiagnosticReason, printSummary, printResults, printLaggards } from './common';
import * as logger from '../logger';
import type { IntegTest } from '../runner/integration-tests';
import { flatten, WorkList } from '../utils';

/**
 * Run Snapshot tests
 * First batch up the tests. By default there will be 3 tests per batch.
 * Use a workerpool to run the batches in parallel.
 *
 * With `--quiet` (negative verbosity), tests with unchanged snapshots are not
 * printed individually, but counted in the summary line.
 */
export async function runSnapshotTests(
  pool: workerpool.WorkerPool,
  tests: IntegTest[],
  options: SnapshotVerificationOptions,
): Promise<IntegTestWorkerConfig[]> {
  logger.highlight('\nVerifying integration test snapshots...\n');

  const todo = new WorkList(tests.map(t => t.testName), {
    onTimeout: printLaggards,
  });

  const hideUnchanged = (options.verbosity ?? 0) < 0;
  let unchanged = 0;

  // The worker pool is already limited
  // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
  const failedTests: IntegTestWorkerConfig[][] = await Promise.all(
    tests.map((test) => pool.exec('snapshotTestWorker', [test.info /* Dehydrate class -> data */, options], {
      on: (x: Diagnostic) => {
        todo.crossOff(x.testName);
        if (hideUnchanged && x.reason === DiagnosticReason.SNAPSHOT_SUCCESS) {
          unchanged++;
          return;
        }
        printResults(x);
      },
    })),
  );
  todo.done();
  const testsToRun = flatten(failedTests);

  logger.always.highlight('\nSnapshot Results: \n');
  printSummary(tests.length, testsToRun.length, hideUnchanged ? unchanged : undefined);
  return testsToRun;
}
