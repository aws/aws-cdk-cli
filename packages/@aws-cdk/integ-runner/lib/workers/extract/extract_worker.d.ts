import type { IntegTestInfo } from '../../runner/integration-tests';
import type { IntegTestWorkerConfig, SnapshotVerificationOptions } from '../common';
import type { IntegTestBatchRequest } from '../integ-test-worker';
import type { IntegWatchOptions } from '../integ-watch-worker';
/**
 * Runs a single integration test batch request.
 * If the test does not have an existing snapshot,
 * this will first generate a snapshot and then execute
 * the integration tests.
 *
 * If the tests succeed it will then save the snapshot
 */
export declare function integTestWorker(request: IntegTestBatchRequest): IntegTestWorkerConfig[];
export declare function watchTestWorker(options: IntegWatchOptions): Promise<void>;
/**
 * Runs a single snapshot test batch request.
 * For each integration test this will check to see
 * if there is an existing snapshot, and if there is will
 * check if there are any changes
 */
export declare function snapshotTestWorker(testInfo: IntegTestInfo, options?: SnapshotVerificationOptions): IntegTestWorkerConfig[];
