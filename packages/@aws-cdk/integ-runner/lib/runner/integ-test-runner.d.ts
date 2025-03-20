import type { IntegRunnerOptions } from './runner-base';
import { IntegRunner } from './runner-base';
import type { DestructiveChange, AssertionResults } from '../workers/common';
export interface CommonOptions {
    /**
     * The name of the test case
     */
    readonly testCaseName: string;
    /**
     * The level of verbosity for logging.
     *
     * @default 0
     */
    readonly verbosity?: number;
}
export interface WatchOptions extends CommonOptions {
}
/**
 * Options for the integration test runner
 */
export interface RunOptions extends CommonOptions {
    /**
     * Whether or not to run `cdk destroy` and cleanup the
     * integration test stacks.
     *
     * Set this to false if you need to perform any validation
     * or troubleshooting after deployment.
     *
     * @default true
     */
    readonly clean?: boolean;
    /**
     * If set to true, the integration test will not deploy
     * anything and will simply update the snapshot.
     *
     * You should NOT use this method since you are essentially
     * bypassing the integration test.
     *
     * @default false
     */
    readonly dryRun?: boolean;
    /**
     * If this is set to false then the stack update workflow will
     * not be run
     *
     * The update workflow exists to check for cases where a change would cause
     * a failure to an existing stack, but not for a newly created stack.
     *
     * @default true
     */
    readonly updateWorkflow?: boolean;
}
/**
 * An integration test runner that orchestrates executing
 * integration tests
 */
export declare class IntegTestRunner extends IntegRunner {
    constructor(options: IntegRunnerOptions, destructiveChanges?: DestructiveChange[]);
    createCdkContextJson(): void;
    /**
     * When running integration tests with the update path workflow
     * it is important that the snapshot that is deployed is the current snapshot
     * from the upstream branch. In order to guarantee that, first checkout the latest
     * (to the user) snapshot from upstream
     *
     * It is not straightforward to figure out what branch the current
     * working branch was created from. This is a best effort attempt to do so.
     * This assumes that there is an 'origin'. `git remote show origin` returns a list of
     * all branches and we then search for one that starts with `HEAD branch: `
     */
    private checkoutSnapshot;
    /**
     * Runs cdk deploy --watch for an integration test
     *
     * This is meant to be run on a single test and will not create a snapshot
     */
    watchIntegTest(options: WatchOptions): Promise<void>;
    /**
     * Orchestrates running integration tests. Currently this includes
     *
     * 1. (if update workflow is enabled) Deploying the snapshot test stacks
     * 2. Deploying the integration test stacks
     * 2. Saving the snapshot (if successful)
     * 3. Destroying the integration test stacks (if clean=false)
     *
     * The update workflow exists to check for cases where a change would cause
     * a failure to an existing stack, but not for a newly created stack.
     */
    runIntegTestCase(options: RunOptions): AssertionResults | undefined;
    /**
     * Perform a integ test case stack destruction
     */
    private destroy;
    private watch;
    /**
     * Perform a integ test case deployment, including
     * peforming the update workflow
     */
    private deploy;
    /**
     * Process the outputsFile which contains the assertions results as stack
     * outputs
     */
    private processAssertionResults;
    /**
     * Parses an error message returned from a CDK command
     */
    private parseError;
}
