import * as path from 'path';
import type { DestroyOptions, TestCase } from '@aws-cdk/cloud-assembly-schema';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import * as chokidar from 'chokidar';
import { type EventName, EVENTS } from 'chokidar/handler.js';
import * as fs from 'fs-extra';
import * as workerpool from 'workerpool';
import type * as cdk from '../engines/cdk-interface';
import * as logger from '../logger';
import { chunks, exec, execWithSubShell, promiseWithResolvers, renderCommand } from '../utils';
import type { CdkTestAppOptions, LegacyEnableLookups } from './cdk-test-app';
import { CdkTestApp, DEFAULT_ARGS } from './cdk-test-app';
import type { IntegTest } from './integration-tests';
import type { DestructiveChange, AssertionResults, AssertionResult } from '../workers/common';
import { DiagnosticReason, formatAssertionResults, formatError } from '../workers/common';

/**
 * File events that we care about from chokidar.
 * In chokidar v4, EventName includes additional events like 'error', 'raw', 'ready', 'all'
 * that we need to filter out in the 'all' handler.
 */
const FILE_EVENTS = [EVENTS.ADD, EVENTS.CHANGE] as const;
type FileEvent = typeof FILE_EVENTS[number];

/**
 * Type guard to check if an event is a file event we should process.
 */
function isFileEvent(event: EventName): event is FileEvent {
  return (FILE_EVENTS as readonly string[]).includes(event);
}

export interface CommonOptions {
  /**
   * The level of verbosity for logging.
   *
   * @default 0
   */
  readonly verbosity?: number;
}

export interface WatchOptions extends CommonOptions {
  /**
   * ARN of the IAM role for CloudFormation to assume during deploy/destroy
   *
   * @default - use the bootstrap cfn-exec role
   */
  readonly roleArn?: string;
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

  /**
   * List of git tags to deploy in sequence before deploying the current code.
   * When provided, replaces the normal merge-base update workflow.
   *
   * @default - use the normal update workflow
   */
  readonly updateFromTags?: string[];

  /**
   * ARN of the IAM role for CloudFormation to assume during deploy/destroy
   *
   * @default - use the bootstrap cfn-exec role
   */
  readonly roleArn?: string;

  /**
   * Whether to allow resources that fail to delete during a stack update.
   *
   * When false, the test will fail if CloudFormation skips deleting a resource
   * during a stack update. When true, only a warning is printed.
   *
   * @default false
   */
  readonly allowDeleteFailures?: boolean;
}

type RunnerOptions = Omit<CdkTestAppOptions, 'outputDirectoryNameTemplate'> & {
  /**
   * Just for testing
   *
   * Use the comparison output directory for deployments, instead of a separate output
   * directory.
   *
   * Preferably, we synth into a separate directory so that snapshot comparison assembly and
   * deployment assembly don't trample on each other, but the tests in this repository have
   * been set up to use the same directory.
   */
  TESTING_useComparisonOutputDirectory?: boolean;
};

/**
 * An integration test runner that orchestrates executing
 * integration tests
 */
export class IntegTestRunner {
  private readonly test: IntegTest;

  constructor(private readonly appOptions: RunnerOptions, private readonly destructiveChanges?: DestructiveChange[]) {
    this.test = appOptions.test;
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
  public async runIntegTestCase(runOptions: RunOptions): Promise<AssertionResults | undefined> {
    let assertionResults: AssertionResults | undefined;

    // Set up actual
    let actual = await CdkTestApp.forDeployment(this.appOptions);
    if (this.appOptions.TESTING_useComparisonOutputDirectory) {
      actual = await CdkTestApp.forComparison(this.appOptions);
    }

    const previousVersion = await CdkTestApp.forGoldenSnapshot(this.appOptions);

    const actualTestSuite = await actual.synthForDeployment();

    if (actualTestSuite.type === 'legacy-test-suite' && !previousVersion.hasOutput()) {
      throw new Error(`${this.test.testName} is a new test. Please use the IntegTest construct ` +
        'to configure the test\n' +
        'https://github.com/aws/aws-cdk/tree/main/packages/%40aws-cdk/integ-tests-alpha',
      );
    }

    const clean = runOptions.clean ?? true;
    try {
      for (const [testCaseName, actualTestCase] of Object.entries(actualTestSuite.testSuite)) {
        const updateWorkflowEnabled = (runOptions.updateWorkflow ?? false)
          && (actualTestCase.stackUpdateWorkflow ?? false);
        const allowDeleteFailures = actualTestCase.allowDeleteFailures ?? runOptions.allowDeleteFailures ?? false;

        const verbosity = analyzeVerbosity(runOptions.verbosity);

        if (!runOptions.dryRun && (actualTestCase.cdkCommandOptions?.deploy?.enabled ?? true)) {
          try {
            assertionResults = await this.deployTestAndAssertions(
              actual,
              previousVersion,
              actualTestCase,
              {
                roleArn: runOptions.roleArn ?? actualTestCase.cdkCommandOptions?.deploy?.args?.roleArn,
                verbose: verbosity.verbose,
                debug: verbosity.debug,
              },
              updateWorkflowEnabled,
              testCaseName,
              allowDeleteFailures,
              runOptions.updateFromTags,
            );
          } finally {
            if (!runOptions.dryRun && clean && (actualTestCase.cdkCommandOptions?.destroy?.enabled ?? true)) {
              await this.destroyTestAndAssertions(actual, actualTestCase, {
                ...actualTestCase.cdkCommandOptions?.destroy?.args,
                roleArn: runOptions.roleArn ?? actualTestCase.cdkCommandOptions?.destroy?.args?.roleArn,
                verbose: verbosity.verbose,
                debug: verbosity.debug,
              });
            }
          }
        }
      }

      // only create the snapshot if there are no failed assertion results
      // (i.e. no failures)
      if (!Object.values(assertionResults ?? {}).some(result => result.status === 'fail')) {
        await this.createSnapshot(actualTestSuite.enableLookups);
      }
    } finally {
      actual.cleanup();
    }

    return assertionResults;
  }

  private async createSnapshot(enableLookups: LegacyEnableLookups) {
    const expected = await CdkTestApp.forGoldenSnapshot(this.appOptions);
    await expected.synthForGoldenSnapshot(this.destructiveChanges ?? [], enableLookups);
  }

  /**
   * Runs cdk deploy --watch for an integration test
   *
   * This is meant to be run on a single test and will not create a snapshot
   */
  public async watchIntegTest(options: WatchOptions): Promise<void> {
    // Set up actual
    const actual = await CdkTestApp.forDeployment(this.appOptions);
    await actual.synthForDeployment();

    // Just take the first test case, that's the one we watch.
    // Not even sure how better behavior here is possible, but watch isn't used that often.
    const firstTestCaseName = Object.keys(actual.testCases())[0];

    const verbosity = analyzeVerbosity(options.verbosity);
    try {
      await this.watch(
        actual,
        firstTestCaseName,
        {
          ...DEFAULT_ARGS,
          deploymentMethod: {
            method: 'hotswap',
            fallback: {
              method: 'change-set',
            },
          },
          profile: this.appOptions.profile,
          requireApproval: RequireApproval.NEVER,
          traceLogs: verbosity.traceLogs ?? false,
          verbose: verbosity.verbose,
          debug: verbosity.debug,
          roleArn: options.roleArn,
        },
        options.verbosity ?? 0,
      );
    } catch (e) {
      throw e;
    }
  }

  /**
   * Checkout the snapshot directory at a specific git ref (tag, commit, branch).
   * Fails fast if the snapshot does not exist at the given ref.
   */
  private checkoutSnapshotAtRef(snapshotApp: CdkTestApp, ref: string): void {
    const gitCwd = path.dirname(snapshotApp.outputDirectory);
    const git = ['git', '-C', gitCwd];
    const relativeSnapshotDir = path.relative(gitCwd, snapshotApp.outputDirectory);

    try {
      exec([...git, 'checkout', ref, '--', relativeSnapshotDir]);
    } catch (e) {
      throw new Error(
        `Snapshot does not exist at tag '${ref}'. ` +
        `Path: ${relativeSnapshotDir}\n` +
        `Underlying error: ${formatError(e)}`,
      );
    }
  }

  /**
   * Deploy the snapshot from each git tag in sequence, then let the caller
   * deploy the current code as the final update.
   */
  private async deployFromTags(
    actualApp: CdkTestApp,
    deployArgs: cdk.DeployOptions,
    testCaseName: string,
    tags: string[],
    allowDeleteFailures: boolean,
  ): Promise<void> {
    const totalTags = tags.length;

    for (let i = 0; i < totalTags; i++) {
      const tag = tags[i];
      logger.highlight(`${this.test.testName}/${testCaseName}: deploying tag ${tag} (${i + 1}/${totalTags})`);

      this.checkoutSnapshotAtRef(actualApp, tag);

      const expectedTestSuite = actualApp.testSuite;
      if (!expectedTestSuite || !(testCaseName in expectedTestSuite.testSuite)) {
        throw new Error(
          `Test case '${testCaseName}' does not exist in snapshot at tag '${tag}'`,
        );
      }

      const expectedTestCase = expectedTestSuite.testSuite[testCaseName];
      const deployResult = await actualApp.deploy({
        ...deployArgs,
        stacks: expectedTestCase.stacks,
        ...expectedTestCase?.cdkCommandOptions?.deploy?.args,
        context: expectedTestCase?.cdkCommandOptions?.deploy?.args?.context,
      });

      if (deployResult.deleteFailures.length > 0) {
        const details = deployResult.deleteFailures
          .map(f => `  - ${f.logicalResourceId} (${f.resourceType}): ${f.reason}`)
          .join('\n');
        const message =
          `Update from tag '${tag}': ${deployResult.deleteFailures.length} resource(s) failed to delete:\n${details}`;
        if (allowDeleteFailures) {
          logger.warning(message);
        } else {
          throw new Error(message);
        }
      }
    }

    logger.highlight(`${actualApp.test.testName}/${testCaseName}: deploying current branch (final)`);
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
  private checkoutSnapshot(actualApp: CdkTestApp): void {
    // We use the directory that contains the snapshot to run git commands in
    // We don't change the cwd for executing git, but instead use the -C flag
    // @see https://git-scm.com/docs/git#Documentation/git.txt--Cltpathgt
    // This way we are guaranteed to operate under the correct git repo, even
    // when executing integ-runner from outside the repo under test.
    const gitCwd = path.dirname(actualApp.outputDirectory);
    const git = ['git', '-C', gitCwd];

    // https://git-scm.com/docs/git-merge-base
    let baseBranch: string | undefined = undefined;
    // try to find the base branch that the working branch was created from
    try {
      const origin: string = exec([...git, 'remote', 'show', 'origin']);
      const originLines = origin.split('\n');
      for (const line of originLines) {
        if (line.trim().startsWith('HEAD branch: ')) {
          baseBranch = line.trim().split('HEAD branch: ')[1];
        }
      }
    } catch (e) {
      logger.warning('%s\n%s',
        'Could not determine git origin branch.',
        `You need to manually checkout the snapshot directory ${actualApp.outputDirectory}` +
        'from the merge-base (https://git-scm.com/docs/git-merge-base)',
      );
      logger.warning('error: %s', formatError(e));
    }

    // if we found the base branch then get the merge-base (most recent common commit)
    // and checkout the snapshot using that commit
    if (baseBranch) {
      const relativeSnapshotDir = path.relative(gitCwd, actualApp.outputDirectory);

      const checkoutCommand = [...git, 'checkout', [...git, 'merge-base', 'HEAD', baseBranch], '--', relativeSnapshotDir];
      try {
        execWithSubShell(checkoutCommand);
      } catch (e) {
        logger.warning('%s\n%s',
          `Could not checkout snapshot directory '${actualApp.outputDirectory}'. Please verify the following command completes correctly:`,
          renderCommand(checkoutCommand),
          '',
        );
        logger.warning('error: %s', formatError(e));
      }
    }
  }

  /**
   * Perform a integ test case stack destruction
   */
  private async destroyTestAndAssertions(actualApp: CdkTestApp, actualTestCase: TestCase, destroyArgs: Partial<DestroyOptions>): Promise<void> {
    try {
      if (actualTestCase.hooks?.preDestroy) {
        actualTestCase.hooks.preDestroy.forEach(cmd => {
          exec(chunks(cmd), {
            cwd: path.dirname(actualApp.outputDirectory),
          });
        });
      }

      await actualApp.destroy({
        stacks: [
          ...actualTestCase.stacks,
          ...(actualTestCase.assertionStack ? [actualTestCase.assertionStack] : []),
        ],
        ...destroyArgs,
      });

      if (actualTestCase.hooks?.postDestroy) {
        actualTestCase.hooks.postDestroy.forEach(cmd => {
          exec(chunks(cmd), {
            cwd: path.dirname(actualApp.outputDirectory),
          });
        });
      }
    } catch (e) {
      this.parseError(e,
        actualTestCase.cdkCommandOptions?.destroy?.expectError ?? false,
        actualTestCase.cdkCommandOptions?.destroy?.expectedMessage,
      );
    }
  }

  private async watch(actualApp: CdkTestApp, testCaseName: string, options: cdk.WatchOptions, verbosity: number): Promise<void> {
    const actualTestSuite = actualApp.testSuite;

    const actualTestCase = actualApp.testCases()[testCaseName];

    if (actualTestCase.hooks?.preDeploy) {
      actualTestCase.hooks.preDeploy.forEach(cmd => {
        exec(chunks(cmd), {
          cwd: path.dirname(actualApp.outputDirectory),
        });
      });
    }
    const watchArgs = {
      ...options,
      lookups: actualTestSuite.enableLookups,
      stacks: [
        ...actualTestCase.stacks,
        ...actualTestCase.assertionStack ? [actualTestCase.assertionStack] : [],
      ],
      output: actualApp.outputDirectory,
      outputsFile: path.join(actualApp.outputDirectory, 'assertion-results.json'),
      ...actualTestCase?.cdkCommandOptions?.deploy?.args,
      context: actualTestCase?.cdkCommandOptions?.deploy?.args?.context,
    };
    const destroyMessage = {
      additionalMessages: [
        'After you are done you must manually destroy the deployed stacks',
        `  ${[
          ...process.env.AWS_REGION ? [`AWS_REGION=${process.env.AWS_REGION}`] : [],
          'cdk destroy',
          `-a '${actualApp.appCommand}'`,
          watchArgs.stacks.join(' '),
          `--profile ${watchArgs.profile}`,
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
          `  ${actualApp.synthReproCommand}`,
        ],
      });
    }

    const assertionResults = path.join(actualApp.outputDirectory, 'assertion-results.json');
    const watcher = chokidar.watch([actualApp.outputDirectory], {
      cwd: actualApp.outputDirectory,
    });
    watcher.on('all', (event: EventName, file: string) => {
      if (!isFileEvent(event)) {
        return; // Ignore non-file events like 'error', 'raw', 'ready', 'all'
      }
      // we only care about changes to the `assertion-results.json` file. If there
      // are assertions then this will change on every deployment
      if (assertionResults.endsWith(file) && (event === 'add' || event === 'change')) {
        const start = Date.now();
        if (actualTestCase.hooks?.postDeploy) {
          actualTestCase.hooks.postDeploy.forEach(cmd => {
            exec(chunks(cmd), {
              cwd: path.dirname(actualApp.outputDirectory),
            });
          });
        }

        if (actualTestCase.assertionStack && actualTestCase.assertionStackName) {
          const res = this.processAssertionResults(
            assertionResults,
            actualTestCase.assertionStackName,
            actualTestCase.assertionStack,
          );
          if (res && Object.values(res).some(r => r.status === 'fail')) {
            workerpool.workerEmit({
              reason: DiagnosticReason.ASSERTION_FAILED,
              testName: `${testCaseName} (${watchArgs.profile}`,
              message: formatAssertionResults(res),
              duration: (Date.now() - start) / 1000,
            });
          } else {
            workerpool.workerEmit({
              reason: DiagnosticReason.TEST_SUCCESS,
              testName: `${testCaseName}`,
              message: res ? formatAssertionResults(res) : 'NO ASSERTIONS',
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

    const { promise: waiter, resolve } = promiseWithResolvers<number | null>();

    await actualApp.watch(watchArgs, {
      // if `-v` (or above) is passed then stream the logs
      onStdout: (message) => {
        if (verbosity > 0) {
          process.stdout.write(message);
        }
      },
      // if `-v` (or above) is passed then stream the logs
      onStderr: (message) => {
        if (verbosity > 0) {
          process.stderr.write(message);
        }
      },
      onClose: async (code) => {
        if (code !== 0) {
          throw new Error('Watch exited with error');
        }
        await watcher.close();
        resolve(code);
      },
    });

    await waiter;
  }

  /**
   * Perform a integ test case deployment, including
   * performing the update workflow
   */
  private async deployTestAndAssertions(
    app: CdkTestApp,
    previousVersion: CdkTestApp,
    testCase: TestCase,
    deployArgs: cdk.DeployOptions,
    updateWorkflowEnabled: boolean,
    testCaseName: string,
    allowDeleteFailures: boolean,
    updateFromTags?: string[],
  ): Promise<AssertionResults | undefined> {
    try {
      if (testCase.hooks?.preDeploy) {
        testCase.hooks.preDeploy.forEach(cmd => {
          exec(chunks(cmd), {
            cwd: path.dirname(app.outputDirectory),
          });
        });
      }
      if (updateFromTags && updateFromTags.length > 0) {
        // Tag-sequence update workflow: deploy each tag's snapshot in order
        await this.deployFromTags(app, deployArgs, testCaseName, updateFromTags, allowDeleteFailures);
      } else if (updateWorkflowEnabled && await previousVersion.hasOutput()) {
        // Normal merge-base update workflow
        const expectedTestSuite = await previousVersion.loadExistingSuite();
        if (expectedTestSuite && testCaseName in expectedTestSuite?.testSuite) {
          this.checkoutSnapshot(previousVersion);
          const expectedTestCase = expectedTestSuite.testSuite[testCaseName];

          await previousVersion.deploy({
            ...deployArgs,
            stacks: expectedTestCase.stacks,
            ...expectedTestCase?.cdkCommandOptions?.deploy?.args,
            context: expectedTestCase?.cdkCommandOptions?.deploy?.args?.context,
          });
        }
      }

      // now deploy the "actual" test.
      // This is the stack update if the update workflow ran above.
      const actualDeployResult = await app.deploy({
        ...deployArgs,
        stacks: testCase.stacks,
        ...testCase?.cdkCommandOptions?.deploy?.args,
        context: testCase?.cdkCommandOptions?.deploy?.args?.context,
      });

      if (actualDeployResult.deleteFailures.length > 0) {
        const details = actualDeployResult.deleteFailures
          .map(f => `  - ${f.logicalResourceId} (${f.resourceType}): ${f.reason}`)
          .join('\n');
        const message =
          `${actualDeployResult.deleteFailures.length} resource(s) failed to delete during stack update:\n${details}\n` +
          'These resources are no longer managed by CloudFormation but still exist and may incur charges.';
        if (allowDeleteFailures) {
          logger.warning(message);
        } else {
          throw new Error(message);
        }
      }

      // If there are any assertions
      // deploy the assertion stack as well
      // This is separate from the above deployment because we want to
      // set `rollback: false`. This allows the assertion stack to deploy all the
      // assertions instead of failing at the first failed assertion
      // combining it with the above deployment would prevent any replacement updates
      if (testCase.assertionStack) {
        await app.deploy({
          ...deployArgs,
          stacks: [
            testCase.assertionStack,
          ],
          rollback: false,
          ...testCase?.cdkCommandOptions?.deploy?.args,
          outputsFile: path.join(app.outputDirectory, 'assertion-results.json'),
          context: testCase?.cdkCommandOptions?.deploy?.args?.context,
        });
      }

      if (testCase.hooks?.postDeploy) {
        testCase.hooks.postDeploy.forEach(cmd => {
          exec(chunks(cmd), {
            cwd: path.dirname(app.outputDirectory),
          });
        });
      }

      if (testCase.assertionStack && testCase.assertionStackName) {
        return this.processAssertionResults(
          path.join(app.outputDirectory, 'assertion-results.json'),
          testCase.assertionStackName,
          testCase.assertionStack,
        );
      }
    } catch (e) {
      this.parseError(e,
        testCase.cdkCommandOptions?.deploy?.expectError ?? false,
        testCase.cdkCommandOptions?.deploy?.expectedMessage,
      );
    }
    return;
  }

  /**
   * Process the outputsFile which contains the assertions results as stack
   * outputs
   */
  private processAssertionResults(file: string, assertionStackName: string, assertionStackId: string): AssertionResults | undefined {
    const results: AssertionResults = {};
    if (fs.existsSync(file)) {
      try {
        const outputs: { [key: string]: { [key: string]: string } } = fs.readJSONSync(file);

        if (assertionStackName in outputs) {
          for (const [assertionId, result] of Object.entries(outputs[assertionStackName])) {
            if (assertionId.startsWith('AssertionResults')) {
              const assertionResult: AssertionResult = JSON.parse(result.replace(/\n/g, '\\n'));
              if (assertionResult.status === 'fail' || assertionResult.status === 'success') {
                results[assertionId] = assertionResult;
              }
            }
          }
        }
      } catch (e) {
        // if there are outputs, but they cannot be processed, then throw an error
        // so that the test fails
        results[assertionStackId] = {
          status: 'fail',
          message: `error processing assertion results: ${e}`,
        };
      } finally {
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
  private parseError(e: unknown, expectError: boolean, expectedMessage?: string) {
    if (expectError) {
      if (expectedMessage) {
        const message = (e as Error).message;
        if (!message.match(expectedMessage)) {
          throw (e);
        }
      }
    } else {
      throw e;
    }
  }
}

function analyzeVerbosity(verbosity: number = 0): { verbose?: boolean; debug?: boolean; traceLogs?: boolean } {
  return {
    verbose: verbosity >= 1 ? true : undefined,
    debug: verbosity >= 2 ? true : undefined,
    traceLogs: verbosity >= 3 ? true : undefined,
  };
}
