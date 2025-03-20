import * as path from 'node:path';
import * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import * as chokidar from 'chokidar';
import * as fs from 'fs-extra';
import type { ToolkitServices } from './private';
import { assemblyFromSource } from './private';
import type { BootstrapEnvironments, BootstrapOptions, BootstrapResult, EnvironmentBootstrapResult } from '../actions/bootstrap';
import { BootstrapSource } from '../actions/bootstrap';
import { AssetBuildTime, type DeployOptions } from '../actions/deploy';
import { type ExtendedDeployOptions, buildParameterMap, createHotswapPropertyOverrides, removePublishedAssets } from '../actions/deploy/private';
import { type DestroyOptions } from '../actions/destroy';
import { determinePermissionType } from '../actions/diff/private';
import { type ListOptions } from '../actions/list';
import { type RollbackOptions } from '../actions/rollback';
import { type SynthOptions } from '../actions/synth';
import type { WatchOptions } from '../actions/watch';
import { patternsArrayForWatch } from '../actions/watch/private';
import { type SdkConfig } from '../api/aws-auth';
import type { SuccessfulDeployStackResult, StackCollection, Concurrency, AssetBuildNode, AssetPublishNode, StackNode } from '../api/aws-cdk';
import { DEFAULT_TOOLKIT_STACK_NAME, Bootstrapper, SdkProvider, Deployments, HotswapMode, ResourceMigrator, tagsForStack, CliIoHost, WorkGraphBuilder, CloudWatchLogEventMonitor, findCloudWatchLogGroups } from '../api/aws-cdk';
import type { ICloudAssemblySource } from '../api/cloud-assembly';
import { StackSelectionStrategy } from '../api/cloud-assembly';
import type { StackAssembly } from '../api/cloud-assembly/private';
import { ALL_STACKS, CloudAssemblySourceBuilder, IdentityCloudAssemblySource } from '../api/cloud-assembly/private';
import type { IIoHost, IoMessageLevel } from '../api/io';
import { IO, SPAN, asSdkLogger, withoutColor, withoutEmojis, withTrimmedWhitespace } from '../api/io/private';
import type { IoHelper } from '../api/shared-private';
import { asIoHelper } from '../api/shared-private';
import type { AssemblyData, StackDetails, ToolkitAction } from '../api/shared-public';
import { RequireApproval, ToolkitError } from '../api/shared-public';
import { obscureTemplate, serializeStructure, validateSnsTopicArn, formatTime, formatErrorMessage } from '../private/util';
import { pLimit } from '../util/concurrency';

export interface ToolkitOptions {
  /**
   * The IoHost implementation, handling the inline interactions between the Toolkit and an integration.
   */
  ioHost?: IIoHost;

  /**
   * Allow emojis in messages sent to the IoHost.
   *
   * @default true
   */
  emojis?: boolean;

  /**
   * Whether to allow ANSI colors and formatting in IoHost messages.
   * Setting this value to `false` enforces that no color or style shows up
   * in messages sent to the IoHost.
   * Setting this value to true is a no-op; it is equivalent to the default.
   *
   * @default - detects color from the TTY status of the IoHost
   */
  color?: boolean;

  /**
   * Configuration options for the SDK.
   */
  sdkConfig?: SdkConfig;

  /**
   * Name of the toolkit stack to be used.
   *
   * @default "CDKToolkit"
   */
  toolkitStackName?: string;

  /**
   * Fail Cloud Assemblies
   *
   * @default "error"
   */
  assemblyFailureAt?: 'error' | 'warn' | 'none';
}

/**
 * The AWS CDK Programmatic Toolkit
 */
export class Toolkit extends CloudAssemblySourceBuilder implements AsyncDisposable {
  /**
   * The toolkit stack name used for bootstrapping resources.
   */
  public readonly toolkitStackName: string;

  /**
   * The IoHost of this Toolkit
   */
  public readonly ioHost: IIoHost;
  private _sdkProvider?: SdkProvider;

  public constructor(private readonly props: ToolkitOptions = {}) {
    super();
    this.toolkitStackName = props.toolkitStackName ?? DEFAULT_TOOLKIT_STACK_NAME;

    // Hacky way to re-use the global IoHost until we have fully removed the need for it
    const globalIoHost = CliIoHost.instance();
    if (props.ioHost) {
      globalIoHost.registerIoHost(props.ioHost as any);
    }
    let ioHost = globalIoHost as IIoHost;
    if (props.emojis === false) {
      ioHost = withoutEmojis(ioHost);
    }
    if (props.color === false) {
      ioHost = withoutColor(ioHost);
    }
    // After removing emojis and color, we might end up with floating whitespace at either end of the message
    // This also removes newlines that we currently emit for CLI backwards compatibility.
    this.ioHost = withTrimmedWhitespace(ioHost);
  }

  public async dispose(): Promise<void> {
    // nothing to do yet
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  /**
   * Access to the AWS SDK
   */
  private async sdkProvider(action: ToolkitAction): Promise<SdkProvider> {
    // @todo this needs to be different instance per action
    if (!this._sdkProvider) {
      this._sdkProvider = await SdkProvider.withAwsCliCompatibleDefaults({
        ...this.props.sdkConfig,
        logger: asSdkLogger(asIoHelper(this.ioHost, action)),
      });
    }

    return this._sdkProvider;
  }

  /**
   * Helper to provide the CloudAssemblySourceBuilder with required toolkit services
   */
  protected override async sourceBuilderServices(): Promise<ToolkitServices> {
    return {
      ioHelper: asIoHelper(this.ioHost, 'assembly'),
      sdkProvider: await this.sdkProvider('assembly'),
    };
  }

  /**
   * Bootstrap Action
   */
  public async bootstrap(environments: BootstrapEnvironments, options: BootstrapOptions): Promise<BootstrapResult> {
    const startTime = Date.now();
    const results: EnvironmentBootstrapResult[] = [];

    const ioHelper = asIoHelper(this.ioHost, 'bootstrap');
    const bootstrapEnvironments = await environments.getEnvironments();
    const source = options.source ?? BootstrapSource.default();
    const parameters = options.parameters;
    const bootstrapper = new Bootstrapper(source, ioHelper);
    const sdkProvider = await this.sdkProvider('bootstrap');
    const limit = pLimit(20);

    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all(bootstrapEnvironments.map((environment: cxapi.Environment, currentIdx) => limit(async () => {
      const bootstrapSpan = await ioHelper.span(SPAN.BOOTSTRAP_SINGLE)
        .begin(`${chalk.bold(environment.name)}: bootstrapping...`, {
          total: bootstrapEnvironments.length,
          current: currentIdx+1,
          environment,
        });

      try {
        const bootstrapResult = await bootstrapper.bootstrapEnvironment(
          environment,
          sdkProvider,
          {
            ...options,
            toolkitStackName: this.toolkitStackName,
            source,
            parameters: parameters?.parameters,
            usePreviousParameters: parameters?.keepExistingParameters,
          },
        );

        const message = bootstrapResult.noOp
          ? ` ✅  ${environment.name} (no changes)`
          : ` ✅  ${environment.name}`;

        await ioHelper.notify(IO.CDK_TOOLKIT_I9900.msg(chalk.green('\n' + message), { environment }));
        const envTime = await bootstrapSpan.end();
        const result: EnvironmentBootstrapResult = {
          environment,
          status: bootstrapResult.noOp ? 'no-op' : 'success',
          duration: envTime.asMs,
        };
        results.push(result);
      } catch (e: any) {
        await ioHelper.notify(IO.CDK_TOOLKIT_E9900.msg(`\n ❌  ${chalk.bold(environment.name)} failed: ${formatErrorMessage(e)}`, { error: e }));
        throw e;
      }
    })));

    return {
      environments: results,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Synth Action
   */
  public async synth(cx: ICloudAssemblySource, options: SynthOptions = {}): Promise<ICloudAssemblySource> {
    const ioHelper = asIoHelper(this.ioHost, 'synth');
    const selectStacks = options.stacks ?? ALL_STACKS;
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });
    const assembly = await assemblyFromSource(cx);
    const stacks = assembly.selectStacksV2(selectStacks);
    const autoValidateStacks = options.validateStacks ? [assembly.selectStacksForValidation()] : [];
    await this.validateStacksMetadata(stacks.concat(...autoValidateStacks), ioHelper);
    await synthSpan.end();

    // if we have a single stack, print it to STDOUT
    const message = `Successfully synthesized to ${chalk.blue(path.resolve(stacks.assembly.directory))}`;
    const assemblyData: AssemblyData = {
      assemblyDirectory: stacks.assembly.directory,
      stacksCount: stacks.stackCount,
      stackIds: stacks.hierarchicalIds,
    };

    if (stacks.stackCount === 1) {
      const firstStack = stacks.firstStack!;
      const template = firstStack.template;
      const obscuredTemplate = obscureTemplate(template);
      await ioHelper.notify(IO.CDK_TOOLKIT_I1901.msg(message, {
        ...assemblyData,
        stack: {
          stackName: firstStack.stackName,
          hierarchicalId: firstStack.hierarchicalId,
          template,
          stringifiedJson: serializeStructure(obscuredTemplate, true),
          stringifiedYaml: serializeStructure(obscuredTemplate, false),
        },
      }));
    } else {
      // not outputting template to stdout, let's explain things to the user a little bit...
      await ioHelper.notify(IO.CDK_TOOLKIT_I1902.msg(chalk.green(message), assemblyData));
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_INFO.msg(`Supply a stack id (${stacks.stackArtifacts.map((s) => chalk.green(s.hierarchicalId)).join(', ')}) to display its template.`));
    }

    return new IdentityCloudAssemblySource(assembly.assembly);
  }

  /**
   * List Action
   *
   * List selected stacks and their dependencies
   */
  public async list(cx: ICloudAssemblySource, options: ListOptions = {}): Promise<StackDetails[]> {
    const ioHelper = asIoHelper(this.ioHost, 'list');
    const selectStacks = options.stacks ?? ALL_STACKS;
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });
    const assembly = await assemblyFromSource(cx);
    const stackCollection = await assembly.selectStacksV2(selectStacks);
    await synthSpan.end();

    const stacks = stackCollection.withDependencies();
    const message = stacks.map(s => s.id).join('\n');

    await ioHelper.notify(IO.CDK_TOOLKIT_I2901.msg(message, { stacks }));
    return stacks;
  }

  /**
   * Deploy Action
   *
   * Deploys the selected stacks into an AWS account
   */
  public async deploy(cx: ICloudAssemblySource, options: DeployOptions = {}): Promise<void> {
    const assembly = await assemblyFromSource(cx);
    return this._deploy(assembly, 'deploy', options);
  }

  /**
   * Helper to allow deploy being called as part of the watch action.
   */
  private async _deploy(assembly: StackAssembly, action: 'deploy' | 'watch', options: ExtendedDeployOptions = {}) {
    const ioHelper = asIoHelper(this.ioHost, action);
    const selectStacks = options.stacks ?? ALL_STACKS;
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });
    const stackCollection = assembly.selectStacksV2(selectStacks);
    await this.validateStacksMetadata(stackCollection, ioHelper);
    const synthDuration = await synthSpan.end();

    if (stackCollection.stackCount === 0) {
      await ioHelper.notify(IO.CDK_TOOLKIT_E5001.msg('This app contains no stacks'));
      return;
    }

    const deployments = await this.deploymentsForAction('deploy');
    const migrator = new ResourceMigrator({ deployments, ioHelper });

    await migrator.tryMigrateResources(stackCollection, options);

    const parameterMap = buildParameterMap(options.parameters?.parameters);

    const hotswapMode = options.hotswap ?? HotswapMode.FULL_DEPLOYMENT;
    if (hotswapMode !== HotswapMode.FULL_DEPLOYMENT) {
      await ioHelper.notify(IO.CDK_TOOLKIT_W5400.msg([
        '⚠️ The --hotswap and --hotswap-fallback flags deliberately introduce CloudFormation drift to speed up deployments',
        '⚠️ They should only be used for development - never use them for your production Stacks!',
      ].join('\n')));
    }

    const stacks = stackCollection.stackArtifacts;
    const stackOutputs: { [key: string]: any } = {};
    const outputsFile = options.outputsFile;

    const buildAsset = async (assetNode: AssetBuildNode) => {
      const buildAssetSpan = await ioHelper.span(SPAN.BUILD_ASSET).begin({
        asset: assetNode.asset,
      });
      await deployments.buildSingleAsset(
        assetNode.assetManifestArtifact,
        assetNode.assetManifest,
        assetNode.asset,
        {
          stack: assetNode.parentStack,
          roleArn: options.roleArn,
          stackName: assetNode.parentStack.stackName,
        },
      );
      await buildAssetSpan.end();
    };

    const publishAsset = async (assetNode: AssetPublishNode) => {
      const publishAssetSpan = await ioHelper.span(SPAN.PUBLISH_ASSET).begin({
        asset: assetNode.asset,
      });
      await deployments.publishSingleAsset(assetNode.assetManifest, assetNode.asset, {
        stack: assetNode.parentStack,
        roleArn: options.roleArn,
        stackName: assetNode.parentStack.stackName,
        forcePublish: options.force,
      });
      await publishAssetSpan.end();
    };

    const deployStack = async (stackNode: StackNode) => {
      const stack = stackNode.stack;
      if (stackCollection.stackCount !== 1) {
        await ioHelper.notify(IO.DEFAULT_TOOLKIT_INFO.msg(chalk.bold(stack.displayName)));
      }

      if (!stack.environment) {
        throw new ToolkitError(
          `Stack ${stack.displayName} does not define an environment, and AWS credentials could not be obtained from standard locations or no region was configured.`,
        );
      }

      // The generated stack has no resources
      if (Object.keys(stack.template.Resources || {}).length === 0) {
        // stack is empty and doesn't exist => do nothing
        const stackExists = await deployments.stackExists({ stack });
        if (!stackExists) {
          return ioHelper.notify(IO.CDK_TOOLKIT_W5021.msg(`${chalk.bold(stack.displayName)}: stack has no resources, skipping deployment.`));
        }

        // stack is empty, but exists => delete
        await ioHelper.notify(IO.CDK_TOOLKIT_W5022.msg(`${chalk.bold(stack.displayName)}: stack has no resources, deleting existing stack.`));
        await this._destroy(assembly, 'deploy', {
          stacks: { patterns: [stack.hierarchicalId], strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE },
          roleArn: options.roleArn,
          ci: options.ci,
        });

        return;
      }

      const currentTemplate = await deployments.readCurrentTemplate(stack);
      const permissionChangeType = determinePermissionType(currentTemplate, stack);
      const deployMotivation = '"--require-approval" is enabled and stack includes security-sensitive updates.';
      const deployQuestion = `${deployMotivation}\nDo you wish to deploy these changes`;
      const deployConfirmed = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I5060.req(deployQuestion, {
        motivation: deployMotivation,
        concurrency,
        permissionChangeType,
      }));
      if (!deployConfirmed) {
        throw new ToolkitError('Aborted by user');
      }

      // Following are the same semantics we apply with respect to Notification ARNs (dictated by the SDK)
      //
      //  - undefined  =>  cdk ignores it, as if it wasn't supported (allows external management).
      //  - []:        =>  cdk manages it, and the user wants to wipe it out.
      //  - ['arn-1']  =>  cdk manages it, and the user wants to set it to ['arn-1'].
      const notificationArns = (!!options.notificationArns || !!stack.notificationArns)
        ? (options.notificationArns ?? []).concat(stack.notificationArns ?? [])
        : undefined;

      for (const notificationArn of notificationArns ?? []) {
        if (!validateSnsTopicArn(notificationArn)) {
          throw new ToolkitError(`Notification arn ${notificationArn} is not a valid arn for an SNS topic`);
        }
      }

      const stackIndex = stacks.indexOf(stack) + 1;
      const deploySpan = await ioHelper.span(SPAN.DEPLOY_STACK)
        .begin(`${chalk.bold(stack.displayName)}: deploying... [${stackIndex}/${stackCollection.stackCount}]`, {
          total: stackCollection.stackCount,
          current: stackIndex,
          stack,
        });

      let tags = options.tags;
      if (!tags || tags.length === 0) {
        tags = tagsForStack(stack);
      }

      let deployDuration;
      try {
        let deployResult: SuccessfulDeployStackResult | undefined;

        let rollback = options.rollback;
        let iteration = 0;
        while (!deployResult) {
          if (++iteration > 2) {
            throw new ToolkitError('This loop should have stabilized in 2 iterations, but didn\'t. If you are seeing this error, please report it at https://github.com/aws/aws-cdk/issues/new/choose');
          }

          const r = await deployments.deployStack({
            stack,
            deployName: stack.stackName,
            roleArn: options.roleArn,
            toolkitStackName: this.toolkitStackName,
            reuseAssets: options.reuseAssets,
            notificationArns,
            tags,
            deploymentMethod: options.deploymentMethod,
            force: options.force,
            parameters: Object.assign({}, parameterMap['*'], parameterMap[stack.stackName]),
            usePreviousParameters: options.parameters?.keepExistingParameters,
            rollback,
            hotswap: hotswapMode,
            extraUserAgent: options.extraUserAgent,
            hotswapPropertyOverrides: options.hotswapProperties ? createHotswapPropertyOverrides(options.hotswapProperties) : undefined,
            assetParallelism: options.assetParallelism,
          });

          switch (r.type) {
            case 'did-deploy-stack':
              deployResult = r;
              break;

            case 'failpaused-need-rollback-first': {
              const motivation = r.reason === 'replacement'
                ? `Stack is in a paused fail state (${r.status}) and change includes a replacement which cannot be deployed with "--no-rollback"`
                : `Stack is in a paused fail state (${r.status}) and command line arguments do not include "--no-rollback"`;
              const question = `${motivation}. Perform a regular deployment`;

              if (options.force) {
                await ioHelper.notify(IO.DEFAULT_TOOLKIT_WARN.msg(`${motivation}. Rolling back first (--force).`));
              } else {
                const confirmed = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I5050.req(question, {
                  motivation,
                  concurrency,
                }));
                if (!confirmed) {
                  throw new ToolkitError('Aborted by user');
                }
              }

              // Perform a rollback
              await this._rollback(assembly, action, {
                stacks: { patterns: [stack.hierarchicalId], strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE },
                orphanFailedResources: options.force,
              });

              // Go around through the 'while' loop again but switch rollback to true.
              rollback = true;
              break;
            }

            case 'replacement-requires-rollback': {
              const motivation = 'Change includes a replacement which cannot be deployed with "--no-rollback"';
              const question = `${motivation}. Perform a regular deployment`;

              // @todo no force here
              if (options.force) {
                await ioHelper.notify(IO.DEFAULT_TOOLKIT_WARN.msg(`${motivation}. Proceeding with regular deployment (--force).`));
              } else {
                const confirmed = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I5050.req(question, {
                  motivation,
                  concurrency,
                }));
                if (!confirmed) {
                  throw new ToolkitError('Aborted by user');
                }
              }

              // Go around through the 'while' loop again but switch rollback to true.
              rollback = true;
              break;
            }

            default:
              throw new ToolkitError(`Unexpected result type from deployStack: ${JSON.stringify(r)}. If you are seeing this error, please report it at https://github.com/aws/aws-cdk/issues/new/choose`);
          }
        }

        const message = deployResult.noOp
          ? ` ✅  ${stack.displayName} (no changes)`
          : ` ✅  ${stack.displayName}`;

        await ioHelper.notify(IO.CDK_TOOLKIT_I5900.msg(chalk.green('\n' + message), deployResult));
        deployDuration = await deploySpan.timing(IO.CDK_TOOLKIT_I5000);

        if (Object.keys(deployResult.outputs).length > 0) {
          const buffer = ['Outputs:'];
          stackOutputs[stack.stackName] = deployResult.outputs;

          for (const name of Object.keys(deployResult.outputs).sort()) {
            const value = deployResult.outputs[name];
            buffer.push(`${chalk.cyan(stack.id)}.${chalk.cyan(name)} = ${chalk.underline(chalk.cyan(value))}`);
          }
          await ioHelper.notify(IO.CDK_TOOLKIT_I5901.msg(buffer.join('\n')));
        }
        await ioHelper.notify(IO.CDK_TOOLKIT_I5901.msg(`Stack ARN:\n${deployResult.stackArn}`));
      } catch (e: any) {
        // It has to be exactly this string because an integration test tests for
        // "bold(stackname) failed: ResourceNotReady: <error>"
        throw new ToolkitError(
          [`❌  ${chalk.bold(stack.stackName)} failed:`, ...(e.name ? [`${e.name}:`] : []), e.message].join(' '),
        );
      } finally {
        if (options.traceLogs) {
          // deploy calls that originate from watch will come with their own cloudWatchLogMonitor
          const cloudWatchLogMonitor = options.cloudWatchLogMonitor ?? new CloudWatchLogEventMonitor({ ioHelper });
          const foundLogGroupsResult = await findCloudWatchLogGroups(await this.sdkProvider('deploy'), ioHelper, stack);
          cloudWatchLogMonitor.addLogGroups(
            foundLogGroupsResult.env,
            foundLogGroupsResult.sdk,
            foundLogGroupsResult.logGroupNames,
          );
          await ioHelper.notify(IO.CDK_TOOLKIT_I5031.msg(`The following log groups are added: ${foundLogGroupsResult.logGroupNames}`));
        }

        // If an outputs file has been specified, create the file path and write stack outputs to it once.
        // Outputs are written after all stacks have been deployed. If a stack deployment fails,
        // all of the outputs from successfully deployed stacks before the failure will still be written.
        if (outputsFile) {
          fs.ensureFileSync(outputsFile);
          await fs.writeJson(outputsFile, stackOutputs, {
            spaces: 2,
            encoding: 'utf8',
          });
        }
      }
      const duration = synthDuration.asMs + (deployDuration?.asMs ?? 0);
      await deploySpan.end(`\n✨  Total time: ${formatTime(duration)}s\n`, { duration });
    };

    const assetBuildTime = options.assetBuildTime ?? AssetBuildTime.ALL_BEFORE_DEPLOY;
    const prebuildAssets = assetBuildTime === AssetBuildTime.ALL_BEFORE_DEPLOY;
    const concurrency = options.concurrency || 1;

    const stacksAndTheirAssetManifests = stacks.flatMap((stack) => [
      stack,
      ...stack.dependencies.filter(x => cxapi.AssetManifestArtifact.isAssetManifestArtifact(x)),
    ]);
    const workGraph = new WorkGraphBuilder(ioHelper, prebuildAssets).build(stacksAndTheirAssetManifests);

    // Unless we are running with '--force', skip already published assets
    if (!options.force) {
      await removePublishedAssets(workGraph, deployments, options);
    }

    const graphConcurrency: Concurrency = {
      'stack': concurrency,
      'asset-build': 1, // This will be CPU-bound/memory bound, mostly matters for Docker builds
      'asset-publish': (options.assetParallelism ?? true) ? 8 : 1, // This will be I/O-bound, 8 in parallel seems reasonable
    };

    await workGraph.doParallel(graphConcurrency, {
      deployStack,
      buildAsset,
      publishAsset,
    });
  }

  /**
   * Watch Action
   *
   * Continuously observe project files and deploy the selected stacks automatically when changes are detected.
   * Implies hotswap deployments.
   */
  public async watch(cx: ICloudAssemblySource, options: WatchOptions): Promise<void> {
    const assembly = await assemblyFromSource(cx, false);
    const ioHelper = asIoHelper(this.ioHost, 'watch');
    const rootDir = options.watchDir ?? process.cwd();

    if (options.include === undefined && options.exclude === undefined) {
      throw new ToolkitError(
        "Cannot use the 'watch' command without specifying at least one directory to monitor. " +
          'Make sure to add a "watch" key to your cdk.json',
      );
    }

    // For the "include" subkey under the "watch" key, the behavior is:
    // 1. No "watch" setting? We error out.
    // 2. "watch" setting without an "include" key? We default to observing "./**".
    // 3. "watch" setting with an empty "include" key? We default to observing "./**".
    // 4. Non-empty "include" key? Just use the "include" key.
    const watchIncludes = patternsArrayForWatch(options.include, {
      rootDir,
      returnRootDirIfEmpty: true,
    });

    // For the "exclude" subkey under the "watch" key,
    // the behavior is to add some default excludes in addition to the ones specified by the user:
    // 1. The CDK output directory.
    // 2. Any file whose name starts with a dot.
    // 3. Any directory's content whose name starts with a dot.
    // 4. Any node_modules and its content (even if it's not a JS/TS project, you might be using a local aws-cli package)
    const outdir = options.outdir ?? 'cdk.out';
    const watchExcludes = patternsArrayForWatch(options.exclude, {
      rootDir,
      returnRootDirIfEmpty: false,
    }).concat(`${outdir}/**`, '**/.*', '**/.*/**', '**/node_modules/**');

    // Print some debug information on computed settings
    await ioHelper.notify(IO.CDK_TOOLKIT_I5310.msg([
      `root directory used for 'watch' is: ${rootDir}`,
      `'include' patterns for 'watch': ${JSON.stringify(watchIncludes)}`,
      `'exclude' patterns for 'watch': ${JSON.stringify(watchExcludes)}`,
    ].join('\n'), {
      watchDir: rootDir,
      includes: watchIncludes,
      excludes: watchExcludes,
    }));

    // Since 'cdk deploy' is a relatively slow operation for a 'watch' process,
    // introduce a concurrency latch that tracks the state.
    // This way, if file change events arrive when a 'cdk deploy' is still executing,
    // we will batch them, and trigger another 'cdk deploy' after the current one finishes,
    // making sure 'cdk deploy's  always execute one at a time.
    // Here's a diagram showing the state transitions:
    // --------------                --------    file changed     --------------    file changed     --------------  file changed
    // |            |  ready event   |      | ------------------> |            | ------------------> |            | --------------|
    // | pre-ready  | -------------> | open |                     | deploying  |                     |   queued   |               |
    // |            |                |      | <------------------ |            | <------------------ |            | <-------------|
    // --------------                --------  'cdk deploy' done  --------------  'cdk deploy' done  --------------
    type LatchState = 'pre-ready' | 'open' | 'deploying' | 'queued';
    let latch: LatchState = 'pre-ready';

    const cloudWatchLogMonitor = options.traceLogs ? new CloudWatchLogEventMonitor({ ioHelper }) : undefined;
    const deployAndWatch = async () => {
      latch = 'deploying' as LatchState;
      await cloudWatchLogMonitor?.deactivate();

      await this.invokeDeployFromWatch(assembly, options, cloudWatchLogMonitor);

      // If latch is still 'deploying' after the 'await', that's fine,
      // but if it's 'queued', that means we need to deploy again
      while (latch === 'queued') {
        // TypeScript doesn't realize latch can change between 'awaits',
        // and thinks the above 'while' condition is always 'false' without the cast
        latch = 'deploying';
        await ioHelper.notify(IO.CDK_TOOLKIT_I5315.msg("Detected file changes during deployment. Invoking 'cdk deploy' again"));
        await this.invokeDeployFromWatch(assembly, options, cloudWatchLogMonitor);
      }
      latch = 'open';
      await cloudWatchLogMonitor?.activate();
    };

    chokidar
      .watch(watchIncludes, {
        ignored: watchExcludes,
        cwd: rootDir,
      })
      .on('ready', async () => {
        latch = 'open';
        await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg("'watch' received the 'ready' event. From now on, all file changes will trigger a deployment"));
        await ioHelper.notify(IO.CDK_TOOLKIT_I5314.msg("Triggering initial 'cdk deploy'"));
        await deployAndWatch();
      })
      .on('all', async (event: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir', filePath: string) => {
        const watchEvent = {
          event,
          path: filePath,
        };
        if (latch === 'pre-ready') {
          await ioHelper.notify(IO.CDK_TOOLKIT_I5311.msg(`'watch' is observing ${event === 'addDir' ? 'directory' : 'the file'} '${filePath}' for changes`, watchEvent));
        } else if (latch === 'open') {
          await ioHelper.notify(IO.CDK_TOOLKIT_I5312.msg(`Detected change to '${filePath}' (type: ${event}). Triggering 'cdk deploy'`, watchEvent));
          await deployAndWatch();
        } else {
          // this means latch is either 'deploying' or 'queued'
          latch = 'queued';
          await ioHelper.notify(IO.CDK_TOOLKIT_I5313.msg(
            `Detected change to '${filePath}' (type: ${event}) while 'cdk deploy' is still running. Will queue for another deployment after this one finishes'`,
            watchEvent,
          ));
        }
      });
  }

  /**
   * Rollback Action
   *
   * Rolls back the selected stacks.
   */
  public async rollback(cx: ICloudAssemblySource, options: RollbackOptions): Promise<void> {
    const assembly = await assemblyFromSource(cx);
    return this._rollback(assembly, 'rollback', options);
  }

  /**
   * Helper to allow rollback being called as part of the deploy or watch action.
   */
  private async _rollback(assembly: StackAssembly, action: 'rollback' | 'deploy' | 'watch', options: RollbackOptions): Promise<void> {
    const ioHelper = asIoHelper(this.ioHost, action);
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: options.stacks });
    const stacks = assembly.selectStacksV2(options.stacks);
    await this.validateStacksMetadata(stacks, ioHelper);
    await synthSpan.end();

    if (stacks.stackCount === 0) {
      await ioHelper.notify(IO.CDK_TOOLKIT_E6001.msg('No stacks selected'));
      return;
    }

    let anyRollbackable = false;

    for (const [index, stack] of stacks.stackArtifacts.entries()) {
      const rollbackSpan = await ioHelper.span(SPAN.ROLLBACK_STACK).begin(`Rolling back ${chalk.bold(stack.displayName)}`, {
        total: stacks.stackCount,
        current: index + 1,
        stack,
      });
      const deployments = await this.deploymentsForAction('rollback');
      try {
        const stackResult = await deployments.rollbackStack({
          stack,
          roleArn: options.roleArn,
          toolkitStackName: this.toolkitStackName,
          force: options.orphanFailedResources,
          validateBootstrapStackVersion: options.validateBootstrapStackVersion,
          orphanLogicalIds: options.orphanLogicalIds,
        });
        if (!stackResult.notInRollbackableState) {
          anyRollbackable = true;
        }
        await rollbackSpan.end();
      } catch (e: any) {
        await ioHelper.notify(IO.CDK_TOOLKIT_E6900.msg(`\n ❌  ${chalk.bold(stack.displayName)} failed: ${formatErrorMessage(e)}`, { error: e }));
        throw new ToolkitError('Rollback failed (use --force to orphan failing resources)');
      }
    }
    if (!anyRollbackable) {
      throw new ToolkitError('No stacks were in a state that could be rolled back');
    }
  }

  /**
   * Destroy Action
   *
   * Destroys the selected Stacks.
   */
  public async destroy(cx: ICloudAssemblySource, options: DestroyOptions): Promise<void> {
    const assembly = await assemblyFromSource(cx);
    return this._destroy(assembly, 'destroy', options);
  }

  /**
   * Helper to allow destroy being called as part of the deploy action.
   */
  private async _destroy(assembly: StackAssembly, action: 'deploy' | 'destroy', options: DestroyOptions): Promise<void> {
    const ioHelper = asIoHelper(this.ioHost, action);
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: options.stacks });
    // The stacks will have been ordered for deployment, so reverse them for deletion.
    const stacks = await assembly.selectStacksV2(options.stacks).reversed();
    await synthSpan.end();

    const motivation = 'Destroying stacks is an irreversible action';
    const question = `Are you sure you want to delete: ${chalk.red(stacks.hierarchicalIds.join(', '))}`;
    const confirmed = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I7010.req(question, { motivation }));
    if (!confirmed) {
      return ioHelper.notify(IO.CDK_TOOLKIT_E7010.msg('Aborted by user'));
    }

    const destroySpan = await ioHelper.span(SPAN.DESTROY_ACTION).begin({
      stacks: stacks.stackArtifacts,
    });
    try {
      for (const [index, stack] of stacks.stackArtifacts.entries()) {
        try {
          const singleDestroySpan = await ioHelper.span(SPAN.DESTROY_STACK)
            .begin(chalk.green(`${chalk.blue(stack.displayName)}: destroying... [${index + 1}/${stacks.stackCount}]`), {
              total: stacks.stackCount,
              current: index + 1,
              stack,
            });
          const deployments = await this.deploymentsForAction(action);
          await deployments.destroyStack({
            stack,
            deployName: stack.stackName,
            roleArn: options.roleArn,
          });
          await ioHelper.notify(IO.CDK_TOOLKIT_I7900.msg(chalk.green(`\n ✅  ${chalk.blue(stack.displayName)}: ${action}ed`), stack));
          await singleDestroySpan.end();
        } catch (e: any) {
          await ioHelper.notify(IO.CDK_TOOLKIT_E7900.msg(`\n ❌  ${chalk.blue(stack.displayName)}: ${action} failed ${e}`, { error: e }));
          throw e;
        }
      }
    } finally {
      await destroySpan.end();
    }
  }

  /**
   * Validate the stacks for errors and warnings according to the CLI's current settings
   */
  private async validateStacksMetadata(stacks: StackCollection, ioHost: IoHelper) {
    const builder = (level: IoMessageLevel) => {
      switch (level) {
        case 'error': return IO.CDK_ASSEMBLY_E9999;
        case 'warn': return IO.CDK_ASSEMBLY_W9999;
        default: return IO.CDK_ASSEMBLY_I9999;
      }
    };
    await stacks.validateMetadata(
      this.props.assemblyFailureAt,
      async (level, msg) => ioHost.notify(builder(level).msg(`[${level} at ${msg.id}] ${msg.entry.data}`, msg)),
    );
  }

  /**
   * Create a deployments class
   */
  private async deploymentsForAction(action: ToolkitAction): Promise<Deployments> {
    return new Deployments({
      sdkProvider: await this.sdkProvider(action),
      toolkitStackName: this.toolkitStackName,
      ioHelper: asIoHelper(this.ioHost, action),
    });
  }

  private async invokeDeployFromWatch(
    assembly: StackAssembly,
    options: WatchOptions,
    cloudWatchLogMonitor?: CloudWatchLogEventMonitor,
  ): Promise<void> {
    // watch defaults hotswap to enabled
    const hotswap = options.hotswap ?? HotswapMode.HOTSWAP_ONLY;
    const deployOptions: ExtendedDeployOptions = {
      ...options,
      requireApproval: RequireApproval.NEVER,
      cloudWatchLogMonitor,
      hotswap,
      extraUserAgent: `cdk-watch/hotswap-${hotswap === HotswapMode.FULL_DEPLOYMENT ? 'off' : 'on'}`,
    };

    try {
      await this._deploy(assembly, 'watch', deployOptions);
    } catch {
      // just continue - deploy will show the error
    }
  }
}
