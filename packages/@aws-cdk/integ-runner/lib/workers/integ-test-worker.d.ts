import type * as workerpool from 'workerpool';
import type { IntegBatchResponse, IntegTestOptions, IntegRunnerMetrics } from './common';
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
 * Run Integration tests.
 */
export declare function runIntegrationTests(options: IntegTestRunOptions): Promise<{
    success: boolean;
    metrics: IntegRunnerMetrics[];
}>;
/**
 * Runs a set of integration tests in parallel across a list of AWS regions.
 * Only a single test can be run at a time in a given region. Once a region
 * is done running a test, the next test will be pulled from the queue
 */
export declare function runIntegrationTestsInParallel(options: IntegTestRunOptions): Promise<IntegBatchResponse>;
