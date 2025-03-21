"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegTestRunner = void 0;
const path = require("path");
const cdk_cli_wrapper_1 = require("@aws-cdk/cdk-cli-wrapper");
const cloud_assembly_schema_1 = require("@aws-cdk/cloud-assembly-schema");
const chokidar = require("chokidar");
const fs = require("fs-extra");
const workerpool = require("workerpool");
const runner_base_1 = require("./runner-base");
const logger = require("../logger");
const utils_1 = require("../utils");
const common_1 = require("../workers/common");
/**
 * An integration test runner that orchestrates executing
 * integration tests
 */
class IntegTestRunner extends runner_base_1.IntegRunner {
    constructor(options, destructiveChanges) {
        super(options);
        this._destructiveChanges = destructiveChanges;
        // We don't want new tests written in the legacy mode.
        // If there is no existing snapshot _and_ this is a legacy
        // test then point the user to the new `IntegTest` construct
        if (!this.hasSnapshot() && this.isLegacyTest) {
            throw new Error(`${this.testName} is a new test. Please use the IntegTest construct ` +
                'to configure the test\n' +
                'https://github.com/aws/aws-cdk/tree/main/packages/%40aws-cdk/integ-tests-alpha');
        }
    }
    createCdkContextJson() {
        if (!fs.existsSync(this.cdkContextPath)) {
            fs.writeFileSync(this.cdkContextPath, JSON.stringify({
                watch: {},
            }, undefined, 2));
        }
    }
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
    checkoutSnapshot() {
        const cwd = this.directory;
        // https://git-scm.com/docs/git-merge-base
        let baseBranch = undefined;
        // try to find the base branch that the working branch was created from
        try {
            const origin = (0, utils_1.exec)(['git', 'remote', 'show', 'origin'], {
                cwd,
            });
            const originLines = origin.split('\n');
            for (const line of originLines) {
                if (line.trim().startsWith('HEAD branch: ')) {
                    baseBranch = line.trim().split('HEAD branch: ')[1];
                }
            }
        }
        catch (e) {
            logger.warning('%s\n%s', 'Could not determine git origin branch.', `You need to manually checkout the snapshot directory ${this.snapshotDir}` +
                'from the merge-base (https://git-scm.com/docs/git-merge-base)');
            logger.warning('error: %s', e);
        }
        // if we found the base branch then get the merge-base (most recent common commit)
        // and checkout the snapshot using that commit
        if (baseBranch) {
            const relativeSnapshotDir = path.relative(this.directory, this.snapshotDir);
            try {
                const base = (0, utils_1.exec)(['git', 'merge-base', 'HEAD', baseBranch], {
                    cwd,
                });
                (0, utils_1.exec)(['git', 'checkout', base, '--', relativeSnapshotDir], {
                    cwd,
                });
            }
            catch (e) {
                logger.warning('%s\n%s', `Could not checkout snapshot directory '${this.snapshotDir}'. Please verify the following command completes correctly:`, `git checkout $(git merge-base HEAD ${baseBranch}) -- ${relativeSnapshotDir}`, '');
                logger.warning('error: %s', e);
            }
        }
    }
    /**
     * Runs cdk deploy --watch for an integration test
     *
     * This is meant to be run on a single test and will not create a snapshot
     */
    async watchIntegTest(options) {
        const actualTestCase = this.actualTestSuite.testSuite[options.testCaseName];
        if (!actualTestCase) {
            throw new Error(`Did not find test case name '${options.testCaseName}' in '${Object.keys(this.actualTestSuite.testSuite)}'`);
        }
        const enableForVerbosityLevel = (needed = 1) => {
            const verbosity = options.verbosity ?? 0;
            return (verbosity >= needed) ? true : undefined;
        };
        try {
            await this.watch({
                ...this.defaultArgs,
                progress: cdk_cli_wrapper_1.StackActivityProgress.BAR,
                hotswap: cdk_cli_wrapper_1.HotswapMode.FALL_BACK,
                deploymentMethod: 'direct',
                profile: this.profile,
                requireApproval: cloud_assembly_schema_1.RequireApproval.NEVER,
                traceLogs: enableForVerbosityLevel(2) ?? false,
                verbose: enableForVerbosityLevel(3),
                debug: enableForVerbosityLevel(4),
                watch: true,
            }, options.testCaseName, options.verbosity ?? 0);
        }
        catch (e) {
            throw e;
        }
    }
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
    runIntegTestCase(options) {
        let assertionResults;
        const actualTestCase = this.actualTestSuite.testSuite[options.testCaseName];
        if (!actualTestCase) {
            throw new Error(`Did not find test case name '${options.testCaseName}' in '${Object.keys(this.actualTestSuite.testSuite)}'`);
        }
        const clean = options.clean ?? true;
        const updateWorkflowEnabled = (options.updateWorkflow ?? true)
            && (actualTestCase.stackUpdateWorkflow ?? true);
        const enableForVerbosityLevel = (needed = 1) => {
            const verbosity = options.verbosity ?? 0;
            return (verbosity >= needed) ? true : undefined;
        };
        try {
            if (!options.dryRun && (actualTestCase.cdkCommandOptions?.deploy?.enabled ?? true)) {
                assertionResults = this.deploy({
                    ...this.defaultArgs,
                    profile: this.profile,
                    requireApproval: cloud_assembly_schema_1.RequireApproval.NEVER,
                    verbose: enableForVerbosityLevel(3),
                    debug: enableForVerbosityLevel(4),
                }, updateWorkflowEnabled, options.testCaseName);
            }
            else {
                const env = {
                    ...runner_base_1.DEFAULT_SYNTH_OPTIONS.env,
                    CDK_CONTEXT_JSON: JSON.stringify(this.getContext({
                        ...this.actualTestSuite.enableLookups ? runner_base_1.DEFAULT_SYNTH_OPTIONS.context : {},
                    })),
                };
                this.cdk.synthFast({
                    execCmd: this.cdkApp.split(' '),
                    env,
                    output: path.relative(this.directory, this.cdkOutDir),
                });
            }
            // only create the snapshot if there are no failed assertion results
            // (i.e. no failures)
            if (!assertionResults || !Object.values(assertionResults).some(result => result.status === 'fail')) {
                this.createSnapshot();
            }
        }
        catch (e) {
            throw e;
        }
        finally {
            if (!options.dryRun) {
                if (clean && (actualTestCase.cdkCommandOptions?.destroy?.enabled ?? true)) {
                    this.destroy(options.testCaseName, {
                        ...this.defaultArgs,
                        profile: this.profile,
                        all: true,
                        force: true,
                        app: this.cdkApp,
                        output: path.relative(this.directory, this.cdkOutDir),
                        ...actualTestCase.cdkCommandOptions?.destroy?.args,
                        context: this.getContext(actualTestCase.cdkCommandOptions?.destroy?.args?.context),
                        verbose: enableForVerbosityLevel(3),
                        debug: enableForVerbosityLevel(4),
                    });
                }
            }
            this.cleanup();
        }
        return assertionResults;
    }
    /**
     * Perform a integ test case stack destruction
     */
    destroy(testCaseName, destroyArgs) {
        const actualTestCase = this.actualTestSuite.testSuite[testCaseName];
        try {
            if (actualTestCase.hooks?.preDestroy) {
                actualTestCase.hooks.preDestroy.forEach(cmd => {
                    (0, utils_1.exec)((0, utils_1.chunks)(cmd), {
                        cwd: path.dirname(this.snapshotDir),
                    });
                });
            }
            this.cdk.destroy({
                ...destroyArgs,
            });
            if (actualTestCase.hooks?.postDestroy) {
                actualTestCase.hooks.postDestroy.forEach(cmd => {
                    (0, utils_1.exec)((0, utils_1.chunks)(cmd), {
                        cwd: path.dirname(this.snapshotDir),
                    });
                });
            }
        }
        catch (e) {
            this.parseError(e, actualTestCase.cdkCommandOptions?.destroy?.expectError ?? false, actualTestCase.cdkCommandOptions?.destroy?.expectedMessage);
        }
    }
    async watch(watchArgs, testCaseName, verbosity) {
        const actualTestCase = this.actualTestSuite.testSuite[testCaseName];
        if (actualTestCase.hooks?.preDeploy) {
            actualTestCase.hooks.preDeploy.forEach(cmd => {
                (0, utils_1.exec)((0, utils_1.chunks)(cmd), {
                    cwd: path.dirname(this.snapshotDir),
                });
            });
        }
        const deployArgs = {
            ...watchArgs,
            lookups: this.actualTestSuite.enableLookups,
            stacks: [
                ...actualTestCase.stacks,
                ...actualTestCase.assertionStack ? [actualTestCase.assertionStack] : [],
            ],
            output: path.relative(this.directory, this.cdkOutDir),
            outputsFile: path.relative(this.directory, path.join(this.cdkOutDir, 'assertion-results.json')),
            ...actualTestCase?.cdkCommandOptions?.deploy?.args,
            context: {
                ...this.getContext(actualTestCase?.cdkCommandOptions?.deploy?.args?.context),
            },
            app: this.cdkApp,
        };
        const destroyMessage = {
            additionalMessages: [
                'After you are done you must manually destroy the deployed stacks',
                `  ${[
                    ...process.env.AWS_REGION ? [`AWS_REGION=${process.env.AWS_REGION}`] : [],
                    'cdk destroy',
                    `-a '${this.cdkApp}'`,
                    deployArgs.stacks.join(' '),
                    `--profile ${deployArgs.profile}`,
                ].join(' ')}`,
            ],
        };
        workerpool.workerEmit(destroyMessage);
        if (watchArgs.verbose) {
            // if `-vvv` (or above) is used then print out the command that was used
            // this allows users to manually run the command
            workerpool.workerEmit({
                additionalMessages: [
                    'Repro:',
                    `  ${[
                        'cdk synth',
                        `-a '${this.cdkApp}'`,
                        `-o '${this.cdkOutDir}'`,
                        ...Object.entries(this.getContext()).flatMap(([k, v]) => typeof v !== 'object' ? [`-c '${k}=${v}'`] : []),
                        deployArgs.stacks.join(' '),
                        `--outputs-file ${deployArgs.outputsFile}`,
                        `--profile ${deployArgs.profile}`,
                        '--hotswap-fallback',
                    ].join(' ')}`,
                ],
            });
        }
        const assertionResults = path.join(this.cdkOutDir, 'assertion-results.json');
        const watcher = chokidar.watch([this.cdkOutDir], {
            cwd: this.directory,
        });
        watcher.on('all', (event, file) => {
            // we only care about changes to the `assertion-results.json` file. If there
            // are assertions then this will change on every deployment
            if (assertionResults.endsWith(file) && (event === 'add' || event === 'change')) {
                const start = Date.now();
                if (actualTestCase.hooks?.postDeploy) {
                    actualTestCase.hooks.postDeploy.forEach(cmd => {
                        (0, utils_1.exec)((0, utils_1.chunks)(cmd), {
                            cwd: path.dirname(this.snapshotDir),
                        });
                    });
                }
                if (actualTestCase.assertionStack && actualTestCase.assertionStackName) {
                    const res = this.processAssertionResults(assertionResults, actualTestCase.assertionStackName, actualTestCase.assertionStack);
                    if (res && Object.values(res).some(r => r.status === 'fail')) {
                        workerpool.workerEmit({
                            reason: common_1.DiagnosticReason.ASSERTION_FAILED,
                            testName: `${testCaseName} (${watchArgs.profile}`,
                            message: (0, common_1.formatAssertionResults)(res),
                            duration: (Date.now() - start) / 1000,
                        });
                    }
                    else {
                        workerpool.workerEmit({
                            reason: common_1.DiagnosticReason.TEST_SUCCESS,
                            testName: `${testCaseName}`,
                            message: res ? (0, common_1.formatAssertionResults)(res) : 'NO ASSERTIONS',
                            duration: (Date.now() - start) / 1000,
                        });
                    }
                    // emit the destroy message after every run
                    // so that it's visible to the user
                    workerpool.workerEmit(destroyMessage);
                }
            }
        });
        await new Promise(resolve => {
            watcher.on('ready', async () => {
                resolve({});
            });
        });
        const child = this.cdk.watch(deployArgs);
        // if `-v` (or above) is passed then stream the logs
        child.stdout?.on('data', (message) => {
            if (verbosity > 0) {
                process.stdout.write(message);
            }
        });
        child.stderr?.on('data', (message) => {
            if (verbosity > 0) {
                process.stderr.write(message);
            }
        });
        await new Promise(resolve => {
            child.on('close', async (code) => {
                if (code !== 0) {
                    throw new Error('Watch exited with error');
                }
                child.stdin?.end();
                await watcher.close();
                resolve(code);
            });
        });
    }
    /**
     * Perform a integ test case deployment, including
     * peforming the update workflow
     */
    deploy(deployArgs, updateWorkflowEnabled, testCaseName) {
        const actualTestCase = this.actualTestSuite.testSuite[testCaseName];
        try {
            if (actualTestCase.hooks?.preDeploy) {
                actualTestCase.hooks.preDeploy.forEach(cmd => {
                    (0, utils_1.exec)((0, utils_1.chunks)(cmd), {
                        cwd: path.dirname(this.snapshotDir),
                    });
                });
            }
            // if the update workflow is not disabled, first
            // perform a deployment with the exising snapshot
            // then perform a deployment (which will be a stack update)
            // with the current integration test
            // We also only want to run the update workflow if there is an existing
            // snapshot (otherwise there is nothing to update)
            if (updateWorkflowEnabled && this.hasSnapshot() &&
                (this.expectedTestSuite && testCaseName in this.expectedTestSuite?.testSuite)) {
                // make sure the snapshot is the latest from 'origin'
                this.checkoutSnapshot();
                const expectedTestCase = this.expectedTestSuite.testSuite[testCaseName];
                this.cdk.deploy({
                    ...deployArgs,
                    stacks: expectedTestCase.stacks,
                    ...expectedTestCase?.cdkCommandOptions?.deploy?.args,
                    context: this.getContext(expectedTestCase?.cdkCommandOptions?.deploy?.args?.context),
                    app: path.relative(this.directory, this.snapshotDir),
                    lookups: this.expectedTestSuite?.enableLookups,
                });
            }
            // now deploy the "actual" test.
            this.cdk.deploy({
                ...deployArgs,
                lookups: this.actualTestSuite.enableLookups,
                stacks: [
                    ...actualTestCase.stacks,
                ],
                output: path.relative(this.directory, this.cdkOutDir),
                ...actualTestCase?.cdkCommandOptions?.deploy?.args,
                context: this.getContext(actualTestCase?.cdkCommandOptions?.deploy?.args?.context),
                app: this.cdkApp,
            });
            // If there are any assertions
            // deploy the assertion stack as well
            // This is separate from the above deployment because we want to
            // set `rollback: false`. This allows the assertion stack to deploy all the
            // assertions instead of failing at the first failed assertion
            // combining it with the above deployment would prevent any replacement updates
            if (actualTestCase.assertionStack) {
                this.cdk.deploy({
                    ...deployArgs,
                    lookups: this.actualTestSuite.enableLookups,
                    stacks: [
                        actualTestCase.assertionStack,
                    ],
                    rollback: false,
                    output: path.relative(this.directory, this.cdkOutDir),
                    ...actualTestCase?.cdkCommandOptions?.deploy?.args,
                    outputsFile: path.relative(this.directory, path.join(this.cdkOutDir, 'assertion-results.json')),
                    context: this.getContext(actualTestCase?.cdkCommandOptions?.deploy?.args?.context),
                    app: this.cdkApp,
                });
            }
            if (actualTestCase.hooks?.postDeploy) {
                actualTestCase.hooks.postDeploy.forEach(cmd => {
                    (0, utils_1.exec)((0, utils_1.chunks)(cmd), {
                        cwd: path.dirname(this.snapshotDir),
                    });
                });
            }
            if (actualTestCase.assertionStack && actualTestCase.assertionStackName) {
                return this.processAssertionResults(path.join(this.cdkOutDir, 'assertion-results.json'), actualTestCase.assertionStackName, actualTestCase.assertionStack);
            }
        }
        catch (e) {
            this.parseError(e, actualTestCase.cdkCommandOptions?.deploy?.expectError ?? false, actualTestCase.cdkCommandOptions?.deploy?.expectedMessage);
        }
        return;
    }
    /**
     * Process the outputsFile which contains the assertions results as stack
     * outputs
     */
    processAssertionResults(file, assertionStackName, assertionStackId) {
        const results = {};
        if (fs.existsSync(file)) {
            try {
                const outputs = fs.readJSONSync(file);
                if (assertionStackName in outputs) {
                    for (const [assertionId, result] of Object.entries(outputs[assertionStackName])) {
                        if (assertionId.startsWith('AssertionResults')) {
                            const assertionResult = JSON.parse(result.replace(/\n/g, '\\n'));
                            if (assertionResult.status === 'fail' || assertionResult.status === 'success') {
                                results[assertionId] = assertionResult;
                            }
                        }
                    }
                }
            }
            catch (e) {
                // if there are outputs, but they cannot be processed, then throw an error
                // so that the test fails
                results[assertionStackId] = {
                    status: 'fail',
                    message: `error processing assertion results: ${e}`,
                };
            }
            finally {
                // remove the outputs file so it is not part of the snapshot
                // it will contain env specific information from values
                // resolved at deploy time
                fs.unlinkSync(file);
            }
        }
        return Object.keys(results).length > 0 ? results : undefined;
    }
    /**
     * Parses an error message returned from a CDK command
     */
    parseError(e, expectError, expectedMessage) {
        if (expectError) {
            if (expectedMessage) {
                const message = e.message;
                if (!message.match(expectedMessage)) {
                    throw (e);
                }
            }
        }
        else {
            throw e;
        }
    }
}
exports.IntegTestRunner = IntegTestRunner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW50ZWctdGVzdC1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbnRlZy10ZXN0LXJ1bm5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2QkFBNkI7QUFFN0IsOERBQThFO0FBQzlFLDBFQUFpRTtBQUNqRSxxQ0FBcUM7QUFDckMsK0JBQStCO0FBQy9CLHlDQUF5QztBQUV6QywrQ0FBbUU7QUFDbkUsb0NBQW9DO0FBQ3BDLG9DQUF3QztBQUV4Qyw4Q0FBNkU7QUEwRDdFOzs7R0FHRztBQUNILE1BQWEsZUFBZ0IsU0FBUSx5QkFBVztJQUM5QyxZQUFZLE9BQTJCLEVBQUUsa0JBQXdDO1FBQy9FLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNmLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxrQkFBa0IsQ0FBQztRQUU5QyxzREFBc0Q7UUFDdEQsMERBQTBEO1FBQzFELDREQUE0RDtRQUM1RCxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUM3QyxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLFFBQVEscURBQXFEO2dCQUNuRix5QkFBeUI7Z0JBQ3pCLGdGQUFnRixDQUNqRixDQUFDO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFTSxvQkFBb0I7UUFDekIsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUM7WUFDeEMsRUFBRSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25ELEtBQUssRUFBRSxFQUFHO2FBQ1gsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwQixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSyxnQkFBZ0I7UUFDdEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFNBQVMs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TSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNaLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLENBQUMsQ0FBQztRQUNWLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFoZ0JELDBDQWdnQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHR5cGUgeyBEZXBsb3lPcHRpb25zLCBEZXN0cm95T3B0aW9ucyB9IGZyb20gJ0Bhd3MtY2RrL2Nkay1jbGktd3JhcHBlcic7XG5pbXBvcnQgeyBIb3Rzd2FwTW9kZSwgU3RhY2tBY3Rpdml0eVByb2dyZXNzIH0gZnJvbSAnQGF3cy1jZGsvY2RrLWNsaS13cmFwcGVyJztcbmltcG9ydCB7IFJlcXVpcmVBcHByb3ZhbCB9IGZyb20gJ0Bhd3MtY2RrL2Nsb3VkLWFzc2VtYmx5LXNjaGVtYSc7XG5pbXBvcnQgKiBhcyBjaG9raWRhciBmcm9tICdjaG9raWRhcic7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcy1leHRyYSc7XG5pbXBvcnQgKiBhcyB3b3JrZXJwb29sIGZyb20gJ3dvcmtlcnBvb2wnO1xuaW1wb3J0IHR5cGUgeyBJbnRlZ1J1bm5lck9wdGlvbnMgfSBmcm9tICcuL3J1bm5lci1iYXNlJztcbmltcG9ydCB7IEludGVnUnVubmVyLCBERUZBVUxUX1NZTlRIX09QVElPTlMgfSBmcm9tICcuL3J1bm5lci1iYXNlJztcbmltcG9ydCAqIGFzIGxvZ2dlciBmcm9tICcuLi9sb2dnZXInO1xuaW1wb3J0IHsgY2h1bmtzLCBleGVjIH0gZnJvbSAnLi4vdXRpbHMnO1xuaW1wb3J0IHR5cGUgeyBEZXN0cnVjdGl2ZUNoYW5nZSwgQXNzZXJ0aW9uUmVzdWx0cywgQXNzZXJ0aW9uUmVzdWx0IH0gZnJvbSAnLi4vd29ya2Vycy9jb21tb24nO1xuaW1wb3J0IHsgRGlhZ25vc3RpY1JlYXNvbiwgZm9ybWF0QXNzZXJ0aW9uUmVzdWx0cyB9IGZyb20gJy4uL3dvcmtlcnMvY29tbW9uJztcblxuZXhwb3J0IGludGVyZmFjZSBDb21tb25PcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSBuYW1lIG9mIHRoZSB0ZXN0IGNhc2VcbiAgICovXG4gIHJlYWRvbmx5IHRlc3RDYXNlTmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgbGV2ZWwgb2YgdmVyYm9zaXR5IGZvciBsb2dnaW5nLlxuICAgKlxuICAgKiBAZGVmYXVsdCAwXG4gICAqL1xuICByZWFkb25seSB2ZXJib3NpdHk/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2F0Y2hPcHRpb25zIGV4dGVuZHMgQ29tbW9uT3B0aW9ucyB7XG5cbn1cblxuLyoqXG4gKiBPcHRpb25zIGZvciB0aGUgaW50ZWdyYXRpb24gdGVzdCBydW5uZXJcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSdW5PcHRpb25zIGV4dGVuZHMgQ29tbW9uT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBXaGV0aGVyIG9yIG5vdCB0byBydW4gYGNkayBkZXN0cm95YCBhbmQgY2xlYW51cCB0aGVcbiAgICogaW50ZWdyYXRpb24gdGVzdCBzdGFja3MuXG4gICAqXG4gICAqIFNldCB0aGlzIHRvIGZhbHNlIGlmIHlvdSBuZWVkIHRvIHBlcmZvcm0gYW55IHZhbGlkYXRpb25cbiAgICogb3IgdHJvdWJsZXNob290aW5nIGFmdGVyIGRlcGxveW1lbnQuXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IGNsZWFuPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogSWYgc2V0IHRvIHRydWUsIHRoZSBpbnRlZ3JhdGlvbiB0ZXN0IHdpbGwgbm90IGRlcGxveVxuICAgKiBhbnl0aGluZyBhbmQgd2lsbCBzaW1wbHkgdXBkYXRlIHRoZSBzbmFwc2hvdC5cbiAgICpcbiAgICogWW91IHNob3VsZCBOT1QgdXNlIHRoaXMgbWV0aG9kIHNpbmNlIHlvdSBhcmUgZXNzZW50aWFsbHlcbiAgICogYnlwYXNzaW5nIHRoZSBpbnRlZ3JhdGlvbiB0ZXN0LlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgZHJ5UnVuPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogSWYgdGhpcyBpcyBzZXQgdG8gZmFsc2UgdGhlbiB0aGUgc3RhY2sgdXBkYXRlIHdvcmtmbG93IHdpbGxcbiAgICogbm90IGJlIHJ1blxuICAgKlxuICAgKiBUaGUgdXBkYXRlIHdvcmtmbG93IGV4aXN0cyB0byBjaGVjayBmb3IgY2FzZXMgd2hlcmUgYSBjaGFuZ2Ugd291bGQgY2F1c2VcbiAgICogYSBmYWlsdXJlIHRvIGFuIGV4aXN0aW5nIHN0YWNrLCBidXQgbm90IGZvciBhIG5ld2x5IGNyZWF0ZWQgc3RhY2suXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IHVwZGF0ZVdvcmtmbG93PzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBBbiBpbnRlZ3JhdGlvbiB0ZXN0IHJ1bm5lciB0aGF0IG9yY2hlc3RyYXRlcyBleGVjdXRpbmdcbiAqIGludGVncmF0aW9uIHRlc3RzXG4gKi9cbmV4cG9ydCBjbGFzcyBJbnRlZ1Rlc3RSdW5uZXIgZXh0ZW5kcyBJbnRlZ1J1bm5lciB7XG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEludGVnUnVubmVyT3B0aW9ucywgZGVzdHJ1Y3RpdmVDaGFuZ2VzPzogRGVzdHJ1Y3RpdmVDaGFuZ2VbXSkge1xuICAgIHN1cGVyKG9wdGlvbnMpO1xuICAgIHRoaXMuX2Rlc3RydWN0aXZlQ2hhbmdlcyA9IGRlc3RydWN0aXZlQ2hhbmdlcztcblxuICAgIC8vIFdlIGRvbid0IHdhbnQgbmV3IHRlc3RzIHdyaXR0ZW4gaW4gdGhlIGxlZ2FjeSBtb2RlLlxuICAgIC8vIElmIHRoZXJlIGlzIG5vIGV4aXN0aW5nIHNuYXBzaG90IF9hbmRfIHRoaXMgaXMgYSBsZWdhY3lcbiAgICAvLyB0ZXN0IHRoZW4gcG9pbnQgdGhlIHVzZXIgdG8gdGhlIG5ldyBgSW50ZWdUZXN0YCBjb25zdHJ1Y3RcbiAgICBpZiAoIXRoaXMuaGFzU25hcHNob3QoKSAmJiB0aGlzLmlzTGVnYWN5VGVzdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMudGVzdE5hbWV9IGlzIGEgbmV3IHRlc3QuIFBsZWFzZSB1c2UgdGhlIEludGVnVGVzdCBjb25zdHJ1Y3QgYCArXG4gICAgICAgICd0byBjb25maWd1cmUgdGhlIHRlc3RcXG4nICtcbiAgICAgICAgJ2h0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay90cmVlL21haW4vcGFja2FnZXMvJTQwYXdzLWNkay9pbnRlZy10ZXN0cy1hbHBoYScsXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBjcmVhdGVDZGtDb250ZXh0SnNvbigpOiB2b2lkIHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmModGhpcy5jZGtDb250ZXh0UGF0aCkpIHtcbiAgICAgIGZzLndyaXRlRmlsZVN5bmModGhpcy5jZGtDb250ZXh0UGF0aCwgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICB3YXRjaDogeyB9LFxuICAgICAgfSwgdW5kZWZpbmVkLCAyKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZW4gcnVubmluZyBpbnRlZ3JhdGlvbiB0ZXN0cyB3aXRoIHRoZSB1cGRhdGUgcGF0aCB3b3JrZmxvd1xuICAgKiBpdCBpcyBpbXBvcnRhbnQgdGhhdCB0aGUgc25hcHNob3QgdGhhdCBpcyBkZXBsb3llZCBpcyB0aGUgY3VycmVudCBzbmFwc2hvdFxuICAgKiBmcm9tIHRoZSB1cHN0cmVhbSBicmFuY2guIEluIG9yZGVyIHRvIGd1YXJhbnRlZSB0aGF0LCBmaXJzdCBjaGVja291dCB0aGUgbGF0ZXN0XG4gICAqICh0byB0aGUgdXNlcikgc25hcHNob3QgZnJvbSB1cHN0cmVhbVxuICAgKlxuICAgKiBJdCBpcyBub3Qgc3RyYWlnaHRmb3J3YXJkIHRvIGZpZ3VyZSBvdXQgd2hhdCBicmFuY2ggdGhlIGN1cnJlbnRcbiAgICogd29ya2luZyBicmFuY2ggd2FzIGNyZWF0ZWQgZnJvbS4gVGhpcyBpcyBhIGJlc3QgZWZmb3J0IGF0dGVtcHQgdG8gZG8gc28uXG4gICAqIFRoaXMgYXNzdW1lcyB0aGF0IHRoZXJlIGlzIGFuICdvcmlnaW4nLiBgZ2l0IHJlbW90ZSBzaG93IG9yaWdpbmAgcmV0dXJucyBhIGxpc3Qgb2ZcbiAgICogYWxsIGJyYW5jaGVzIGFuZCB3ZSB0aGVuIHNlYXJjaCBmb3Igb25lIHRoYXQgc3RhcnRzIHdpdGggYEhFQUQgYnJhbmNoOiBgXG4gICAqL1xuICBwcml2YXRlIGNoZWNrb3V0U25hcHNob3QoKTogdm9pZCB7XG4gICAgY29uc3QgY3dkID0gdGhpcy5kaXJlY3Rvcnk7XG5cbiAgICAvLyBodHRwczovL2dpdC1zY20uY29tL2RvY3MvZ2l0LW1lcmdlLWJhc2VcbiAgICBsZXQgYmFzZUJyYW5jaDogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgIC8vIHRyeSB0byBmaW5kIHRoZSBiYXNlIGJyYW5jaCB0aGF0IHRoZSB3b3JraW5nIGJyYW5jaCB3YXMgY3JlYXRlZCBmcm9tXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG9yaWdpbjogc3RyaW5nID0gZXhlYyhbJ2dpdCcsICdyZW1vdGUnLCAnc2hvdycsICdvcmlnaW4nXSwge1xuICAgICAgICBjd2QsXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IG9yaWdpbkxpbmVzID0gb3JpZ2luLnNwbGl0KCdcXG4nKTtcbiAgICAgIGZvciAoY29uc3QgbGluZSBvZiBvcmlnaW5MaW5lcykge1xuICAgICAgICBpZiAobGluZS50cmltKCkuc3RhcnRzV2l0aCgnSEVBRCBicmFuY2g6ICcpKSB7XG4gICAgICAgICAgYmFzZUJyYW5jaCA9IGxpbmUudHJpbSgpLnNwbGl0KCdIRUFEIGJyYW5jaDogJylbMV07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBsb2dnZXIud2FybmluZygnJXNcXG4lcycsXG4gICAgICAgICdDb3VsZCBub3QgZGV0ZXJtaW5lIGdpdCBvcmlnaW4gYnJhbmNoLicsXG4gICAgICAgIGBZb3UgbmVlZCB0byBtYW51YWxseSBjaGVja291dCB0aGUgc25hcHNob3QgZGlyZWN0b3J5ICR7dGhpcy5zbmFwc2hvdERpcn1gICtcbiAgICAgICAgJ2Zyb20gdGhlIG1lcmdlLWJhc2UgKGh0dHBzOi8vZ2l0LXNjbS5jb20vZG9jcy9naXQtbWVyZ2UtYmFzZSknLFxuICAgICAgKTtcbiAgICAgIGxvZ2dlci53YXJuaW5nKCdlcnJvcjogJXMnLCBlKTtcbiAgICB9XG5cbiAgICAvLyBpZiB3ZSBmb3VuZCB0aGUgYmFzZSBicmFuY2ggdGhlbiBnZXQgdGhlIG1lcmdlLWJhc2UgKG1vc3QgcmVjZW50IGNvbW1vbiBjb21taXQpXG4gICAgLy8gYW5kIGNoZWNrb3V0IHRoZSBzbmFwc2hvdCB1c2luZyB0aGF0IGNvbW1pdFxuICAgIGlmIChiYXNlQnJhbmNoKSB7XG4gICAgICBjb25zdCByZWxhdGl2ZVNuYXBzaG90RGlyID0gcGF0aC5yZWxhdGl2ZSh0aGlzLmRpcmVjdG9yeSwgdGhpcy5zbmFwc2hvdERpcik7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJhc2UgPSBleGVjKFsnZ2l0JywgJ21lcmdlLWJhc2UnLCAnSEVBRCcsIGJhc2VCcmFuY2hdLCB7XG4gICAgICAgICAgY3dkLFxuICAgICAgICB9KTtcbiAgICAgICAgZXhlYyhbJ2dpdCcsICdjaGVja291dCcsIGJhc2UsICctLScsIHJlbGF0aXZlU25hcHNob3REaXJdLCB7XG4gICAgICAgICAgY3dkLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbG9nZ2VyLndhcm5pbmcoJyVzXFxuJXMnLFxuICAgICAgICAgIGBDb3VsZCBub3QgY2hlY2tvdXQgc25hcHNob3QgZGlyZWN0b3J5ICcke3RoaXMuc25hcHNob3REaXJ9Jy4gUGxlYXNlIHZlcmlmeSB0aGUgZm9sbG93aW5nIGNvbW1hbmQgY29tcGxldGVzIGNvcnJlY3RseTpgLFxuICAgICAgICAgIGBnaXQgY2hlY2tvdXQgJChnaXQgbWVyZ2UtYmFzZSBIRUFEICR7YmFzZUJyYW5jaH0pIC0tICR7cmVsYXRpdmVTbmFwc2hvdERpcn1gLFxuICAgICAgICAgICcnLFxuICAgICAgICApO1xuICAgICAgICBsb2dnZXIud2FybmluZygnZXJyb3I6ICVzJywgZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY2RrIGRlcGxveSAtLXdhdGNoIGZvciBhbiBpbnRlZ3JhdGlvbiB0ZXN0XG4gICAqXG4gICAqIFRoaXMgaXMgbWVhbnQgdG8gYmUgcnVuIG9uIGEgc2luZ2xlIHRlc3QgYW5kIHdpbGwgbm90IGNyZWF0ZSBhIHNuYXBzaG90XG4gICAqL1xuICBwdWJsaWMgYXN5bmMgd2F0Y2hJbnRlZ1Rlc3Qob3B0aW9uczogV2F0Y2hPcHRpb25zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYWN0dWFsVGVzdENhc2UgPSB0aGlzLmFjdHVhbFRlc3RTdWl0ZS50ZXN0U3VpdGVbb3B0aW9ucy50ZXN0Q2FzZU5hbWVdO1xuICAgIGlmICghYWN0dWFsVGVzdENhc2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRGlkIG5vdCBmaW5kIHRlc3QgY2FzZSBuYW1lICcke29wdGlvbnMudGVzdENhc2VOYW1lfScgaW4gJyR7T2JqZWN0LmtleXModGhpcy5hY3R1YWxUZXN0U3VpdGUudGVzdFN1aXRlKX0nYCk7XG4gICAgfVxuICAgIGNvbnN0IGVuYWJsZUZvclZlcmJvc2l0eUxldmVsID0gKG5lZWRlZCA9IDEpID0+IHtcbiAgICAgIGNvbnN0IHZlcmJvc2l0eSA9IG9wdGlvbnMudmVyYm9zaXR5ID8/IDA7XG4gICAgICByZXR1cm4gKHZlcmJvc2l0eSA+PSBuZWVkZWQpID8gdHJ1ZSA6IHVuZGVmaW5lZDtcbiAgICB9O1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLndhdGNoKFxuICAgICAgICB7XG4gICAgICAgICAgLi4udGhpcy5kZWZhdWx0QXJncyxcbiAgICAgICAgICBwcm9ncmVzczogU3RhY2tBY3Rpdml0eVByb2dyZXNzLkJBUixcbiAgICAgICAgICBob3Rzd2FwOiBIb3Rzd2FwTW9kZS5GQUxMX0JBQ0ssXG4gICAgICAgICAgZGVwbG95bWVudE1ldGhvZDogJ2RpcmVjdCcsXG4gICAgICAgICAgcHJvZmlsZTogdGhpcy5wcm9maWxlLFxuICAgICAgICAgIHJlcXVpcmVBcHByb3ZhbDogUmVxdWlyZUFwcHJvdmFsLk5FVkVSLFxuICAgICAgICAgIHRyYWNlTG9nczogZW5hYmxlRm9yVmVyYm9zaXR5TGV2ZWwoMikgPz8gZmFsc2UsXG4gICAgICAgICAgdmVyYm9zZTogZW5hYmxlRm9yVmVyYm9zaXR5TGV2ZWwoMyksXG4gICAgICAgICAgZGVidWc6IGVuYWJsZUZvclZlcmJvc2l0eUxldmVsKDQpLFxuICAgICAgICAgIHdhdGNoOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBvcHRpb25zLnRlc3RDYXNlTmFtZSxcbiAgICAgICAgb3B0aW9ucy52ZXJib3NpdHkgPz8gMCxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogT3JjaGVzdHJhdGVzIHJ1bm5pbmcgaW50ZWdyYXRpb24gdGVzdHMuIEN1cnJlbnRseSB0aGlzIGluY2x1ZGVzXG4gICAqXG4gICAqIDEuIChpZiB1cGRhdGUgd29ya2Zsb3cgaXMgZW5hYmxlZCkgRGVwbG95aW5nIHRoZSBzbmFwc2hvdCB0ZXN0IHN0YWNrc1xuICAgKiAyLiBEZXBsb3lpbmcgdGhlIGludGVncmF0aW9uIHRlc3Qgc3RhY2tzXG4gICAqIDIuIFNhdmluZyB0aGUgc25hcHNob3QgKGlmIHN1Y2Nlc3NmdWwpXG4gICAqIDMuIERlc3Ryb3lpbmcgdGhlIGludGVncmF0aW9uIHRlc3Qgc3RhY2tzIChpZiBjbGVhbj1mYWxzZSlcbiAgICpcbiAgICogVGhlIHVwZGF0ZSB3b3JrZmxvdyBleGlzdHMgdG8gY2hlY2sgZm9yIGNhc2VzIHdoZXJlIGEgY2hhbmdlIHdvdWxkIGNhdXNlXG4gICAqIGEgZmFpbHVyZSB0byBhbiBleGlzdGluZyBzdGFjaywgYnV0IG5vdCBmb3IgYSBuZXdseSBjcmVhdGVkIHN0YWNrLlxuICAgKi9cbiAgcHVibGljIHJ1bkludGVnVGVzdENhc2Uob3B0aW9uczogUnVuT3B0aW9ucyk6IEFzc2VydGlvblJlc3VsdHMgfCB1bmRlZmluZWQge1xuICAgIGxldCBhc3NlcnRpb25SZXN1bHRzOiBBc3NlcnRpb25SZXN1bHRzIHwgdW5kZWZpbmVkO1xuICAgIGNvbnN0IGFjdHVhbFRlc3RDYXNlID0gdGhpcy5hY3R1YWxUZXN0U3VpdGUudGVzdFN1aXRlW29wdGlvbnMudGVzdENhc2VOYW1lXTtcbiAgICBpZiAoIWFjdHVhbFRlc3RDYXNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYERpZCBub3QgZmluZCB0ZXN0IGNhc2UgbmFtZSAnJHtvcHRpb25zLnRlc3RDYXNlTmFtZX0nIGluICcke09iamVjdC5rZXlzKHRoaXMuYWN0dWFsVGVzdFN1aXRlLnRlc3RTdWl0ZSl9J2ApO1xuICAgIH1cbiAgICBjb25zdCBjbGVhbiA9IG9wdGlvbnMuY2xlYW4gPz8gdHJ1ZTtcbiAgICBjb25zdCB1cGRhdGVXb3JrZmxvd0VuYWJsZWQgPSAob3B0aW9ucy51cGRhdGVXb3JrZmxvdyA/PyB0cnVlKVxuICAgICAgJiYgKGFjdHVhbFRlc3RDYXNlLnN0YWNrVXBkYXRlV29ya2Zsb3cgPz8gdHJ1ZSk7XG4gICAgY29uc3QgZW5hYmxlRm9yVmVyYm9zaXR5TGV2ZWwgPSAobmVlZGVkID0gMSkgPT4ge1xuICAgICAgY29uc3QgdmVyYm9zaXR5ID0gb3B0aW9ucy52ZXJib3NpdHkgPz8gMDtcbiAgICAgIHJldHVybiAodmVyYm9zaXR5ID49IG5lZWRlZCkgPyB0cnVlIDogdW5kZWZpbmVkO1xuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgaWYgKCFvcHRpb25zLmRyeVJ1biAmJiAoYWN0dWFsVGVzdENhc2UuY2RrQ29tbWFuZE9wdGlvbnM/LmRlcGxveT8uZW5hYmxlZCA/PyB0cnVlKSkge1xuICAgICAgICBhc3NlcnRpb25SZXN1bHRzID0gdGhpcy5kZXBsb3koXG4gICAgICAgICAge1xuICAgICAgICAgICAgLi4udGhpcy5kZWZhdWx0QXJncyxcbiAgICAgICAgICAgIHByb2ZpbGU6IHRoaXMucHJvZmlsZSxcbiAgICAgICAgICAgIHJlcXVpcmVBcHByb3ZhbDogUmVxdWlyZUFwcHJvdmFsLk5FVkVSLFxuICAgICAgICAgICAgdmVyYm9zZTogZW5hYmxlRm9yVmVyYm9zaXR5TGV2ZWwoMyksXG4gICAgICAgICAgICBkZWJ1ZzogZW5hYmxlRm9yVmVyYm9zaXR5TGV2ZWwoNCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICB1cGRhdGVXb3JrZmxvd0VuYWJsZWQsXG4gICAgICAgICAgb3B0aW9ucy50ZXN0Q2FzZU5hbWUsXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBlbnY6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAgICAgLi4uREVGQVVMVF9TWU5USF9PUFRJT05TLmVudixcbiAgICAgICAgICBDREtfQ09OVEVYVF9KU09OOiBKU09OLnN0cmluZ2lmeSh0aGlzLmdldENvbnRleHQoe1xuICAgICAgICAgICAgLi4udGhpcy5hY3R1YWxUZXN0U3VpdGUuZW5hYmxlTG9va3VwcyA/IERFRkFVTFRfU1lOVEhfT1BUSU9OUy5jb250ZXh0IDoge30sXG4gICAgICAgICAgfSkpLFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLmNkay5zeW50aEZhc3Qoe1xuICAgICAgICAgIGV4ZWNDbWQ6IHRoaXMuY2RrQXBwLnNwbGl0KCcgJyksXG4gICAgICAgICAgZW52LFxuICAgICAgICAgIG91dHB1dDogcGF0aC5yZWxhdGl2ZSh0aGlzLmRpcmVjdG9yeSwgdGhpcy5jZGtPdXREaXIpLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIC8vIG9ubHkgY3JlYXRlIHRoZSBzbmFwc2hvdCBpZiB0aGVyZSBhcmUgbm8gZmFpbGVkIGFzc2VydGlvbiByZXN1bHRzXG4gICAgICAvLyAoaS5lLiBubyBmYWlsdXJlcylcbiAgICAgIGlmICghYXNzZXJ0aW9uUmVzdWx0cyB8fCAhT2JqZWN0LnZhbHVlcyhhc3NlcnRpb25SZXN1bHRzKS5zb21lKHJlc3VsdCA9PiByZXN1bHQuc3RhdHVzID09PSAnZmFpbCcpKSB7XG4gICAgICAgIHRoaXMuY3JlYXRlU25hcHNob3QoKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBpZiAoIW9wdGlvbnMuZHJ5UnVuKSB7XG4gICAgICAgIGlmIChjbGVhbiAmJiAoYWN0dWFsVGVzdENhc2UuY2RrQ29tbWFuZE9wdGlvbnM/LmRlc3Ryb3k/LmVuYWJsZWQgPz8gdHJ1ZSkpIHtcbiAgICAgICAgICB0aGlzLmRlc3Ryb3kob3B0aW9ucy50ZXN0Q2FzZU5hbWUsIHtcbiAgICAgICAgICAgIC4uLnRoaXMuZGVmYXVsdEFyZ3MsXG4gICAgICAgICAgICBwcm9maWxlOiB0aGlzLnByb2ZpbGUsXG4gICAgICAgICAgICBhbGw6IHRydWUsXG4gICAgICAgICAgICBmb3JjZTogdHJ1ZSxcbiAgICAgICAgICAgIGFwcDogdGhpcy5jZGtBcHAsXG4gICAgICAgICAgICBvdXRwdXQ6IHBhdGgucmVsYXRpdmUodGhpcy5kaXJlY3RvcnksIHRoaXMuY2RrT3V0RGlyKSxcbiAgICAgICAgICAgIC4uLmFjdHVhbFRlc3RDYXNlLmNka0NvbW1hbmRPcHRpb25zPy5kZXN0cm95Py5hcmdzLFxuICAgICAgICAgICAgY29udGV4dDogdGhpcy5nZXRDb250ZXh0KGFjdHVhbFRlc3RDYXNlLmNka0NvbW1hbmRPcHRpb25zPy5kZXN0cm95Py5hcmdzPy5jb250ZXh0KSxcbiAgICAgICAgICAgIHZlcmJvc2U6IGVuYWJsZUZvclZlcmJvc2l0eUxldmVsKDMpLFxuICAgICAgICAgICAgZGVidWc6IGVuYWJsZUZvclZlcmJvc2l0eUxldmVsKDQpLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLmNsZWFudXAoKTtcbiAgICB9XG4gICAgcmV0dXJuIGFzc2VydGlvblJlc3VsdHM7XG4gIH1cblxuICAvKipcbiAgICogUGVyZm9ybSBhIGludGVnIHRlc3QgY2FzZSBzdGFjayBkZXN0cnVjdGlvblxuICAgKi9cbiAgcHJpdmF0ZSBkZXN0cm95KHRlc3RDYXNlTmFtZTogc3RyaW5nLCBkZXN0cm95QXJnczogRGVzdHJveU9wdGlvbnMpIHtcbiAgICBjb25zdCBhY3R1YWxUZXN0Q2FzZSA9IHRoaXMuYWN0dWFsVGVzdFN1aXRlLnRlc3RTdWl0ZVt0ZXN0Q2FzZU5hbWVdO1xuICAgIHRyeSB7XG4gICAgICBpZiAoYWN0dWFsVGVzdENhc2UuaG9va3M/LnByZURlc3Ryb3kpIHtcbiAgICAgICAgYWN0dWFsVGVzdENhc2UuaG9va3MucHJlRGVzdHJveS5mb3JFYWNoKGNtZCA9PiB7XG4gICAgICAgICAgZXhlYyhjaHVua3MoY21kKSwge1xuICAgICAgICAgICAgY3dkOiBwYXRoLmRpcm5hbWUodGhpcy5zbmFwc2hvdERpciksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgdGhpcy5jZGsuZGVzdHJveSh7XG4gICAgICAgIC4uLmRlc3Ryb3lBcmdzLFxuICAgICAgfSk7XG5cbiAgICAgIGlmIChhY3R1YWxUZXN0Q2FzZS5ob29rcz8ucG9zdERlc3Ryb3kpIHtcbiAgICAgICAgYWN0dWFsVGVzdENhc2UuaG9va3MucG9zdERlc3Ryb3kuZm9yRWFjaChjbWQgPT4ge1xuICAgICAgICAgIGV4ZWMoY2h1bmtzKGNtZCksIHtcbiAgICAgICAgICAgIGN3ZDogcGF0aC5kaXJuYW1lKHRoaXMuc25hcHNob3REaXIpLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aGlzLnBhcnNlRXJyb3IoZSxcbiAgICAgICAgYWN0dWFsVGVzdENhc2UuY2RrQ29tbWFuZE9wdGlvbnM/LmRlc3Ryb3k/LmV4cGVjdEVycm9yID8/IGZhbHNlLFxuICAgICAgICBhY3R1YWxUZXN0Q2FzZS5jZGtDb21tYW5kT3B0aW9ucz8uZGVzdHJveT8uZXhwZWN0ZWRNZXNzYWdlLFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdhdGNoKHdhdGNoQXJnczogRGVwbG95T3B0aW9ucywgdGVzdENhc2VOYW1lOiBzdHJpbmcsIHZlcmJvc2l0eTogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYWN0dWFsVGVzdENhc2UgPSB0aGlzLmFjdHVhbFRlc3RTdWl0ZS50ZXN0U3VpdGVbdGVzdENhc2VOYW1lXTtcbiAgICBpZiAoYWN0dWFsVGVzdENhc2UuaG9va3M/LnByZURlcGxveSkge1xuICAgICAgYWN0dWFsVGVzdENhc2UuaG9va3MucHJlRGVwbG95LmZvckVhY2goY21kID0+IHtcbiAgICAgICAgZXhlYyhjaHVua3MoY21kKSwge1xuICAgICAgICAgIGN3ZDogcGF0aC5kaXJuYW1lKHRoaXMuc25hcHNob3REaXIpLFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBkZXBsb3lBcmdzID0ge1xuICAgICAgLi4ud2F0Y2hBcmdzLFxuICAgICAgbG9va3VwczogdGhpcy5hY3R1YWxUZXN0U3VpdGUuZW5hYmxlTG9va3VwcyxcbiAgICAgIHN0YWNrczogW1xuICAgICAgICAuLi5hY3R1YWxUZXN0Q2FzZS5zdGFja3MsXG4gICAgICAgIC4uLmFjdHVhbFRlc3RDYXNlLmFzc2VydGlvblN0YWNrID8gW2FjdHVhbFRlc3RDYXNlLmFzc2VydGlvblN0YWNrXSA6IFtdLFxuICAgICAgXSxcbiAgICAgIG91dHB1dDogcGF0aC5yZWxhdGl2ZSh0aGlzLmRpcmVjdG9yeSwgdGhpcy5jZGtPdXREaXIpLFxuICAgICAgb3V0cHV0c0ZpbGU6IHBhdGgucmVsYXRpdmUodGhpcy5kaXJlY3RvcnksIHBhdGguam9pbih0aGlzLmNka091dERpciwgJ2Fzc2VydGlvbi1yZXN1bHRzLmpzb24nKSksXG4gICAgICAuLi5hY3R1YWxUZXN0Q2FzZT8uY2RrQ29tbWFuZE9wdGlvbnM/LmRlcGxveT8uYXJncyxcbiAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgLi4udGhpcy5nZXRDb250ZXh0KGFjdHVhbFRlc3RDYXNlPy5jZGtDb21tYW5kT3B0aW9ucz8uZGVwbG95Py5hcmdzPy5jb250ZXh0KSxcbiAgICAgIH0sXG4gICAgICBhcHA6IHRoaXMuY2RrQXBwLFxuICAgIH07XG4gICAgY29uc3QgZGVzdHJveU1lc3NhZ2UgPSB7XG4gICAgICBhZGRpdGlvbmFsTWVzc2FnZXM6IFtcbiAgICAgICAgJ0FmdGVyIHlvdSBhcmUgZG9uZSB5b3UgbXVzdCBtYW51YWxseSBkZXN0cm95IHRoZSBkZXBsb3llZCBzdGFja3MnLFxuICAgICAgICBgICAke1tcbiAgICAgICAgICAuLi5wcm9jZXNzLmVudi5BV1NfUkVHSU9OID8gW2BBV1NfUkVHSU9OPSR7cHJvY2Vzcy5lbnYuQVdTX1JFR0lPTn1gXSA6IFtdLFxuICAgICAgICAgICdjZGsgZGVzdHJveScsXG4gICAgICAgICAgYC1hICcke3RoaXMuY2RrQXBwfSdgLFxuICAgICAgICAgIGRlcGxveUFyZ3Muc3RhY2tzLmpvaW4oJyAnKSxcbiAgICAgICAgICBgLS1wcm9maWxlICR7ZGVwbG95QXJncy5wcm9maWxlfWAsXG4gICAgICAgIF0uam9pbignICcpfWAsXG4gICAgICBdLFxuICAgIH07XG4gICAgd29ya2VycG9vbC53b3JrZXJFbWl0KGRlc3Ryb3lNZXNzYWdlKTtcbiAgICBpZiAod2F0Y2hBcmdzLnZlcmJvc2UpIHtcbiAgICAgIC8vIGlmIGAtdnZ2YCAob3IgYWJvdmUpIGlzIHVzZWQgdGhlbiBwcmludCBvdXQgdGhlIGNvbW1hbmQgdGhhdCB3YXMgdXNlZFxuICAgICAgLy8gdGhpcyBhbGxvd3MgdXNlcnMgdG8gbWFudWFsbHkgcnVuIHRoZSBjb21tYW5kXG4gICAgICB3b3JrZXJwb29sLndvcmtlckVtaXQoe1xuICAgICAgICBhZGRpdGlvbmFsTWVzc2FnZXM6IFtcbiAgICAgICAgICAnUmVwcm86JyxcbiAgICAgICAgICBgICAke1tcbiAgICAgICAgICAgICdjZGsgc3ludGgnLFxuICAgICAgICAgICAgYC1hICcke3RoaXMuY2RrQXBwfSdgLFxuICAgICAgICAgICAgYC1vICcke3RoaXMuY2RrT3V0RGlyfSdgLFxuICAgICAgICAgICAgLi4uT2JqZWN0LmVudHJpZXModGhpcy5nZXRDb250ZXh0KCkpLmZsYXRNYXAoKFtrLCB2XSkgPT4gdHlwZW9mIHYgIT09ICdvYmplY3QnID8gW2AtYyAnJHtrfT0ke3Z9J2BdIDogW10pLFxuICAgICAgICAgICAgZGVwbG95QXJncy5zdGFja3Muam9pbignICcpLFxuICAgICAgICAgICAgYC0tb3V0cHV0cy1maWxlICR7ZGVwbG95QXJncy5vdXRwdXRzRmlsZX1gLFxuICAgICAgICAgICAgYC0tcHJvZmlsZSAke2RlcGxveUFyZ3MucHJvZmlsZX1gLFxuICAgICAgICAgICAgJy0taG90c3dhcC1mYWxsYmFjaycsXG4gICAgICAgICAgXS5qb2luKCcgJyl9YCxcbiAgICAgICAgXSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGFzc2VydGlvblJlc3VsdHMgPSBwYXRoLmpvaW4odGhpcy5jZGtPdXREaXIsICdhc3NlcnRpb24tcmVzdWx0cy5qc29uJyk7XG4gICAgY29uc3Qgd2F0Y2hlciA9IGNob2tpZGFyLndhdGNoKFt0aGlzLmNka091dERpcl0sIHtcbiAgICAgIGN3ZDogdGhpcy5kaXJlY3RvcnksXG4gICAgfSk7XG4gICAgd2F0Y2hlci5vbignYWxsJywgKGV2ZW50OiAnYWRkJyB8ICdjaGFuZ2UnLCBmaWxlOiBzdHJpbmcpID0+IHtcbiAgICAgIC8vIHdlIG9ubHkgY2FyZSBhYm91dCBjaGFuZ2VzIHRvIHRoZSBgYXNzZXJ0aW9uLXJlc3VsdHMuanNvbmAgZmlsZS4gSWYgdGhlcmVcbiAgICAgIC8vIGFyZSBhc3NlcnRpb25zIHRoZW4gdGhpcyB3aWxsIGNoYW5nZSBvbiBldmVyeSBkZXBsb3ltZW50XG4gICAgICBpZiAoYXNzZXJ0aW9uUmVzdWx0cy5lbmRzV2l0aChmaWxlKSAmJiAoZXZlbnQgPT09ICdhZGQnIHx8IGV2ZW50ID09PSAnY2hhbmdlJykpIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICAgICAgICBpZiAoYWN0dWFsVGVzdENhc2UuaG9va3M/LnBvc3REZXBsb3kpIHtcbiAgICAgICAgICBhY3R1YWxUZXN0Q2FzZS5ob29rcy5wb3N0RGVwbG95LmZvckVhY2goY21kID0+IHtcbiAgICAgICAgICAgIGV4ZWMoY2h1bmtzKGNtZCksIHtcbiAgICAgICAgICAgICAgY3dkOiBwYXRoLmRpcm5hbWUodGhpcy5zbmFwc2hvdERpciksXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChhY3R1YWxUZXN0Q2FzZS5hc3NlcnRpb25TdGFjayAmJiBhY3R1YWxUZXN0Q2FzZS5hc3NlcnRpb25TdGFja05hbWUpIHtcbiAgICAgICAgICBjb25zdCByZXMgPSB0aGlzLnByb2Nlc3NBc3NlcnRpb25SZXN1bHRzKFxuICAgICAgICAgICAgYXNzZXJ0aW9uUmVzdWx0cyxcbiAgICAgICAgICAgIGFjdHVhbFRlc3RDYXNlLmFzc2VydGlvblN0YWNrTmFtZSxcbiAgICAgICAgICAgIGFjdHVhbFRlc3RDYXNlLmFzc2VydGlvblN0YWNrLFxuICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKHJlcyAmJiBPYmplY3QudmFsdWVzKHJlcykuc29tZShyID0+IHIuc3RhdHVzID09PSAnZmFpbCcpKSB7XG4gICAgICAgICAgICB3b3JrZXJwb29sLndvcmtlckVtaXQoe1xuICAgICAgICAgICAgICByZWFzb246IERpYWdub3N0aWNSZWFzb24uQVNTRVJUSU9OX0ZBSUxFRCxcbiAgICAgICAgICAgICAgdGVzdE5hbWU6IGAke3Rlc3RDYXNlTmFtZX0gKCR7d2F0Y2hBcmdzLnByb2ZpbGV9YCxcbiAgICAgICAgICAgICAgbWVzc2FnZTogZm9ybWF0QXNzZXJ0aW9uUmVzdWx0cyhyZXMpLFxuICAgICAgICAgICAgICBkdXJhdGlvbjogKERhdGUubm93KCkgLSBzdGFydCkgLyAxMDAwLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHdvcmtlcnBvb2wud29ya2VyRW1pdCh7XG4gICAgICAgICAgICAgIHJlYXNvbjogRGlhZ25vc3RpY1JlYXNvbi5URVNUX1NVQ0NFU1MsXG4gICAgICAgICAgICAgIHRlc3ROYW1lOiBgJHt0ZXN0Q2FzZU5hbWV9YCxcbiAgICAgICAgICAgICAgbWVzc2FnZTogcmVzID8gZm9ybWF0QXNzZXJ0aW9uUmVzdWx0cyhyZXMpIDogJ05PIEFTU0VSVElPTlMnLFxuICAgICAgICAgICAgICBkdXJhdGlvbjogKERhdGUubm93KCkgLSBzdGFydCkgLyAxMDAwLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIGVtaXQgdGhlIGRlc3Ryb3kgbWVzc2FnZSBhZnRlciBldmVyeSBydW5cbiAgICAgICAgICAvLyBzbyB0aGF0IGl0J3MgdmlzaWJsZSB0byB0aGUgdXNlclxuICAgICAgICAgIHdvcmtlcnBvb2wud29ya2VyRW1pdChkZXN0cm95TWVzc2FnZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICAgIHdhdGNoZXIub24oJ3JlYWR5JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICByZXNvbHZlKHt9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgY29uc3QgY2hpbGQgPSB0aGlzLmNkay53YXRjaChkZXBsb3lBcmdzKTtcbiAgICAvLyBpZiBgLXZgIChvciBhYm92ZSkgaXMgcGFzc2VkIHRoZW4gc3RyZWFtIHRoZSBsb2dzXG4gICAgY2hpbGQuc3Rkb3V0Py5vbignZGF0YScsIChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAodmVyYm9zaXR5ID4gMCkge1xuICAgICAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBjaGlsZC5zdGRlcnI/Lm9uKCdkYXRhJywgKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmICh2ZXJib3NpdHkgPiAwKSB7XG4gICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKG1lc3NhZ2UpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XG4gICAgICBjaGlsZC5vbignY2xvc2UnLCBhc3luYyAoY29kZSkgPT4ge1xuICAgICAgICBpZiAoY29kZSAhPT0gMCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignV2F0Y2ggZXhpdGVkIHdpdGggZXJyb3InKTtcbiAgICAgICAgfVxuICAgICAgICBjaGlsZC5zdGRpbj8uZW5kKCk7XG4gICAgICAgIGF3YWl0IHdhdGNoZXIuY2xvc2UoKTtcbiAgICAgICAgcmVzb2x2ZShjb2RlKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFBlcmZvcm0gYSBpbnRlZyB0ZXN0IGNhc2UgZGVwbG95bWVudCwgaW5jbHVkaW5nXG4gICAqIHBlZm9ybWluZyB0aGUgdXBkYXRlIHdvcmtmbG93XG4gICAqL1xuICBwcml2YXRlIGRlcGxveShcbiAgICBkZXBsb3lBcmdzOiBEZXBsb3lPcHRpb25zLFxuICAgIHVwZGF0ZVdvcmtmbG93RW5hYmxlZDogYm9vbGVhbixcbiAgICB0ZXN0Q2FzZU5hbWU6IHN0cmluZyxcbiAgKTogQXNzZXJ0aW9uUmVzdWx0cyB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgYWN0dWFsVGVzdENhc2UgPSB0aGlzLmFjdHVhbFRlc3RTdWl0ZS50ZXN0U3VpdGVbdGVzdENhc2VOYW1lXTtcbiAgICB0cnkge1xuICAgICAgaWYgKGFjdHVhbFRlc3RDYXNlLmhvb2tzPy5wcmVEZXBsb3kpIHtcbiAgICAgICAgYWN0dWFsVGVzdENhc2UuaG9va3MucHJlRGVwbG95LmZvckVhY2goY21kID0+IHtcbiAgICAgICAgICBleGVjKGNodW5rcyhjbWQpLCB7XG4gICAgICAgICAgICBjd2Q6IHBhdGguZGlybmFtZSh0aGlzLnNuYXBzaG90RGlyKSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICAvLyBpZiB0aGUgdXBkYXRlIHdvcmtmbG93IGlzIG5vdCBkaXNhYmxlZCwgZmlyc3RcbiAgICAgIC8vIHBlcmZvcm0gYSBkZXBsb3ltZW50IHdpdGggdGhlIGV4aXNpbmcgc25hcHNob3RcbiAgICAgIC8vIHRoZW4gcGVyZm9ybSBhIGRlcGxveW1lbnQgKHdoaWNoIHdpbGwgYmUgYSBzdGFjayB1cGRhdGUpXG4gICAgICAvLyB3aXRoIHRoZSBjdXJyZW50IGludGVncmF0aW9uIHRlc3RcbiAgICAgIC8vIFdlIGFsc28gb25seSB3YW50IHRvIHJ1biB0aGUgdXBkYXRlIHdvcmtmbG93IGlmIHRoZXJlIGlzIGFuIGV4aXN0aW5nXG4gICAgICAvLyBzbmFwc2hvdCAob3RoZXJ3aXNlIHRoZXJlIGlzIG5vdGhpbmcgdG8gdXBkYXRlKVxuICAgICAgaWYgKHVwZGF0ZVdvcmtmbG93RW5hYmxlZCAmJiB0aGlzLmhhc1NuYXBzaG90KCkgJiZcbiAgICAgICAgKHRoaXMuZXhwZWN0ZWRUZXN0U3VpdGUgJiYgdGVzdENhc2VOYW1lIGluIHRoaXMuZXhwZWN0ZWRUZXN0U3VpdGU/LnRlc3RTdWl0ZSkpIHtcbiAgICAgICAgLy8gbWFrZSBzdXJlIHRoZSBzbmFwc2hvdCBpcyB0aGUgbGF0ZXN0IGZyb20gJ29yaWdpbidcbiAgICAgICAgdGhpcy5jaGVja291dFNuYXBzaG90KCk7XG4gICAgICAgIGNvbnN0IGV4cGVjdGVkVGVzdENhc2UgPSB0aGlzLmV4cGVjdGVkVGVzdFN1aXRlLnRlc3RTdWl0ZVt0ZXN0Q2FzZU5hbWVdO1xuICAgICAgICB0aGlzLmNkay5kZXBsb3koe1xuICAgICAgICAgIC4uLmRlcGxveUFyZ3MsXG4gICAgICAgICAgc3RhY2tzOiBleHBlY3RlZFRlc3RDYXNlLnN0YWNrcyxcbiAgICAgICAgICAuLi5leHBlY3RlZFRlc3RDYXNlPy5jZGtDb21tYW5kT3B0aW9ucz8uZGVwbG95Py5hcmdzLFxuICAgICAgICAgIGNvbnRleHQ6IHRoaXMuZ2V0Q29udGV4dChleHBlY3RlZFRlc3RDYXNlPy5jZGtDb21tYW5kT3B0aW9ucz8uZGVwbG95Py5hcmdzPy5jb250ZXh0KSxcbiAgICAgICAgICBhcHA6IHBhdGgucmVsYXRpdmUodGhpcy5kaXJlY3RvcnksIHRoaXMuc25hcHNob3REaXIpLFxuICAgICAgICAgIGxvb2t1cHM6IHRoaXMuZXhwZWN0ZWRUZXN0U3VpdGU/LmVuYWJsZUxvb2t1cHMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgLy8gbm93IGRlcGxveSB0aGUgXCJhY3R1YWxcIiB0ZXN0LlxuICAgICAgdGhpcy5jZGsuZGVwbG95KHtcbiAgICAgICAgLi4uZGVwbG95QXJncyxcbiAgICAgICAgbG9va3VwczogdGhpcy5hY3R1YWxUZXN0U3VpdGUuZW5hYmxlTG9va3VwcyxcbiAgICAgICAgc3RhY2tzOiBbXG4gICAgICAgICAgLi4uYWN0dWFsVGVzdENhc2Uuc3RhY2tzLFxuICAgICAgICBdLFxuICAgICAgICBvdXRwdXQ6IHBhdGgucmVsYXRpdmUodGhpcy5kaXJlY3RvcnksIHRoaXMuY2RrT3V0RGlyKSxcbiAgICAgICAgLi4uYWN0dWFsVGVzdENhc2U/LmNka0NvbW1hbmRPcHRpb25zPy5kZXBsb3k/LmFyZ3MsXG4gICAgICAgIGNvbnRleHQ6IHRoaXMuZ2V0Q29udGV4dChhY3R1YWxUZXN0Q2FzZT8uY2RrQ29tbWFuZE9wdGlvbnM/LmRlcGxveT8uYXJncz8uY29udGV4dCksXG4gICAgICAgIGFwcDogdGhpcy5jZGtBcHAsXG4gICAgICB9KTtcblxuICAgICAgLy8gSWYgdGhlcmUgYXJlIGFueSBhc3NlcnRpb25zXG4gICAgICAvLyBkZXBsb3kgdGhlIGFzc2VydGlvbiBzdGFjayBhcyB3ZWxsXG4gICAgICAvLyBUaGlzIGlzIHNlcGFyYXRlIGZyb20gdGhlIGFib3ZlIGRlcGxveW1lbnQgYmVjYXVzZSB3ZSB3YW50IHRvXG4gICAgICAvLyBzZXQgYHJvbGxiYWNrOiBmYWxzZWAuIFRoaXMgYWxsb3dzIHRoZSBhc3NlcnRpb24gc3RhY2sgdG8gZGVwbG95IGFsbCB0aGVcbiAgICAgIC8vIGFzc2VydGlvbnMgaW5zdGVhZCBvZiBmYWlsaW5nIGF0IHRoZSBmaXJzdCBmYWlsZWQgYXNzZXJ0aW9uXG4gICAgICAvLyBjb21iaW5pbmcgaXQgd2l0aCB0aGUgYWJvdmUgZGVwbG95bWVudCB3b3VsZCBwcmV2ZW50IGFueSByZXBsYWNlbWVudCB1cGRhdGVzXG4gICAgICBpZiAoYWN0dWFsVGVzdENhc2UuYXNzZXJ0aW9uU3RhY2spIHtcbiAgICAgICAgdGhpcy5jZGsuZGVwbG95KHtcbiAgICAgICAgICAuLi5kZXBsb3lBcmdzLFxuICAgICAgICAgIGxvb2t1cHM6IHRoaXMuYWN0dWFsVGVzdFN1aXRlLmVuYWJsZUxvb2t1cHMsXG4gICAgICAgICAgc3RhY2tzOiBbXG4gICAgICAgICAgICBhY3R1YWxUZXN0Q2FzZS5hc3NlcnRpb25TdGFjayxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHJvbGxiYWNrOiBmYWxzZSxcbiAgICAgICAgICBvdXRwdXQ6IHBhdGgucmVsYXRpdmUodGhpcy5kaXJlY3RvcnksIHRoaXMuY2RrT3V0RGlyKSxcbiAgICAgICAgICAuLi5hY3R1YWxUZXN0Q2FzZT8uY2RrQ29tbWFuZE9wdGlvbnM/LmRlcGxveT8uYXJncyxcbiAgICAgICAgICBvdXRwdXRzRmlsZTogcGF0aC5yZWxhdGl2ZSh0aGlzLmRpcmVjdG9yeSwgcGF0aC5qb2luKHRoaXMuY2RrT3V0RGlyLCAnYXNzZXJ0aW9uLXJlc3VsdHMuanNvbicpKSxcbiAgICAgICAgICBjb250ZXh0OiB0aGlzLmdldENvbnRleHQoYWN0dWFsVGVzdENhc2U/LmNka0NvbW1hbmRPcHRpb25zPy5kZXBsb3k/LmFyZ3M/LmNvbnRleHQpLFxuICAgICAgICAgIGFwcDogdGhpcy5jZGtBcHAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoYWN0dWFsVGVzdENhc2UuaG9va3M/LnBvc3REZXBsb3kpIHtcbiAgICAgICAgYWN0dWFsVGVzdENhc2UuaG9va3MucG9zdERlcGxveS5mb3JFYWNoKGNtZCA9PiB7XG4gICAgICAgICAgZXhlYyhjaHVua3MoY21kKSwge1xuICAgICAgICAgICAgY3dkOiBwYXRoLmRpcm5hbWUodGhpcy5zbmFwc2hvdERpciksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoYWN0dWFsVGVzdENhc2UuYXNzZXJ0aW9uU3RhY2sgJiYgYWN0dWFsVGVzdENhc2UuYXNzZXJ0aW9uU3RhY2tOYW1lKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NBc3NlcnRpb25SZXN1bHRzKFxuICAgICAgICAgIHBhdGguam9pbih0aGlzLmNka091dERpciwgJ2Fzc2VydGlvbi1yZXN1bHRzLmpzb24nKSxcbiAgICAgICAgICBhY3R1YWxUZXN0Q2FzZS5hc3NlcnRpb25TdGFja05hbWUsXG4gICAgICAgICAgYWN0dWFsVGVzdENhc2UuYXNzZXJ0aW9uU3RhY2ssXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5wYXJzZUVycm9yKGUsXG4gICAgICAgIGFjdHVhbFRlc3RDYXNlLmNka0NvbW1hbmRPcHRpb25zPy5kZXBsb3k/LmV4cGVjdEVycm9yID8/IGZhbHNlLFxuICAgICAgICBhY3R1YWxUZXN0Q2FzZS5jZGtDb21tYW5kT3B0aW9ucz8uZGVwbG95Py5leHBlY3RlZE1lc3NhZ2UsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cblxuICAvKipcbiAgICogUHJvY2VzcyB0aGUgb3V0cHV0c0ZpbGUgd2hpY2ggY29udGFpbnMgdGhlIGFzc2VydGlvbnMgcmVzdWx0cyBhcyBzdGFja1xuICAgKiBvdXRwdXRzXG4gICAqL1xuICBwcml2YXRlIHByb2Nlc3NBc3NlcnRpb25SZXN1bHRzKGZpbGU6IHN0cmluZywgYXNzZXJ0aW9uU3RhY2tOYW1lOiBzdHJpbmcsIGFzc2VydGlvblN0YWNrSWQ6IHN0cmluZyk6IEFzc2VydGlvblJlc3VsdHMgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHJlc3VsdHM6IEFzc2VydGlvblJlc3VsdHMgPSB7fTtcbiAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0czogeyBba2V5OiBzdHJpbmddOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9IH0gPSBmcy5yZWFkSlNPTlN5bmMoZmlsZSk7XG5cbiAgICAgICAgaWYgKGFzc2VydGlvblN0YWNrTmFtZSBpbiBvdXRwdXRzKSB7XG4gICAgICAgICAgZm9yIChjb25zdCBbYXNzZXJ0aW9uSWQsIHJlc3VsdF0gb2YgT2JqZWN0LmVudHJpZXMob3V0cHV0c1thc3NlcnRpb25TdGFja05hbWVdKSkge1xuICAgICAgICAgICAgaWYgKGFzc2VydGlvbklkLnN0YXJ0c1dpdGgoJ0Fzc2VydGlvblJlc3VsdHMnKSkge1xuICAgICAgICAgICAgICBjb25zdCBhc3NlcnRpb25SZXN1bHQ6IEFzc2VydGlvblJlc3VsdCA9IEpTT04ucGFyc2UocmVzdWx0LnJlcGxhY2UoL1xcbi9nLCAnXFxcXG4nKSk7XG4gICAgICAgICAgICAgIGlmIChhc3NlcnRpb25SZXN1bHQuc3RhdHVzID09PSAnZmFpbCcgfHwgYXNzZXJ0aW9uUmVzdWx0LnN0YXR1cyA9PT0gJ3N1Y2Nlc3MnKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0c1thc3NlcnRpb25JZF0gPSBhc3NlcnRpb25SZXN1bHQ7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gaWYgdGhlcmUgYXJlIG91dHB1dHMsIGJ1dCB0aGV5IGNhbm5vdCBiZSBwcm9jZXNzZWQsIHRoZW4gdGhyb3cgYW4gZXJyb3JcbiAgICAgICAgLy8gc28gdGhhdCB0aGUgdGVzdCBmYWlsc1xuICAgICAgICByZXN1bHRzW2Fzc2VydGlvblN0YWNrSWRdID0ge1xuICAgICAgICAgIHN0YXR1czogJ2ZhaWwnLFxuICAgICAgICAgIG1lc3NhZ2U6IGBlcnJvciBwcm9jZXNzaW5nIGFzc2VydGlvbiByZXN1bHRzOiAke2V9YCxcbiAgICAgICAgfTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIC8vIHJlbW92ZSB0aGUgb3V0cHV0cyBmaWxlIHNvIGl0IGlzIG5vdCBwYXJ0IG9mIHRoZSBzbmFwc2hvdFxuICAgICAgICAvLyBpdCB3aWxsIGNvbnRhaW4gZW52IHNwZWNpZmljIGluZm9ybWF0aW9uIGZyb20gdmFsdWVzXG4gICAgICAgIC8vIHJlc29sdmVkIGF0IGRlcGxveSB0aW1lXG4gICAgICAgIGZzLnVubGlua1N5bmMoZmlsZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBPYmplY3Qua2V5cyhyZXN1bHRzKS5sZW5ndGggPiAwID8gcmVzdWx0cyA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgYW4gZXJyb3IgbWVzc2FnZSByZXR1cm5lZCBmcm9tIGEgQ0RLIGNvbW1hbmRcbiAgICovXG4gIHByaXZhdGUgcGFyc2VFcnJvcihlOiB1bmtub3duLCBleHBlY3RFcnJvcjogYm9vbGVhbiwgZXhwZWN0ZWRNZXNzYWdlPzogc3RyaW5nKSB7XG4gICAgaWYgKGV4cGVjdEVycm9yKSB7XG4gICAgICBpZiAoZXhwZWN0ZWRNZXNzYWdlKSB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSAoZSBhcyBFcnJvcikubWVzc2FnZTtcbiAgICAgICAgaWYgKCFtZXNzYWdlLm1hdGNoKGV4cGVjdGVkTWVzc2FnZSkpIHtcbiAgICAgICAgICB0aHJvdyAoZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==