import * as path from 'path';
import type { DestroyOptions, TestCase } from '@aws-cdk/cloud-assembly-schema';
import { RequireApproval } from '@aws-cdk/cloud-assembly-schema';
import * as chokidar from 'chokidar';
import { type EventName, EVENTS } from 'chokidar/handler.js';
import * as fs from 'fs-extra';
import * as workerpool from 'workerpool';
import type { IntegRunnerOptions } from './runner-base';
import { IntegRunner } from './runner-base';
import type * as cdk from '../engines/cdk-interface';
import * as logger from '../logger';
import { chunks, exec, execWithSubShell, promiseWithResolvers, renderCommand } from '../utils';
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
export class IntegTestRunner extends IntegRunner {
  constructor(options: IntegRunnerOptions, destructiveChanges?: DestructiveChange[]) {
    super(options);
    this._destructiveChanges = destructiveChanges;
  }

  public async actualTests(): Promise<{ [testName: string]: TestCase } | undefined> {
    const actualTestSuite = await this.actualTestSuite();
    // We don't want new tests written in the legacy mode.
    // If there is no existing snapshot _and_ this is a legacy
    // test then point the user to the new `IntegTest` construct
    if (!this.hasSnapshot() && actualTestSuite.type === 'legacy-test-suite') {
      throw new Error(`${this.testName} is a new test. Please use the IntegTest construct ` +
        'to configure the test\n' +
        'https://github.com/aws/aws-cdk/tree/main/packages/%40aws-cdk/integ-tests-alpha',
      );
    }

    return actualTestSuite.testSuite;
  }

  public createCdkContextJson(): void {
    if (!fs.existsSync(this.cdkContextPath)) {
      fs.writeFileSync(this.cdkContextPath, JSON.stringify({
        watch: { },
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
  private checkoutSnapshot(): void {
    // We use the directory that contains the snapshot to run git commands in
    // We don't change the cwd for executing git, but instead use the -C flag
    // @see https://git-scm.com/docs/git#Documentation/git.txt--Cltpathgt
    // This way we are guaranteed to operate under the correct git repo, even
    // when executing integ-runner from outside the repo under test.
    const gitCwd = path.dirname(this.snapshotDir);
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
        `You need to manually checkout the snapshot directory ${this.snapshotDir}` +
        'from the merge-base (https://git-scm.com/docs/git-merge-base)',
      );
      logger.warning('error: %s', formatError(e));
    }

    // if we found the base branch then get the merge-base (most recent common commit)
    // and checkout the snapshot using that commit
    if (baseBranch) {
      const relativeSnapshotDir = path.relative(gitCwd, this.snapshotDir);

      const checkoutCommand = [...git, 'checkout', [...git, 'merge-base', 'HEAD', baseBranch], '--', relativeSnapshotDir];
      try {
        execWithSubShell(checkoutCommand);
      } catch (e) {
        logger.warning('%s\n%s',
          `Could not checkout snapshot directory '${this.snapshotDir}'. Please verify the following command completes correctly:`,
          renderCommand(checkoutCommand),
          '',
        );
        logger.warning('error: %s', formatError(e));
      }
    }
  }

  /**
   * Runs cdk deploy --watch for an integration test
   *
   * This is meant to be run on a single test and will not create a snapshot
   */
  public async watchIntegTest(options: WatchOptions): Promise<void> {
    const actualTestSuite = await this.actualTestSuite();
    const actualTestCase = actualTestSuite.testSuite[options.testCaseName];
    if (!actualTestCase) {
      throw new Error(`Did not find test case name '${options.testCaseName}' in '${Object.keys(actualTestSuite.testSuite)}'`);
    }
    const enableForVerbosityLevel = (needed = 1) => {
      const verbosity = options.verbosity ?? 0;
      return (verbosity >= needed) ? true : undefined;
    };
    try {
      await this.watch(
        {
          ...this.defaultArgs,
          deploymentMethod: {
            method: 'hotswap',
            fallback: {
              method: 'change-set',
            },
          },
          profile: this.profile,
          requireApproval: RequireApproval.NEVER,
          traceLogs: enableForVerbosityLevel(2) ?? false,
          verbose: enableForVerbosityLevel(3),
          debug: enableForVerbosityLevel(4),
        },
        options.testCaseName,
        options.verbosity ?? 0,
      );
    } catch (e) {
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
  public async runIntegTestCase(options: RunOptions): Promise<AssertionResults | undefined> {
    let assertionResults: AssertionResults | undefined;
    const actualTestSuite = await this.actualTestSuite();
    const actualTestCase = actualTestSuite.testSuite[options.testCaseName];
    if (!actualTestCase) {
      throw new Error(`Did not find test case name '${options.testCaseName}' in '${Object.keys(actualTestSuite.testSuite)}'`);
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
        assertionResults = await this.deploy(
          {
            ...this.defaultArgs,
            profile: this.profile,
            requireApproval: RequireApproval.NEVER,
            verbose: enableForVerbosityLevel(3),
            debug: enableForVerbosityLevel(4),
          },
          updateWorkflowEnabled,
          options.testCaseName,
        );
      }

      // only create the snapshot if there are no failed assertion results
      // (i.e. no failures)
      if (!Object.values(assertionResults ?? {}).some(result => result.status === 'fail')) {
        await this.createSnapshot();
      }
    } catch (e) {
      throw e;
    } finally {
      if (!options.dryRun) {
        if (clean && (actualTestCase.cdkCommandOptions?.destroy?.enabled ?? true)) {
          await this.destroy(options.testCaseName, {
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
  private async destroy(testCaseName: string, destroyArgs: DestroyOptions) {
    const actualTestCase = (await this.actualTestSuite()).testSuite[testCaseName];
    try {
      if (actualTestCase.hooks?.preDestroy) {
        actualTestCase.hooks.preDestroy.forEach(cmd => {
          exec(chunks(cmd), {
            cwd: path.dirname(this.snapshotDir),
          });
        });
      }
      await this.cdk.destroy({
        ...destroyArgs,
      });

      if (actualTestCase.hooks?.postDestroy) {
        actualTestCase.hooks.postDestroy.forEach(cmd => {
          exec(chunks(cmd), {
            cwd: path.dirname(this.snapshotDir),
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

  private async watch(options: cdk.WatchOptions, testCaseName: string, verbosity: number): Promise<void> {
    const actualTestSuite = await this.actualTestSuite();
    const actualTestCase = actualTestSuite.testSuite[testCaseName];
    if (actualTestCase.hooks?.preDeploy) {
      actualTestCase.hooks.preDeploy.forEach(cmd => {
        exec(chunks(cmd), {
          cwd: path.dirname(this.snapshotDir),
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
          `  ${[
            'cdk synth',
            `-a '${this.cdkApp}'`,
            `-o '${this.cdkOutDir}'`,
            ...Object.entries(this.getContext()).flatMap(([k, v]) => typeof v !== 'object' ? [`-c '${k}=${v}'`] : []),
            watchArgs.stacks.join(' '),
            `--outputs-file ${watchArgs.outputsFile}`,
            `--profile ${watchArgs.profile}`,
            '--hotswap-fallback',
          ].join(' ')}`,
        ],
      });
    }

    const assertionResults = path.join(this.cdkOutDir, 'assertion-results.json');
    const watcher = chokidar.watch([this.cdkOutDir], {
      cwd: this.directory,
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
              cwd: path.dirname(this.snapshotDir),
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

    await this.cdk.watch(watchArgs, {
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
  private async deploy(
    deployArgs: cdk.DeployOptions,
    updateWorkflowEnabled: boolean,
    testCaseName: string,
  ): Promise<AssertionResults | undefined> {
    const actualTestCase = (await this.actualTestSuite()).testSuite[testCaseName];
    try {
      if (actualTestCase.hooks?.preDeploy) {
        actualTestCase.hooks.preDeploy.forEach(cmd => {
          exec(chunks(cmd), {
            cwd: path.dirname(this.snapshotDir),
          });
        });
      }
      // if the update workflow is not disabled, first
      // perform a deployment with the existing snapshot
      // then perform a deployment (which will be a stack update)
      // with the current integration test
      // We also only want to run the update workflow if there is an existing
      // snapshot (otherwise there is nothing to update)
      const expectedTestSuite = await this.expectedTestSuite();
      if (updateWorkflowEnabled && this.hasSnapshot() &&
        (expectedTestSuite && testCaseName in expectedTestSuite?.testSuite)) {
        // make sure the snapshot is the latest from 'origin'
        this.checkoutSnapshot();
        const expectedTestCase = expectedTestSuite.testSuite[testCaseName];
        await this.cdk.deploy({
          ...deployArgs,
          stacks: expectedTestCase.stacks,
          ...expectedTestCase?.cdkCommandOptions?.deploy?.args,
          context: this.getContext(expectedTestCase?.cdkCommandOptions?.deploy?.args?.context),
          app: path.relative(this.directory, this.snapshotDir),
          lookups: expectedTestSuite?.enableLookups,
        });
        this.cleanupSnapshotReadLocks();
      }
      // now deploy the "actual" test.
      await this.cdk.deploy({
        ...deployArgs,
        lookups: (await this.actualTestSuite()).enableLookups,
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
        await this.cdk.deploy({
          ...deployArgs,
          lookups: (await this.actualTestSuite()).enableLookups,
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
          exec(chunks(cmd), {
            cwd: path.dirname(this.snapshotDir),
          });
        });
      }

      if (actualTestCase.assertionStack && actualTestCase.assertionStackName) {
        return this.processAssertionResults(
          path.join(this.cdkOutDir, 'assertion-results.json'),
          actualTestCase.assertionStackName,
          actualTestCase.assertionStack,
        );
      }
    } catch (e) {
      this.parseError(e,
        actualTestCase.cdkCommandOptions?.deploy?.expectError ?? false,
        actualTestCase.cdkCommandOptions?.deploy?.expectedMessage,
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
