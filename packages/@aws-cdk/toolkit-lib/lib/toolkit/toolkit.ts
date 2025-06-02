import '../private/dispose-polyfill';
import * as path from 'node:path';
import type { TemplateDiff } from '@aws-cdk/cloudformation-diff';
import * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import * as chokidar from 'chokidar';
import * as fs from 'fs-extra';
import { NonInteractiveIoHost } from './non-interactive-io-host';
import type { ToolkitServices } from './private';
import { assemblyFromSource } from './private';
import { ToolkitError } from './toolkit-error';
import type { DeployResult, DestroyResult, RollbackResult } from './types';
import type {
  BootstrapEnvironments,
  BootstrapOptions,
  BootstrapResult,
  EnvironmentBootstrapResult,
} from '../actions/bootstrap';
import { BootstrapSource } from '../actions/bootstrap';
import { AssetBuildTime, type DeployOptions } from '../actions/deploy';
import {
  buildParameterMap,
  type PrivateDeployOptions,
  removePublishedAssetsFromWorkGraph,
} from '../actions/deploy/private';
import { type DestroyOptions } from '../actions/destroy';
import type { DiffOptions } from '../actions/diff';
import { appendObject, prepareDiff } from '../actions/diff/private';
import type { DriftOptions, DriftResult } from '../actions/drift';
import { type ListOptions } from '../actions/list';
import type { MappingGroup, RefactorOptions } from '../actions/refactor';
import { type RollbackOptions } from '../actions/rollback';
import { type SynthOptions } from '../actions/synth';
import type { IWatcher, WatchOptions } from '../actions/watch';
import { WATCH_EXCLUDE_DEFAULTS } from '../actions/watch/private';
import {
  BaseCredentials,
  type IBaseCredentialsProvider,
  type SdkBaseClientConfig,
  type SdkConfig,
} from '../api/aws-auth';
import { sdkRequestHandler } from '../api/aws-auth/awscli-compatible';
import { IoHostSdkLogger, SdkProvider } from '../api/aws-auth/private';
import { Bootstrapper } from '../api/bootstrap';
import type { ICloudAssemblySource } from '../api/cloud-assembly';
import { CachedCloudAssembly, StackSelectionStrategy } from '../api/cloud-assembly';
import type { StackAssembly } from '../api/cloud-assembly/private';
import { ALL_STACKS } from '../api/cloud-assembly/private';
import { CloudAssemblySourceBuilder } from '../api/cloud-assembly/source-builder';
import type { StackCollection } from '../api/cloud-assembly/stack-collection';
import { Deployments } from '../api/deployments';
import { DiffFormatter } from '../api/diff';
import { detectStackDrift } from '../api/drift';
import { DriftFormatter } from '../api/drift/drift-formatter';
import type { IIoHost, IoMessageLevel, ToolkitAction } from '../api/io';
import type { IoHelper } from '../api/io/private';
import { asIoHelper, IO, SPAN, withoutColor, withoutEmojis, withTrimmedWhitespace } from '../api/io/private';
import { CloudWatchLogEventMonitor, findCloudWatchLogGroups } from '../api/logs-monitor';
import { Mode, PluginHost } from '../api/plugin';
import {
  formatAmbiguitySectionHeader,
  formatAmbiguousMappings, formatMappingsHeader,
  formatTypedMappings,
  fromManifestAndExclusionList,
  getDeployedStacks,
  usePrescribedMappings,
} from '../api/refactoring';
import type { CloudFormationStack, ResourceMapping } from '../api/refactoring/cloudformation';
import { RefactoringContext } from '../api/refactoring/context';
import { hashObject } from '../api/refactoring/digest';
import { ResourceMigrator } from '../api/resource-import';
import { tagsForStack } from '../api/tags';
import { DEFAULT_TOOLKIT_STACK_NAME } from '../api/toolkit-info';
import type { AssetBuildNode, AssetPublishNode, Concurrency, StackNode } from '../api/work-graph';
import { WorkGraphBuilder } from '../api/work-graph';
import type { AssemblyData, StackDetails, SuccessfulDeployStackResult } from '../payloads';
import { PermissionChangeType } from '../payloads';
import { formatErrorMessage, formatTime, obscureTemplate, serializeStructure, validateSnsTopicArn } from '../util';
import { pLimit } from '../util/concurrency';
import { promiseWithResolvers } from '../util/promises';

export interface ToolkitOptions {
  /**
   * The IoHost implementation, handling the inline interactions between the Toolkit and an integration.
   */
  readonly ioHost?: IIoHost;

  /**
   * Allow emojis in messages sent to the IoHost.
   *
   * @default true
   */
  readonly emojis?: boolean;

  /**
   * Whether to allow ANSI colors and formatting in IoHost messages.
   * Setting this value to `false` enforces that no color or style shows up
   * in messages sent to the IoHost.
   * Setting this value to true is a no-op; it is equivalent to the default.
   *
   * @default - detects color from the TTY status of the IoHost
   */
  readonly color?: boolean;

  /**
   * Configuration options for the SDK.
   */
  readonly sdkConfig?: SdkConfig;

  /**
   * Name of the toolkit stack to be used.
   *
   * @default "CDKToolkit"
   */
  readonly toolkitStackName?: string;

  /**
   * Fail Cloud Assemblies
   *
   * @default "error"
   */
  readonly assemblyFailureAt?: 'error' | 'warn' | 'none';

  /**
   * The plugin host to use for loading and querying plugins
   *
   * By default, a unique instance of a plugin managing class will be used.
   *
   * Use `toolkit.pluginHost.load()` to load plugins into the plugin host from disk.
   *
   * @default - A fresh plugin host
   */
  readonly pluginHost?: PluginHost;

  /**
   * Set of unstable features to opt into. If you are using an unstable feature,
   * you must explicitly acknowledge that you are aware of the risks of using it,
   * by passing it in this set.
   */
  readonly unstableFeatures?: Array<UnstableFeature>;
}

interface StackGroup {
  environment: cxapi.Environment;
  localStacks: CloudFormationStack[];
  deployedStacks: CloudFormationStack[];
}

/**
 * Names of toolkit features that are still under development, and may change in
 * the future.
 */
export type UnstableFeature = 'refactor';

/**
 * The AWS CDK Programmatic Toolkit
 */
export class Toolkit extends CloudAssemblySourceBuilder {
  /**
   * The toolkit stack name used for bootstrapping resources.
   */
  public readonly toolkitStackName: string;

  /**
   * The IoHost of this Toolkit
   */
  public readonly ioHost: IIoHost;

  /**
   * The plugin host for loading and managing plugins
   */
  public readonly pluginHost: PluginHost;

  /**
   * Cache of the internal SDK Provider instance
   */
  private sdkProviderCache?: SdkProvider;

  private baseCredentials: IBaseCredentialsProvider;

  private readonly unstableFeatures: Array<UnstableFeature>;

  public constructor(private readonly props: ToolkitOptions = {}) {
    super();
    this.toolkitStackName = props.toolkitStackName ?? DEFAULT_TOOLKIT_STACK_NAME;

    this.pluginHost = props.pluginHost ?? new PluginHost();

    let ioHost = props.ioHost ?? new NonInteractiveIoHost();
    if (props.emojis === false) {
      ioHost = withoutEmojis(ioHost);
    }
    if (props.color === false) {
      ioHost = withoutColor(ioHost);
    }
    // After removing emojis and color, we might end up with floating whitespace at either end of the message
    // This also removes newlines that we currently emit for CLI backwards compatibility.
    this.ioHost = withTrimmedWhitespace(ioHost);

    this.baseCredentials = props.sdkConfig?.baseCredentials ?? BaseCredentials.awsCliCompatible();
    this.unstableFeatures = props.unstableFeatures ?? [];
  }

  /**
   * Access to the AWS SDK
   * @internal
   */
  protected async sdkProvider(action: ToolkitAction): Promise<SdkProvider> {
    // @todo this needs to be different instance per action
    if (!this.sdkProviderCache) {
      const ioHelper = asIoHelper(this.ioHost, action);
      const clientConfig: SdkBaseClientConfig = {
        requestHandler: sdkRequestHandler(this.props.sdkConfig?.httpOptions?.agent),
      };

      const config = await this.baseCredentials.sdkBaseConfig(ioHelper, clientConfig);
      this.sdkProviderCache = new SdkProvider(config.credentialProvider, config.defaultRegion, {
        ioHelper,
        logger: new IoHostSdkLogger(ioHelper),
        pluginHost: this.pluginHost,
        requestHandler: clientConfig.requestHandler,
      });
    }

    return this.sdkProviderCache;
  }

  /**
   * Helper to provide the CloudAssemblySourceBuilder with required toolkit services
   * @internal
   */
  protected override async sourceBuilderServices(): Promise<ToolkitServices> {
    return {
      ioHelper: asIoHelper(this.ioHost, 'assembly'),
      sdkProvider: await this.sdkProvider('assembly'),
      pluginHost: this.pluginHost,
    };
  }

  /**
   * Bootstrap Action
   */
  public async bootstrap(environments: BootstrapEnvironments, options: BootstrapOptions = {}): Promise<BootstrapResult> {
    const startTime = Date.now();
    const results: EnvironmentBootstrapResult[] = [];

    const ioHelper = asIoHelper(this.ioHost, 'bootstrap');
    const bootstrapEnvironments = await environments.getEnvironments(this.ioHost);
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
          current: currentIdx + 1,
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
   *
   * The caller assumes ownership of the `CachedCloudAssembly` and is responsible for calling `dispose()` on
   * it after use.
   */
  public async synth(cx: ICloudAssemblySource, options: SynthOptions = {}): Promise<CachedCloudAssembly> {
    const ioHelper = asIoHelper(this.ioHost, 'synth');
    const selectStacks = options.stacks ?? ALL_STACKS;
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });

    // NOTE: NOT 'await using' because we return ownership to the caller
    const assembly = await assemblyFromSource(synthSpan.asHelper, cx);

    const stacks = await assembly.selectStacksV2(selectStacks);
    const autoValidateStacks = options.validateStacks ? [assembly.selectStacksForValidation()] : [];
    await this.validateStacksMetadata(stacks.concat(...autoValidateStacks), synthSpan.asHelper);
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
      await ioHelper.defaults.info(`Supply a stack id (${stacks.stackArtifacts.map((s) => chalk.green(s.hierarchicalId)).join(', ')}) to display its template.`);
    }

    return new CachedCloudAssembly(assembly);
  }

  /**
   * Diff Action
   */
  public async diff(cx: ICloudAssemblySource, options: DiffOptions = {}): Promise<{ [name: string]: TemplateDiff }> {
    const ioHelper = asIoHelper(this.ioHost, 'diff');
    const selectStacks = options.stacks ?? ALL_STACKS;
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });
    await using assembly = await assemblyFromSource(synthSpan.asHelper, cx);
    const stacks = await assembly.selectStacksV2(selectStacks);
    await synthSpan.end();

    const diffSpan = await ioHelper.span(SPAN.DIFF_STACK).begin({ stacks: selectStacks });
    const deployments = await this.deploymentsForAction('diff');

    const strict = !!options.strict;
    const contextLines = options.contextLines || 3;

    let diffs = 0;

    const templateInfos = await prepareDiff(diffSpan.asHelper, stacks, deployments, await this.sdkProvider('diff'), options);
    const templateDiffs: { [name: string]: TemplateDiff } = {};
    for (const templateInfo of templateInfos) {
      const formatter = new DiffFormatter({ templateInfo });
      const stackDiff = formatter.formatStackDiff({ strict, contextLines });

      // Security Diff
      const securityDiff = formatter.formatSecurityDiff();
      const formattedSecurityDiff = securityDiff.permissionChangeType !== PermissionChangeType.NONE ? stackDiff.formattedDiff : undefined;
      // We only warn about BROADENING changes
      if (securityDiff.permissionChangeType == PermissionChangeType.BROADENING) {
        const warningMessage = 'This deployment will make potentially sensitive changes according to your current security approval level.\nPlease confirm you intend to make the following modifications:\n';
        await diffSpan.defaults.warn(warningMessage);
        await diffSpan.defaults.info(securityDiff.formattedDiff);
      }

      // Stack Diff
      diffs += stackDiff.numStacksWithChanges;
      appendObject(templateDiffs, formatter.diffs);
      await diffSpan.notify(IO.CDK_TOOLKIT_I4002.msg(stackDiff.formattedDiff, {
        stack: templateInfo.newTemplate,
        diffs: formatter.diffs,
        numStacksWithChanges: stackDiff.numStacksWithChanges,
        permissionChanges: securityDiff.permissionChangeType,
        formattedDiff: {
          diff: stackDiff.formattedDiff,
          security: formattedSecurityDiff,
        },
      }));
    }

    await diffSpan.end(`✨ Number of stacks with differences: ${diffs}`, {
      numStacksWithChanges: diffs,
      diffs: templateDiffs,
    });

    return templateDiffs;
  }

  /**
   * Drift Action
   */
  public async drift(cx: ICloudAssemblySource, options: DriftOptions = {}): Promise<{ [name: string]: DriftResult }> {
    const ioHelper = asIoHelper(this.ioHost, 'drift');
    const selectStacks = options.stacks ?? ALL_STACKS;
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });
    await using assembly = await assemblyFromSource(synthSpan.asHelper, cx);
    const stacks = await assembly.selectStacksV2(selectStacks);
    await synthSpan.end();

    const driftSpan = await ioHelper.span(SPAN.DRIFT_APP).begin({ stacks: selectStacks });
    const allDriftResults: { [name: string]: DriftResult } = {};
    const unavailableDrifts = [];
    const sdkProvider = await this.sdkProvider('drift');

    for (const stack of stacks.stackArtifacts) {
      const cfn = (await sdkProvider.forEnvironment(stack.environment, Mode.ForReading)).sdk.cloudFormation();
      const driftResults = await detectStackDrift(cfn, driftSpan.asHelper, stack.stackName);

      if (!driftResults.StackResourceDrifts) {
        const stackName = stack.displayName ?? stack.stackName;
        unavailableDrifts.push(stackName);
        await driftSpan.notify(IO.CDK_TOOLKIT_W4591.msg(`${stackName}: No drift results available`, { stack }));
        continue;
      }

      const formatter = new DriftFormatter({ stack, resourceDrifts: driftResults.StackResourceDrifts });
      const driftOutput = formatter.formatStackDrift();
      const stackDrift = {
        numResourcesWithDrift: driftOutput.numResourcesWithDrift,
        numResourcesUnchecked: driftOutput.numResourcesUnchecked,
        formattedDrift: {
          unchanged: driftOutput.unchanged,
          unchecked: driftOutput.unchecked,
          modified: driftOutput.modified,
          deleted: driftOutput.deleted,
        },
      };
      allDriftResults[formatter.stackName] = stackDrift;

      // header
      await driftSpan.defaults.info(driftOutput.stackHeader);

      // print the different sections at different levels
      if (driftOutput.unchanged) {
        await driftSpan.defaults.debug(driftOutput.unchanged);
      }
      if (driftOutput.unchecked) {
        await driftSpan.defaults.debug(driftOutput.unchecked);
      }
      if (driftOutput.modified) {
        await driftSpan.defaults.info(driftOutput.modified);
      }
      if (driftOutput.deleted) {
        await driftSpan.defaults.info(driftOutput.deleted);
      }

      // main stack result
      await driftSpan.notify(IO.CDK_TOOLKIT_I4590.msg(driftOutput.summary, {
        stack,
        drift: stackDrift,
      }));
    }

    // print summary
    const totalDrifts = Object.values(allDriftResults).reduce((total, current) => total + (current.numResourcesWithDrift ?? 0), 0);
    const totalUnchecked = Object.values(allDriftResults).reduce((total, current) => total + (current.numResourcesUnchecked ?? 0), 0);
    await driftSpan.end(`\n✨  Number of resources with drift: ${totalDrifts}${totalUnchecked ? ` (${totalUnchecked} unchecked)` : ''}`);
    if (unavailableDrifts.length) {
      await driftSpan.defaults.warn(`\n⚠️  Failed to check drift for ${unavailableDrifts.length} stack(s). Check log for more details.`);
    }

    return allDriftResults;
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
    await using assembly = await assemblyFromSource(ioHelper, cx);
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
  public async deploy(cx: ICloudAssemblySource, options: DeployOptions = {}): Promise<DeployResult> {
    const ioHelper = asIoHelper(this.ioHost, 'deploy');
    await using assembly = await assemblyFromSource(ioHelper, cx);
    return await this._deploy(assembly, 'deploy', options);
  }

  /**
   * Helper to allow deploy being called as part of the watch action.
   */
  private async _deploy(assembly: StackAssembly, action: 'deploy' | 'watch', options: PrivateDeployOptions = {}): Promise<DeployResult> {
    const ioHelper = asIoHelper(this.ioHost, action);
    const selectStacks = options.stacks ?? ALL_STACKS;
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });
    const stackCollection = await assembly.selectStacksV2(selectStacks);
    await this.validateStacksMetadata(stackCollection, ioHelper);
    const synthDuration = await synthSpan.end();

    const ret: DeployResult = {
      stacks: [],
    };

    if (stackCollection.stackCount === 0) {
      await ioHelper.notify(IO.CDK_TOOLKIT_E5001.msg('This app contains no stacks'));
      return ret;
    }

    const deployments = await this.deploymentsForAction('deploy');
    const migrator = new ResourceMigrator({ deployments, ioHelper });

    await migrator.tryMigrateResources(stackCollection, options);

    const parameterMap = buildParameterMap(options.parameters?.parameters);

    if (options.deploymentMethod?.method === 'hotswap') {
      await ioHelper.notify(IO.CDK_TOOLKIT_W5400.msg([
        '⚠️ Hotswap deployments deliberately introduce CloudFormation drift to speed up deployments',
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
        forcePublish: options.forceAssetPublishing,
      });
      await publishAssetSpan.end();
    };

    const deployStack = async (stackNode: StackNode) => {
      const stack = stackNode.stack;
      if (stackCollection.stackCount !== 1) {
        await ioHelper.defaults.info(chalk.bold(stack.displayName));
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
        });

        return;
      }

      const currentTemplate = await deployments.readCurrentTemplate(stack);

      const formatter = new DiffFormatter({
        templateInfo: {
          oldTemplate: currentTemplate,
          newTemplate: stack,
        },
      });

      const securityDiff = formatter.formatSecurityDiff();

      // Send a request response with the formatted security diff as part of the message,
      // and the template diff as data
      // (IoHost decides whether to print depending on permissionChangeType)
      const deployMotivation = '"--require-approval" is enabled and stack includes security-sensitive updates.';
      const deployQuestion = `${securityDiff.formattedDiff}\n\n${deployMotivation}\nDo you wish to deploy these changes`;
      const deployConfirmed = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I5060.req(deployQuestion, {
        motivation: deployMotivation,
        concurrency,
        permissionChangeType: securityDiff.permissionChangeType,
        templateDiffs: formatter.diffs,
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
            forceDeployment: options.forceDeployment,
            parameters: Object.assign({}, parameterMap['*'], parameterMap[stack.stackName]),
            usePreviousParameters: options.parameters?.keepExistingParameters,
            rollback,
            extraUserAgent: options.extraUserAgent,
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

              const confirmed = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I5050.req(question, {
                motivation,
                concurrency,
              }));
              if (!confirmed) {
                throw new ToolkitError('Aborted by user');
              }

              // Perform a rollback
              await this._rollback(assembly, action, {
                stacks: {
                  patterns: [stack.hierarchicalId],
                  strategy: StackSelectionStrategy.PATTERN_MUST_MATCH_SINGLE,
                },
                orphanFailedResources: options.orphanFailedResourcesDuringRollback,
              });

              // Go around through the 'while' loop again but switch rollback to true.
              rollback = true;
              break;
            }

            case 'replacement-requires-rollback': {
              const motivation = 'Change includes a replacement which cannot be deployed with "--no-rollback"';
              const question = `${motivation}. Perform a regular deployment`;

              const confirmed = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I5050.req(question, {
                motivation,
                concurrency,
              }));
              if (!confirmed) {
                throw new ToolkitError('Aborted by user');
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

        ret.stacks.push({
          stackName: stack.stackName,
          environment: {
            account: stack.environment.account,
            region: stack.environment.region,
          },
          stackArn: deployResult.stackArn,
          outputs: deployResult.outputs,
          hierarchicalId: stack.hierarchicalId,
        });
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
    if (!options.forceAssetPublishing) {
      await removePublishedAssetsFromWorkGraph(workGraph, deployments, options);
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

    return ret;
  }

  /**
   * Watch Action
   *
   * Continuously observe project files and deploy the selected stacks
   * automatically when changes are detected. Defaults to hotswap deployments.
   *
   * This function returns immediately, starting a watcher in the background.
   */
  public async watch(cx: ICloudAssemblySource, options: WatchOptions = {}): Promise<IWatcher> {
    const ioHelper = asIoHelper(this.ioHost, 'watch');
    await using assembly = await assemblyFromSource(ioHelper, cx, false);
    const rootDir = options.watchDir ?? process.cwd();

    // For the "include" setting, the behavior is:
    // 1. "watch" setting without an "include" key? We default to observing "**".
    // 2. "watch" setting with an empty "include" key? We default to observing "**".
    // 3. Non-empty "include" key? Just use the "include" key.
    const watchIncludes = options.include ?? [];
    if (watchIncludes.length <= 0) {
      watchIncludes.push('**');
    }

    // For the "exclude" setting, the behavior is to add some default excludes in addition to
    // patterns specified by the user orr the default patterns:
    const watchExcludes = options.exclude ?? WATCH_EXCLUDE_DEFAULTS;
    // 1. The CDK output directory, if it is under the rootDir
    const relativeOutDir = path.relative(rootDir, assembly.directory);
    if (Boolean(relativeOutDir && !relativeOutDir.startsWith('..' + path.sep) && !path.isAbsolute(relativeOutDir))) {
      watchExcludes.push(`${relativeOutDir}/**`);
    }
    // 2. Any file whose name starts with a dot.
    watchExcludes.push('.*', '**/.*');
    // 3. Any directory's content whose name starts with a dot.
    watchExcludes.push('**/.*/**');
    // 4. Any node_modules and its content (even if it's not a JS/TS project, you might be using a local aws-cli package)
    watchExcludes.push('**/node_modules/**');

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

    const watcher = chokidar
      .watch(watchIncludes, {
        ignored: watchExcludes,
        cwd: rootDir,
      })
      .on('ready', async () => {
        latch = 'open';
        await ioHelper.defaults.debug("'watch' received the 'ready' event. From now on, all file changes will trigger a deployment");
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

    const stoppedPromise = promiseWithResolvers<void>();

    return {
      async dispose() {
        await watcher.close();
        // Prevents Node from staying alive. There is no 'end' event that the watcher emits
        // that we can know it's definitely done, so best we can do is tell it to stop watching,
        // stop keeping Node alive, and then pretend that's everything we needed to do.
        watcher.unref();
        stoppedPromise.resolve();
        return stoppedPromise.promise;
      },
      async waitForEnd() {
        return stoppedPromise.promise;
      },
      async [Symbol.asyncDispose]() {
        return this.dispose();
      },
    } satisfies IWatcher;
  }

  /**
   * Rollback Action
   *
   * Rolls back the selected stacks.
   */
  public async rollback(cx: ICloudAssemblySource, options: RollbackOptions = {}): Promise<RollbackResult> {
    const ioHelper = asIoHelper(this.ioHost, 'rollback');
    await using assembly = await assemblyFromSource(ioHelper, cx);
    return await this._rollback(assembly, 'rollback', options);
  }

  /**
   * Helper to allow rollback being called as part of the deploy or watch action.
   */
  private async _rollback(assembly: StackAssembly, action: 'rollback' | 'deploy' | 'watch', options: RollbackOptions): Promise<RollbackResult> {
    const selectStacks = options.stacks ?? ALL_STACKS;
    const ioHelper = asIoHelper(this.ioHost, action);
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });
    const stacks = await assembly.selectStacksV2(selectStacks);
    await this.validateStacksMetadata(stacks, ioHelper);
    await synthSpan.end();

    const ret: RollbackResult = {
      stacks: [],
    };

    if (stacks.stackCount === 0) {
      await ioHelper.notify(IO.CDK_TOOLKIT_E6001.msg('No stacks selected'));
      return ret;
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
          orphanFailedResources: options.orphanFailedResources,
          validateBootstrapStackVersion: options.validateBootstrapStackVersion,
          orphanLogicalIds: options.orphanLogicalIds,
        });
        if (!stackResult.notInRollbackableState) {
          anyRollbackable = true;
        }
        await rollbackSpan.end();

        ret.stacks.push({
          environment: {
            account: stack.environment.account,
            region: stack.environment.region,
          },
          stackName: stack.stackName,
          stackArn: stackResult.stackArn,
          result: stackResult.notInRollbackableState ? 'already-stable' : 'rolled-back',
        });
      } catch (e: any) {
        await ioHelper.notify(IO.CDK_TOOLKIT_E6900.msg(`\n ❌  ${chalk.bold(stack.displayName)} failed: ${formatErrorMessage(e)}`, { error: e }));
        throw ToolkitError.withCause('Rollback failed (use --force to orphan failing resources)', e);
      }
    }
    if (!anyRollbackable) {
      throw new ToolkitError('No stacks were in a state that could be rolled back');
    }

    return ret;
  }

  /**
   * Refactor Action. Moves resources from one location (stack + logical ID) to another.
   */
  public async refactor(cx: ICloudAssemblySource, options: RefactorOptions = {}): Promise<void> {
    this.requireUnstableFeature('refactor');

    const ioHelper = asIoHelper(this.ioHost, 'refactor');
    const assembly = await assemblyFromSource(ioHelper, cx);
    return this._refactor(assembly, ioHelper, options);
  }

  private async _refactor(assembly: StackAssembly, ioHelper: IoHelper, options: RefactorOptions = {}): Promise<void> {
    if (options.mappings && options.exclude) {
      throw new ToolkitError("Cannot use both 'exclude' and 'mappings'.");
    }

    if (options.revert && !options.mappings) {
      throw new ToolkitError("The 'revert' options can only be used with the 'mappings' option.");
    }

    if (!options.dryRun) {
      throw new ToolkitError('Refactor is not available yet. Too see the proposed changes, use the --dry-run flag.');
    }

    const sdkProvider = await this.sdkProvider('refactor');
    const stacks = await assembly.selectStacksV2(ALL_STACKS);
    const exclude = fromManifestAndExclusionList(assembly.cloudAssembly.manifest, options.exclude);
    const filteredStacks = await assembly.selectStacksV2(options.stacks ?? ALL_STACKS);

    const refactoringContexts: RefactoringContext[] = [];
    for (let { environment, localStacks, deployedStacks } of await groupStacksByEnvironment()) {
      refactoringContexts.push(new RefactoringContext({
        environment,
        deployedStacks,
        localStacks,
        filteredStacks: filteredStacks.stackArtifacts,
        mappings: await getUserProvidedMappings(),
      }));
    }

    const nonAmbiguousContexts = refactoringContexts.filter(c => !c.isAmbiguous);
    if (nonAmbiguousContexts.length > 0) {
      await ioHelper.notify(IO.CDK_TOOLKIT_I8900.msg(formatMappingsHeader(), {}));
    }
    for (const context of nonAmbiguousContexts) {
      const mappings = context.mappings.filter((m) => !exclude.isExcluded(m.destination));
      const typedMappings = mappings.map(m => m.toTypedMapping());
      const environment = context.environment;
      await ioHelper.notify(IO.CDK_TOOLKIT_I8900.msg(formatTypedMappings(environment, typedMappings), {
        typedMappings,
      }));
    }

    const ambiguousContexts = refactoringContexts.filter(c => c.isAmbiguous);
    if (ambiguousContexts.length > 0) {
      await ioHelper.notify(IO.CDK_TOOLKIT_I8900.msg(formatAmbiguitySectionHeader(), {}));
    }
    for (const context of ambiguousContexts) {
      const paths = context.ambiguousPaths;
      const environment = context.environment;
      await ioHelper.notify(IO.CDK_TOOLKIT_I8900.msg(formatAmbiguousMappings(environment, paths), {
        ambiguousPaths: paths,
      }));
    }

    async function groupStacksByEnvironment(): Promise<StackGroup[]> {
      const stackGroups: Map<string, [CloudFormationStack[], CloudFormationStack[]]> = new Map();
      const environments: Map<string, cxapi.Environment> = new Map();

      for (const stack of stacks.stackArtifacts) {
        const environment = stack.environment;
        const key = hashObject(environment);
        environments.set(key, environment);
        if (stackGroups.has(key)) {
          stackGroups.get(key)![1].push(stack);
        } else {
          // The first time we see an environment, we need to fetch all stacks deployed to it.
          const before = await getDeployedStacks(sdkProvider, environment);
          stackGroups.set(key, [before, [stack]]);
        }
      }

      const result: StackGroup[] = [];
      for (const [hash, [deployedStacks, localStacks]] of stackGroups) {
        result.push({
          environment: environments.get(hash)!,
          localStacks,
          deployedStacks,
        });
      }
      return result;
    }

    async function getUserProvidedMappings(): Promise<ResourceMapping[] | undefined> {
      if (options.revert) {
        return usePrescribedMappings(revert(options.mappings ?? []), sdkProvider);
      }
      if (options.mappings != null) {
        return usePrescribedMappings(options.mappings ?? [], sdkProvider);
      }
      return undefined;
    }

    function revert(mappings: MappingGroup[]): MappingGroup[] {
      return mappings.map(group => ({
        ...group,
        resources: Object.fromEntries(Object.entries(group.resources).map(([src, dst]) => ([dst, src]))),
      }));
    }
  }

  /**
   * Destroy Action
   *
   * Destroys the selected Stacks.
   */
  public async destroy(cx: ICloudAssemblySource, options: DestroyOptions = {}): Promise<DestroyResult> {
    const ioHelper = asIoHelper(this.ioHost, 'destroy');
    await using assembly = await assemblyFromSource(ioHelper, cx);
    return await this._destroy(assembly, 'destroy', options);
  }

  /**
   * Helper to allow destroy being called as part of the deploy action.
   */
  private async _destroy(assembly: StackAssembly, action: 'deploy' | 'destroy', options: DestroyOptions): Promise<DestroyResult> {
    const selectStacks = options.stacks ?? ALL_STACKS;
    const ioHelper = asIoHelper(this.ioHost, action);
    const synthSpan = await ioHelper.span(SPAN.SYNTH_ASSEMBLY).begin({ stacks: selectStacks });
    // The stacks will have been ordered for deployment, so reverse them for deletion.
    const stacks = (await assembly.selectStacksV2(selectStacks)).reversed();
    await synthSpan.end();

    const ret: DestroyResult = {
      stacks: [],
    };

    const motivation = 'Destroying stacks is an irreversible action';
    const question = `Are you sure you want to delete: ${chalk.red(stacks.hierarchicalIds.join(', '))}`;
    const confirmed = await ioHelper.requestResponse(IO.CDK_TOOLKIT_I7010.req(question, { motivation }));
    if (!confirmed) {
      await ioHelper.notify(IO.CDK_TOOLKIT_E7010.msg('Aborted by user'));
      return ret;
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
          const result = await deployments.destroyStack({
            stack,
            deployName: stack.stackName,
            roleArn: options.roleArn,
          });

          ret.stacks.push({
            environment: {
              account: stack.environment.account,
              region: stack.environment.region,
            },
            stackName: stack.stackName,
            stackArn: result.stackArn,
            stackExisted: result.stackArn !== undefined,
          });

          await ioHelper.notify(IO.CDK_TOOLKIT_I7900.msg(chalk.green(`\n ✅  ${chalk.blue(stack.displayName)}: ${action}ed`), stack));
          await singleDestroySpan.end();
        } catch (e: any) {
          await ioHelper.notify(IO.CDK_TOOLKIT_E7900.msg(`\n ❌  ${chalk.blue(stack.displayName)}: ${action} failed ${e}`, { error: e }));
          throw e;
        }
      }

      return ret;
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
        case 'error':
          return IO.CDK_ASSEMBLY_E9999;
        case 'warn':
          return IO.CDK_ASSEMBLY_W9999;
        default:
          return IO.CDK_ASSEMBLY_I9999;
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
    // watch defaults to hotswap deployment
    const deploymentMethod = options.deploymentMethod ?? { method: 'hotswap' };
    const deployOptions: PrivateDeployOptions = {
      ...options,
      cloudWatchLogMonitor,
      deploymentMethod,
      extraUserAgent: `cdk-watch/hotswap-${deploymentMethod.method === 'hotswap' ? 'on' : 'off'}`,
    };

    try {
      await this._deploy(assembly, 'watch', deployOptions);
    } catch {
      // just continue - deploy will show the error
    }
  }

  private requireUnstableFeature(requestedFeature: UnstableFeature) {
    if (!this.unstableFeatures.includes(requestedFeature)) {
      throw new ToolkitError(`Unstable feature '${requestedFeature}' is not enabled. Please enable it under 'unstableFeatures'`);
    }
  }
}
