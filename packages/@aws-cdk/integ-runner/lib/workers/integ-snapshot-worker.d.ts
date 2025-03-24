import type * as workerpool from 'workerpool';
import type { IntegTestWorkerConfig, SnapshotVerificationOptions } from './common';
import type { IntegTest } from '../runner/integration-tests';
/**
 * Run Snapshot tests
 * First batch up the tests. By default there will be 3 tests per batch.
 * Use a workerpool to run the batches in parallel.
 */
export declare function runSnapshotTests(pool: workerpool.WorkerPool, tests: IntegTest[], options: SnapshotVerificationOptions): Promise<IntegTestWorkerConfig[]>;
