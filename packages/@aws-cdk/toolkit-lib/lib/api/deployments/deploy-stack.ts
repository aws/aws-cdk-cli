import { format } from 'util';
import type * as cxapi from '@aws-cdk/cx-api';
import type {
  CreateChangeSetCommandInput,
  CreateStackCommandInput,
  DescribeChangeSetCommandOutput,
  ExecuteChangeSetCommandInput,
  UpdateStackCommandInput,
  Tag,
} from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import * as uuid from 'uuid';
import { AssetManifestBuilder } from './asset-manifest-builder';
import { publishAssets } from './asset-publishing';
import { addMetadataAssetsToManifest } from './assets';
import type {
  ParameterValues,
  ParameterChanges,
} from './cfn-api';
import {
  changeSetHasNoChanges,
  TemplateParameters,
  waitForChangeSet,
  waitForStackDeploy,
  waitForStackDelete,
} from './cfn-api';
import { determineAllowCrossAccountAssetPublishing } from './checks';
import type { DeployStackResult, SuccessfulDeployStackResult } from './deployment-result';
import type { ChangeSetDeployment, DeploymentMethod, DirectDeployment } from '../../actions/deploy';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { formatErrorMessage } from '../../util';
import type { SDK, SdkProvider, ICloudFormationClient } from '../aws-auth/private';
import type { TemplateBodyParameter } from '../cloudformation';
import { makeBodyParameter, CfnEvaluationException, CloudFormationStack } from '../cloudformation';
import type { EnvironmentResources, StringWithoutPlaceholders } from '../environment';
import { HotswapPropertyOverrides, HotswapMode, ICON, createHotswapPropertyOverrides } from '../hotswap/common';
import { tryHotswapDeployment } from '../hotswap/hotswap-deployments';
import type { IoHelper } from '../io/private';
import type { ResourcesToImport } from '../resource-import';
import { StackActivityMonitor } from '../stack-events';

export interface DeployStackOptions {
  /**
   * The stack to be deployed
   */
  readonly stack: cxapi.CloudFormationStackArtifact;

  /**
   * The environment to deploy this stack in
   *
   * The environment on the stack artifact may be unresolved, this one
   * must be resolved.
   */
  readonly resolvedEnvironment: cxapi.Environment;

  /**
   * The SDK to use for deploying the stack
   *
   * Should have been initialized with the correct role with which
   * stack operations should be performed.
   */
  readonly sdk: SDK;

  /**
   * SDK provider (seeded with default credentials)
   *
   * Will be used to:
   *
   * - Publish assets, either legacy assets or large CFN templates
   *   that aren't themselves assets from a manifest. (Needs an SDK
   *   Provider because the file publishing role is declared as part
   *   of the asset).
   * - Hotswap
   */
  readonly sdkProvider: SdkProvider;

  /**
   * Information about the bootstrap stack found in the target environment
   */
  readonly envResources: EnvironmentResources;

  /**
   * Role to pass to CloudFormation to execute the change set
   *
   * To obtain a `StringWithoutPlaceholders`, run a regular
   * string though `TargetEnvironment.replacePlaceholders`.
   *
   * @defaultValue - No execution role; CloudFormation either uses the role currently associated with
   * the stack, or otherwise uses current AWS credentials.
   */
  readonly roleArn?: StringWithoutPlaceholders;

  /**
   * Notification ARNs to pass to CloudFormation to notify when the change set has completed
   *
   * @defaultValue - No notifications
   */
  readonly notificationArns?: string[];

  /**
   * Name to deploy the stack under
   *
   * @defaultValue - Name from assembly
   */
  readonly deployName?: string;

  /**
   * List of asset IDs which shouldn't be built
   *
   * @defaultValue - Build all assets
   */
  readonly reuseAssets?: string[];

  /**
   * Tags to pass to CloudFormation to add to stack
   *
   * @defaultValue - No tags
   */
  readonly tags?: Tag[];

  /**
   * What deployment method to use
   *
   * @defaultValue - Change set with defaults
   */
  readonly deploymentMethod?: DeploymentMethod;

  /**
   * The collection of extra parameters
   * (in addition to those used for assets)
   * to pass to the deployed template.
   * Note that parameters with `undefined` or empty values will be ignored,
   * and not passed to the template.
   *
   * @defaultValue - no additional parameters will be passed to the template
   */
  readonly parameters?: { [name: string]: string | undefined };

  /**
   * Use previous values for unspecified parameters
   *
   * If not set, all parameters must be specified for every deployment.
   *
   * @defaultValue false
   */
  readonly usePreviousParameters?: boolean;

  /**
   * Deploy even if the deployed template is identical to the one we are about to deploy.
   * @defaultValue false
   */
  readonly forceDeployment?: boolean;

  /**
   * Rollback failed deployments
   *
   * @defaultValue true
   */
  readonly rollback?: boolean;

  /**
   * Whether to perform a 'hotswap' deployment.
   * A 'hotswap' deployment will attempt to short-circuit CloudFormation
   * and update the affected resources like Lambda functions directly.
   *
   * @defaultValue - `HotswapMode.FULL_DEPLOYMENT` for regular deployments, `HotswapMode.HOTSWAP_ONLY` for 'watch' deployments
   *
   * @deprecated  Use 'deploymentMethod' instead
   */
  readonly hotswap?: HotswapMode;

  /**
   * Extra properties that configure hotswap behavior
   *
   * @deprecated Use 'deploymentMethod' instead
   */
  readonly hotswapPropertyOverrides?: HotswapPropertyOverrides;

  /**
   * The extra string to append to the User-Agent header when performing AWS SDK calls.
   *
   * @defaultValue - nothing extra is appended to the User-Agent header
   */
  readonly extraUserAgent?: string;

  /**
   * If set, change set of type IMPORT will be created, and resourcesToImport
   * passed to it.
   */
  readonly resourcesToImport?: ResourcesToImport;

  /**
   * If present, use this given template instead of the stored one
   *
   * @defaultValue - Use the stored template
   */
  readonly overrideTemplate?: any;

  /**
   * Whether to build/publish assets in parallel
   *
   * @defaultValue true To remain backward compatible.
   */
  readonly assetParallelism?: boolean;
}

export async function deployStack(options: DeployStackOptions, ioHelper: IoHelper): Promise<DeployStackResult> {
  const stackArtifact = options.stack;
  const stackEnv = options.resolvedEnvironment;

  let deploymentMethod = options.deploymentMethod ?? { method: 'change-set' };
  // Honor the old hotswap option because this API is exported from the CLI as part of the legacy exports
  // @TODO remove when we don't have legacy exports anymore
  if (options.hotswap && deploymentMethod?.method !== 'hotswap') {
    switch (options.hotswap) {
      case HotswapMode.HOTSWAP_ONLY:
        deploymentMethod = {
          method: 'hotswap',
          properties: options.hotswapPropertyOverrides,
        };
        break;
      case HotswapMode.FALL_BACK:
        deploymentMethod = {
          method: 'hotswap',
          properties: options.hotswapPropertyOverrides,
          fallback: deploymentMethod,
        };
        break;
      case HotswapMode.FULL_DEPLOYMENT:
        break;
    }
  }

  options.sdk.appendCustomUserAgent(options.extraUserAgent);
  const cfn = options.sdk.cloudFormation();
  const deployName = options.deployName || stackArtifact.stackName;
  let cloudFormationStack = await CloudFormationStack.lookup(cfn, deployName);

  if (cloudFormationStack.stackStatus.isCreationFailure) {
    await ioHelper.defaults.debug(
      `Found existing stack ${deployName} that had previously failed creation. Deleting it before attempting to re-create it.`,
    );
    await cfn.deleteStack({ StackName: deployName });
    const deletedStack = await waitForStackDelete(cfn, ioHelper, deployName);
    if (deletedStack && deletedStack.stackStatus.name !== 'DELETE_COMPLETE') {
      throw new ToolkitError(
        `Failed deleting stack ${deployName} that had previously failed creation (current state: ${deletedStack.stackStatus})`,
      );
    }
    // Update variable to mark that the stack does not exist anymore, but avoid
    // doing an actual lookup in CloudFormation (which would be silly to do if
    // we just deleted it).
    cloudFormationStack = CloudFormationStack.doesNotExist(cfn, deployName);
  }

  // Detect "legacy" assets (which remain in the metadata) and publish them via
  // an ad-hoc asset manifest, while passing their locations via template
  // parameters.
  const legacyAssets = new AssetManifestBuilder();
  const assetParams = await addMetadataAssetsToManifest(
    ioHelper,
    stackArtifact,
    legacyAssets,
    options.envResources,
    options.reuseAssets,
  );

  const finalParameterValues = { ...options.parameters, ...assetParams };

  const templateParams = TemplateParameters.fromTemplate(stackArtifact.template);
  const stackParams = options.usePreviousParameters
    ? templateParams.updateExisting(finalParameterValues, cloudFormationStack.parameters)
    : templateParams.supplyAll(finalParameterValues);

  if (await canSkipDeploy(options, cloudFormationStack, stackParams.hasChanges(cloudFormationStack.parameters), ioHelper)) {
    await ioHelper.defaults.debug(`${deployName}: skipping deployment (use --force to override)`);
    // if we can skip deployment and we are performing a hotswap, let the user know
    // that no hotswap deployment happened
    if (deploymentMethod?.method === 'hotswap') {
      await ioHelper.defaults.info(
        format(
          `\n ${ICON} %s\n`,
          chalk.bold('hotswap deployment skipped - no changes were detected (use --force to override)'),
        ),
      );
    }
    return {
      type: 'did-deploy-stack',
      noOp: true,
      outputs: cloudFormationStack.outputs,
      stackArn: cloudFormationStack.stackId,
    };
  } else {
    await ioHelper.defaults.debug(`${deployName}: deploying...`);
  }

  const bodyParameter = await makeBodyParameter(
    ioHelper,
    stackArtifact,
    options.resolvedEnvironment,
    legacyAssets,
    options.envResources,
    options.overrideTemplate,
  );
  let bootstrapStackName: string | undefined;
  try {
    bootstrapStackName = (await options.envResources.lookupToolkit()).stackName;
  } catch (e) {
    await ioHelper.defaults.debug(`Could not determine the bootstrap stack name: ${e}`);
  }
  await publishAssets(legacyAssets.toManifest(stackArtifact.assembly.directory), options.sdkProvider, stackEnv, {
    parallel: options.assetParallelism,
    allowCrossAccount: await determineAllowCrossAccountAssetPublishing(options.sdk, ioHelper, bootstrapStackName),
  }, ioHelper);

  // attempt to short-circuit the deployment if possible
  if (deploymentMethod?.method === 'hotswap') {
    try {
      const hotswapModeNew = deploymentMethod?.fallback ? 'fall-back' : 'hotswap-only';
      const hotswapPropertyOverrides = deploymentMethod.properties
        ? createHotswapPropertyOverrides(deploymentMethod.properties)
        : new HotswapPropertyOverrides();

      const hotswapDeploymentResult = await tryHotswapDeployment(
        options.sdkProvider,
        ioHelper,
        stackParams.values,
        cloudFormationStack,
        stackArtifact,
        hotswapModeNew,
        hotswapPropertyOverrides,
      );

      if (hotswapDeploymentResult) {
        return hotswapDeploymentResult;
      }

      await ioHelper.defaults.info(format(
        'Could not perform a hotswap deployment, as the stack %s contains non-Asset changes',
        stackArtifact.displayName,
      ));
    } catch (e) {
      if (!(e instanceof CfnEvaluationException)) {
        throw e;
      }
      await ioHelper.defaults.info(format(
        'Could not perform a hotswap deployment, because the CloudFormation template could not be resolved: %s',
        formatErrorMessage(e),
      ));
    }

    if (deploymentMethod.fallback) {
      await ioHelper.defaults.info('Falling back to doing a full deployment');
      options.sdk.appendCustomUserAgent('cdk-hotswap/fallback');
      deploymentMethod = deploymentMethod.fallback;
    } else {
      return {
        type: 'did-deploy-stack',
        noOp: true,
        stackArn: cloudFormationStack.stackId,
        outputs: cloudFormationStack.outputs,
      };
    }
  }

  // could not short-circuit the deployment, perform a full CFN deploy instead
  const fullDeployment = new FullCloudFormationDeployment(
    deploymentMethod,
    options,
    cloudFormationStack,
    stackArtifact,
    stackParams,
    bodyParameter,
    ioHelper,
  );
  return fullDeployment.performDeployment();
}

type CommonPrepareOptions = keyof CreateStackCommandInput &
keyof UpdateStackCommandInput &
keyof CreateChangeSetCommandInput;
type CommonExecuteOptions = keyof CreateStackCommandInput &
keyof UpdateStackCommandInput &
keyof ExecuteChangeSetCommandInput;

/**
 * This class shares state and functionality between the different full deployment modes
 */
class FullCloudFormationDeployment {
  private readonly cfn: ICloudFormationClient;
  private readonly stackName: string;
  private readonly update: boolean;
  private readonly verb: string;
  private readonly uuid: string;

  constructor(
    private readonly deploymentMethod: DirectDeployment | ChangeSetDeployment,
    private readonly options: DeployStackOptions,
    private readonly cloudFormationStack: CloudFormationStack,
    private readonly stackArtifact: cxapi.CloudFormationStackArtifact,
    private readonly stackParams: ParameterValues,
    private readonly bodyParameter: TemplateBodyParameter,
    private readonly ioHelper: IoHelper,
  ) {
    this.cfn = options.sdk.cloudFormation();
    this.stackName = options.deployName ?? stackArtifact.stackName;

    this.update = cloudFormationStack.exists && cloudFormationStack.stackStatus.name !== 'REVIEW_IN_PROGRESS';
    this.verb = this.update ? 'update' : 'create';
    this.uuid = uuid.v4();
  }

  public async performDeployment(): Promise<DeployStackResult> {
    const deploymentMethod = this.deploymentMethod ?? { method: 'change-set' };

    if (deploymentMethod.method === 'direct' && this.options.resourcesToImport) {
      throw new ToolkitError('Importing resources requires a changeset deployment');
    }

    switch (deploymentMethod.method) {
      case 'change-set':
        return this.changeSetDeployment(deploymentMethod);

      case 'direct':
        return this.directDeployment();
    }
  }

  private async changeSetDeployment(deploymentMethod: ChangeSetDeployment): Promise<DeployStackResult> {
    const changeSetName = deploymentMethod.changeSetName ?? 'cdk-deploy-change-set';
    const execute = deploymentMethod.execute ?? true;
    const importExistingResources = deploymentMethod.importExistingResources ?? false;
    const changeSetDescription = await this.createChangeSet(changeSetName, execute, importExistingResources);
    await this.updateTerminationProtection();

    if (changeSetHasNoChanges(changeSetDescription)) {
      await this.ioHelper.defaults.debug(format('No changes are to be performed on %s.', this.stackName));
      if (execute) {
        await this.ioHelper.defaults.debug(format('Deleting empty change set %s', changeSetDescription.ChangeSetId));
        await this.cfn.deleteChangeSet({
          StackName: this.stackName,
          ChangeSetName: changeSetName,
        });
      }

      if (this.options.forceDeployment) {
        await this.ioHelper.defaults.warn(
          [
            'You used the --force flag, but CloudFormation reported that the deployment would not make any changes.',
            'According to CloudFormation, all resources are already up-to-date with the state in your CDK app.',
            '',
            'You cannot use the --force flag to get rid of changes you made in the console. Try using',
            'CloudFormation drift detection instead: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html',
          ].join('\n'),
        );
      }

      return {
        type: 'did-deploy-stack',
        noOp: true,
        outputs: this.cloudFormationStack.outputs,
        stackArn: changeSetDescription.StackId!,
      };
    }

    if (!execute) {
      await this.ioHelper.defaults.info(format(
        'Changeset %s created and waiting in review for manual execution (--no-execute)',
        changeSetDescription.ChangeSetId,
      ));
      return {
        type: 'did-deploy-stack',
        noOp: false,
        outputs: this.cloudFormationStack.outputs,
        stackArn: changeSetDescription.StackId!,
      };
    }

    // If there are replacements in the changeset, check the rollback flag and stack status
    const replacement = hasReplacement(changeSetDescription);
    const isPausedFailState = this.cloudFormationStack.stackStatus.isRollbackable;
    const rollback = this.options.rollback ?? true;
    if (isPausedFailState && replacement) {
      return { type: 'failpaused-need-rollback-first', reason: 'replacement', status: this.cloudFormationStack.stackStatus.name };
    }
    if (isPausedFailState && rollback) {
      return { type: 'failpaused-need-rollback-first', reason: 'not-norollback', status: this.cloudFormationStack.stackStatus.name };
    }
    if (!rollback && replacement) {
      return { type: 'replacement-requires-rollback' };
    }

    return this.executeChangeSet(changeSetDescription);
  }

  private async createChangeSet(changeSetName: string, willExecute: boolean, importExistingResources: boolean) {
    await this.cleanupOldChangeset(changeSetName);

    await this.ioHelper.defaults.debug(`Attempting to create ChangeSet with name ${changeSetName} to ${this.verb} stack ${this.stackName}`);
    await this.ioHelper.defaults.info(format('%s: creating CloudFormation changeset...', chalk.bold(this.stackName)));
    const changeSet = await this.cfn.createChangeSet({
      StackName: this.stackName,
      ChangeSetName: changeSetName,
      ChangeSetType: this.options.resourcesToImport ? 'IMPORT' : this.update ? 'UPDATE' : 'CREATE',
      ResourcesToImport: this.options.resourcesToImport,
      Description: `CDK Changeset for execution ${this.uuid}`,
      ClientToken: `create${this.uuid}`,
      ImportExistingResources: importExistingResources,
      ...this.commonPrepareOptions(),
    });

    await this.ioHelper.defaults.debug(format('Initiated creation of changeset: %s; waiting for it to finish creating...', changeSet.Id));
    // Fetching all pages if we'll execute, so we can have the correct change count when monitoring.
    return waitForChangeSet(this.cfn, this.ioHelper, this.stackName, changeSetName, {
      fetchAll: willExecute,
    });
  }

  private async executeChangeSet(changeSet: DescribeChangeSetCommandOutput): Promise<SuccessfulDeployStackResult> {
    await this.ioHelper.defaults.debug(format('Initiating execution of changeset %s on stack %s', changeSet.ChangeSetId, this.stackName));

    await this.cfn.executeChangeSet({
      StackName: this.stackName,
      ChangeSetName: changeSet.ChangeSetName!,
      ClientRequestToken: `exec${this.uuid}`,
      ...this.commonExecuteOptions(),
    });

    await this.ioHelper.defaults.debug(
      format(
        'Execution of changeset %s on stack %s has started; waiting for the update to complete...',
        changeSet.ChangeSetId,
        this.stackName,
      ),
    );

    // +1 for the extra event emitted from updates.
    const changeSetLength: number = (changeSet.Changes ?? []).length + (this.update ? 1 : 0);
    return this.monitorDeployment(changeSet.CreationTime!, changeSetLength);
  }

  private async cleanupOldChangeset(changeSetName: string) {
    if (this.cloudFormationStack.exists) {
      // Delete any existing change sets generated by CDK since change set names must be unique.
      // The delete request is successful as long as the stack exists (even if the change set does not exist).
      await this.ioHelper.defaults.debug(`Removing existing change set with name ${changeSetName} if it exists`);
      await this.cfn.deleteChangeSet({
        StackName: this.stackName,
        ChangeSetName: changeSetName,
      });
    }
  }

  private async updateTerminationProtection() {
    // Update termination protection only if it has changed.
    const terminationProtection = this.stackArtifact.terminationProtection ?? false;
    if (!!this.cloudFormationStack.terminationProtection !== terminationProtection) {
      await this.ioHelper.defaults.debug(
        format (
          'Updating termination protection from %s to %s for stack %s',
          this.cloudFormationStack.terminationProtection,
          terminationProtection,
          this.stackName,
        ),
      );
      await this.cfn.updateTerminationProtection({
        StackName: this.stackName,
        EnableTerminationProtection: terminationProtection,
      });
      await this.ioHelper.defaults.debug(format('Termination protection updated to %s for stack %s', terminationProtection, this.stackName));
    }
  }

  private async directDeployment(): Promise<SuccessfulDeployStackResult> {
    await this.ioHelper.defaults.info(format('%s: %s stack...', chalk.bold(this.stackName), this.update ? 'updating' : 'creating'));

    const startTime = new Date();

    if (this.update) {
      await this.updateTerminationProtection();

      try {
        await this.cfn.updateStack({
          StackName: this.stackName,
          ClientRequestToken: `update${this.uuid}`,
          ...this.commonPrepareOptions(),
          ...this.commonExecuteOptions(),
        });
      } catch (err: any) {
        if (err.message === 'No updates are to be performed.') {
          await this.ioHelper.defaults.debug(format('No updates are to be performed for stack %s', this.stackName));
          return {
            type: 'did-deploy-stack',
            noOp: true,
            outputs: this.cloudFormationStack.outputs,
            stackArn: this.cloudFormationStack.stackId,
          };
        }
        throw err;
      }

      return this.monitorDeployment(startTime, undefined);
    } else {
      // Take advantage of the fact that we can set termination protection during create
      const terminationProtection = this.stackArtifact.terminationProtection ?? false;

      await this.cfn.createStack({
        StackName: this.stackName,
        ClientRequestToken: `create${this.uuid}`,
        ...(terminationProtection ? { EnableTerminationProtection: true } : undefined),
        ...this.commonPrepareOptions(),
        ...this.commonExecuteOptions(),
      });

      return this.monitorDeployment(startTime, undefined);
    }
  }

  private async monitorDeployment(startTime: Date, expectedChanges: number | undefined): Promise<SuccessfulDeployStackResult> {
    const monitor = new StackActivityMonitor({
      cfn: this.cfn,
      stack: this.stackArtifact,
      stackName: this.stackName,
      resourcesTotal: expectedChanges,
      ioHelper: this.ioHelper,
      changeSetCreationTime: startTime,
    });
    await monitor.start();

    let finalState = this.cloudFormationStack;
    try {
      const successStack = await waitForStackDeploy(this.cfn, this.ioHelper, this.stackName);

      // This shouldn't really happen, but catch it anyway. You never know.
      if (!successStack) {
        throw new ToolkitError('Stack deploy failed (the stack disappeared while we were deploying it)');
      }
      finalState = successStack;
    } catch (e: any) {
      throw new ToolkitError(suffixWithErrors(formatErrorMessage(e), monitor.errors));
    } finally {
      await monitor.stop();
    }
    await this.ioHelper.defaults.debug(format('Stack %s has completed updating', this.stackName));
    return {
      type: 'did-deploy-stack',
      noOp: false,
      outputs: finalState.outputs,
      stackArn: finalState.stackId,
    };
  }

  /**
   * Return the options that are shared between CreateStack, UpdateStack and CreateChangeSet
   */
  private commonPrepareOptions(): Partial<Pick<UpdateStackCommandInput, CommonPrepareOptions>> {
    return {
      Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
      NotificationARNs: this.options.notificationArns,
      Parameters: this.stackParams.apiParameters,
      RoleARN: this.options.roleArn,
      TemplateBody: this.bodyParameter.TemplateBody,
      TemplateURL: this.bodyParameter.TemplateURL,
      Tags: this.options.tags,
    };
  }

  /**
   * Return the options that are shared between UpdateStack and CreateChangeSet
   *
   * Be careful not to add in keys for options that aren't used, as the features may not have been
   * deployed everywhere yet.
   */
  private commonExecuteOptions(): Partial<Pick<UpdateStackCommandInput, CommonExecuteOptions>> {
    const shouldDisableRollback = this.options.rollback === false;

    return {
      StackName: this.stackName,
      ...(shouldDisableRollback ? { DisableRollback: true } : undefined),
    };
  }
}

export interface DestroyStackOptions {
  /**
   * The stack to be destroyed
   */
  stack: cxapi.CloudFormationStackArtifact;

  sdk: SDK;
  roleArn?: string;
  deployName?: string;
}

export interface DestroyStackResult {
  /**
   * The ARN of the stack that was destroyed, if any.
   *
   * If the stack didn't exist to begin with, the operation will succeed
   * but this value will be undefined.
   */
  readonly stackArn?: string;
}

export async function destroyStack(options: DestroyStackOptions, ioHelper: IoHelper): Promise<DestroyStackResult> {
  const deployName = options.deployName || options.stack.stackName;
  const cfn = options.sdk.cloudFormation();

  const currentStack = await CloudFormationStack.lookup(cfn, deployName);
  if (!currentStack.exists) {
    return {};
  }
  const monitor = new StackActivityMonitor({
    cfn,
    stack: options.stack,
    stackName: deployName,
    ioHelper: ioHelper,
  });
  await monitor.start();

  try {
    await cfn.deleteStack({ StackName: deployName, RoleARN: options.roleArn });
    const destroyedStack = await waitForStackDelete(cfn, ioHelper, deployName);
    if (destroyedStack && destroyedStack.stackStatus.name !== 'DELETE_COMPLETE') {
      throw new ToolkitError(`Failed to destroy ${deployName}: ${destroyedStack.stackStatus}`);
    }

    return { stackArn: currentStack.stackId };
  } catch (e: any) {
    throw new ToolkitError(suffixWithErrors(formatErrorMessage(e), monitor.errors));
  } finally {
    if (monitor) {
      await monitor.stop();
    }
  }
}

/**
 * Checks whether we can skip deployment
 *
 * We do this in a complicated way by preprocessing (instead of just
 * looking at the changeset), because if there are nested stacks involved
 * the changeset will always show the nested stacks as needing to be
 * updated, and the deployment will take a long time to in effect not
 * do anything.
 */
async function canSkipDeploy(
  deployStackOptions: DeployStackOptions,
  cloudFormationStack: CloudFormationStack,
  parameterChanges: ParameterChanges,
  ioHelper: IoHelper,
): Promise<boolean> {
  const deployName = deployStackOptions.deployName || deployStackOptions.stack.stackName;
  await ioHelper.defaults.debug(`${deployName}: checking if we can skip deploy`);

  // Forced deploy
  if (deployStackOptions.forceDeployment) {
    await ioHelper.defaults.debug(`${deployName}: forced deployment`);
    return false;
  }

  // Creating changeset only (default true), never skip
  if (
    deployStackOptions.deploymentMethod?.method === 'change-set' &&
    deployStackOptions.deploymentMethod.execute === false
  ) {
    await ioHelper.defaults.debug(`${deployName}: --no-execute, always creating change set`);
    return false;
  }

  // No existing stack
  if (!cloudFormationStack.exists) {
    await ioHelper.defaults.debug(`${deployName}: no existing stack`);
    return false;
  }

  // Template has changed (assets taken into account here)
  if (JSON.stringify(deployStackOptions.stack.template) !== JSON.stringify(await cloudFormationStack.template())) {
    await ioHelper.defaults.debug(`${deployName}: template has changed`);
    return false;
  }

  // Tags have changed
  if (!compareTags(cloudFormationStack.tags, deployStackOptions.tags ?? [])) {
    await ioHelper.defaults.debug(`${deployName}: tags have changed`);
    return false;
  }

  // Notification arns have changed
  if (!arrayEquals(cloudFormationStack.notificationArns, deployStackOptions.notificationArns ?? [])) {
    await ioHelper.defaults.debug(`${deployName}: notification arns have changed`);
    return false;
  }

  // Termination protection has been updated
  if (!!deployStackOptions.stack.terminationProtection !== !!cloudFormationStack.terminationProtection) {
    await ioHelper.defaults.debug(`${deployName}: termination protection has been updated`);
    return false;
  }

  // Parameters have changed
  if (parameterChanges) {
    if (parameterChanges === 'ssm') {
      await ioHelper.defaults.debug(`${deployName}: some parameters come from SSM so we have to assume they may have changed`);
    } else {
      await ioHelper.defaults.debug(`${deployName}: parameters have changed`);
    }
    return false;
  }

  // Existing stack is in a failed state
  if (cloudFormationStack.stackStatus.isFailure) {
    await ioHelper.defaults.debug(`${deployName}: stack is in a failure state`);
    return false;
  }

  // We can skip deploy
  return true;
}

/**
 * Compares two list of tags, returns true if identical.
 */
function compareTags(a: Tag[], b: Tag[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (const aTag of a) {
    const bTag = b.find((tag) => tag.Key === aTag.Key);

    if (!bTag || bTag.Value !== aTag.Value) {
      return false;
    }
  }

  return true;
}

function suffixWithErrors(msg: string, errors?: string[]) {
  return errors && errors.length > 0 ? `${msg}: ${errors.join(', ')}` : msg;
}

function arrayEquals(a: any[], b: any[]): boolean {
  return a.every((item) => b.includes(item)) && b.every((item) => a.includes(item));
}

function hasReplacement(cs: DescribeChangeSetCommandOutput) {
  return (cs.Changes ?? []).some(c => {
    const a = c.ResourceChange?.PolicyAction;
    return a === 'ReplaceAndDelete' || a === 'ReplaceAndRetain' || a === 'ReplaceAndSnapshot';
  });
}
