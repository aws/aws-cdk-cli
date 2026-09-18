import { randomUUID } from 'node:crypto';
import { format } from 'node:util';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { diffTemplate } from '@aws-cdk/cloudformation-diff';
import type {
  CreateChangeSetCommandInput,
  CreateStackCommandInput,
  ExecuteChangeSetCommandInput,
  UpdateStackCommandInput,
  Tag,
  DeploymentConfig,
} from '@aws-sdk/client-cloudformation';
import chalk from 'chalk';
import { AssetManifestBuilder } from './asset-manifest-builder';
import { publishAssets } from './asset-publishing';
import { addMetadataAssetsToManifest } from './assets';
import {
  type ParameterChanges,
  ParameterValues,
} from './cfn-api';
import {
  TemplateParameters,
  waitForStackDeploy,
  waitForStackDelete,
} from './cfn-api';
import { determineAllowCrossAccountAssetPublishing } from './checks';
import type { DeployStackResult, SuccessfulDeployStackResult } from './deployment-result';
import type { ChangeSetDeployment, DeploymentMethod, DirectDeployment, ExecuteChangeSetDeployment } from '../../actions/deploy';
import { DEFAULT_DEPLOY_CHANGE_SET_NAME } from '../../actions/deploy/private/deployment-method';
import type { ReplacedResource } from '../../payloads/deploy';
import { DeploymentError, DeploymentErrorCodes, ToolkitError } from '../../toolkit/toolkit-error';
import type { StabilizingResource } from '../../toolkit/types';
import { formatErrorMessage } from '../../util';
import { changeSetNameFromArn } from '../../util/cloudformation';
import type { SDK, SdkProvider, ICloudFormationClient } from '../aws-auth/private';
import type { ChangeSetReport } from '../change-sets';
import { ChangeSetDescriber } from '../change-sets';
import type { TemplateBodyParameter } from '../cloudformation';
import { makeBodyParameter, CfnEvaluationException, CloudFormationStack } from '../cloudformation';
import type { CloudFormationStackDiagnoser } from '../diagnosing/stack-diagnoser';
import { changeSetHasNoChanges } from '../diagnosing/stack-diagnoser';
import type { EnvironmentResources, StringWithoutPlaceholders } from '../environment';
import { HotswapPropertyOverrides, ICON, createHotswapPropertyOverrides } from '../hotswap/common';
import { tryHotswapDeployment } from '../hotswap/hotswap-deployments';
import { invalidateHotswapTemplateCache, readHotswapTemplateCache } from '../hotswap/hotswap-template-cache';
import type { IoHelper } from '../io/private';
import { IO } from '../io/private';
import type { ResourcesToImport } from '../resource-import';
import { StackActivityMonitor } from '../stack-events';
import type { ResourceErrors } from '../stack-events/resource-errors';

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
   * @default - No execution role; CloudFormation either uses the role currently associated with
   * the stack, or otherwise uses current AWS credentials
   */
  readonly roleArn?: StringWithoutPlaceholders;

  /**
   * Notification ARNs to pass to CloudFormation to notify when the change set has completed
   *
   * @default - No notifications
   */
  readonly notificationArns?: string[];

  /**
   * Name to deploy the stack under
   *
   * @default - Name from assembly
   */
  readonly deployName?: string;

  /**
   * List of asset IDs which shouldn't be built
   *
   * @default - Build all assets
   */
  readonly reuseAssets?: string[];

  /**
   * Tags to pass to CloudFormation to add to stack
   *
   * @default - No tags
   */
  readonly tags?: Tag[];

  /**
   * What deployment method to use
   *
   * @default - Change set with defaults
   */
  readonly deploymentMethod?: DeploymentMethod;

  /**
   * Whether the caller will execute the change set created by this deployment
   * afterwards (the internal first phase of a two-phase deploy).
   *
   * When a change set is created without being executed (change-set method
   * with `execute: false`) and this is false, the change set is the user's
   * final artifact (`--no-execute`) and is announced as waiting for manual
   * execution.
   *
   * @default false
   */
  readonly willExecuteChangeSet?: boolean;

  /**
   * The collection of extra parameters
   * (in addition to those used for assets)
   * to pass to the deployed template.
   * Note that parameters with `undefined` or empty values will be ignored,
   * and not passed to the template.
   *
   * @default - No additional parameters will be passed to the template
   */
  readonly parameters?: { [name: string]: string | undefined };

  /**
   * Use previous values for unspecified parameters
   *
   * If not set, all parameters must be specified for every deployment.
   *
   * @default false
   */
  readonly usePreviousParameters?: boolean;

  /**
   * Deploy even if the deployed template is identical to the one we are about to deploy.
   * @default false
   */
  readonly forceDeployment?: boolean;

  /**
   * Rollback failed deployments
   *
   * @default true
   */
  readonly rollback?: boolean;

  /**
   * The extra string to append to the User-Agent header when performing AWS SDK calls.
   *
   * @default - Nothing extra is appended to the User-Agent header
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
   * @default - Use the stored template
   */
  readonly overrideTemplate?: any;

  /**
   * Whether to build/publish assets in parallel
   *
   * @default true To remain backward compatible.
   */
  readonly assetParallelism?: boolean;

  /**
   * The class that diagnoses CloudFormation errors
   */
  readonly diagnoser: CloudFormationStackDiagnoser;

  /**
   * Whether to use express mode to deploy
   */
  readonly express?: boolean;

  /**
   * Time in milliseconds to wait between polling CloudFormation for stack events while monitoring stack operations and waiting for stack stabilization.
   *
   * @default 2000
   */
  readonly stackEventPollingInterval?: number;
}

export async function deployStack(options: DeployStackOptions, ioHelper: IoHelper): Promise<DeployStackResult> {
  const stackArtifact = options.stack;
  const stackEnv = options.resolvedEnvironment;

  const inputMethod = options.deploymentMethod ?? { method: 'change-set' };
  let deploymentMethod: DeploymentMethod = inputMethod;

  options.sdk.appendCustomUserAgent(options.extraUserAgent);
  const cfn = options.sdk.cloudFormation();
  const deployName = options.deployName || stackArtifact.stackName;
  let cloudFormationStack = await CloudFormationStack.lookup(cfn, deployName);

  // execute-change-set: skip template/asset work, go straight to FullCloudFormationDeployment
  if (deploymentMethod.method === 'execute-change-set') {
    const fullDeployment = new FullCloudFormationDeployment(
      deploymentMethod,
      options,
      cloudFormationStack,
      stackArtifact,
      new ParameterValues({}, {}),
      {},
      ioHelper,
      options.diagnoser,
    );
    return fullDeployment.performDeployment();
  }

  if (cloudFormationStack.stackStatus.isCreationFailure) {
    await ioHelper.defaults.debug(
      `Found existing stack ${deployName} that had previously failed creation. Deleting it before attempting to re-create it.`,
    );
    await cfn.deleteStack({ StackName: cloudFormationStack.stackId, ClientRequestToken: randomUUID() });
    const deletedStack = await waitForStackDelete(cfn, ioHelper, cloudFormationStack.stackId, options.stackEventPollingInterval);
    if (deletedStack && deletedStack.stackStatus.name !== 'DELETE_COMPLETE') {
      throw new DeploymentError(
        `Failed deleting stack ${deployName} that had previously failed creation (current state: ${deletedStack.stackStatus})`,
        'FailedStackCleanupFailed',
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
      deleteFailures: [],
      stabilizingResources: [],
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
        await ioHelper.defaults.info(
          `Your next non-hotswap deployment with ${stackEnv.name} should include '--revert-drift' to resolve the drift that was introduced while hotswapping.`,
        );
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
        deleteFailures: [],
        stabilizingResources: [],
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
    options.diagnoser,
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
    private readonly deploymentMethod: DirectDeployment | ChangeSetDeployment | ExecuteChangeSetDeployment,
    private readonly options: DeployStackOptions,
    private readonly cloudFormationStack: CloudFormationStack,
    private readonly stackArtifact: cxapi.CloudFormationStackArtifact,
    private readonly stackParams: ParameterValues,
    private readonly bodyParameter: TemplateBodyParameter,
    private readonly ioHelper: IoHelper,
    private readonly diagnoser: CloudFormationStackDiagnoser,
  ) {
    this.cfn = options.sdk.cloudFormation();
    this.stackName = options.deployName ?? stackArtifact.stackName;

    this.update = cloudFormationStack.exists && cloudFormationStack.stackStatus.name !== 'REVIEW_IN_PROGRESS';
    this.verb = this.update ? 'update' : 'create';
    this.uuid = randomUUID();
  }

  public async performDeployment(): Promise<DeployStackResult> {
    const deploymentMethod = this.deploymentMethod ?? { method: 'change-set' };

    // if there is a hotswap cache, clear it when a full Cloudformation of any kind happens
    const deploymentEnv = this.options.resolvedEnvironment;
    await invalidateHotswapTemplateCache(
      this.stackArtifact.assembly.directory,
      this.stackArtifact.stackName,
      `${deploymentEnv.account}/${deploymentEnv.region}`,
    );

    if (deploymentMethod.method === 'direct' && this.options.resourcesToImport) {
      throw new ToolkitError('ImportRequiresChangeSet', 'Importing resources requires a changeset deployment');
    }

    switch (deploymentMethod.method) {
      case 'change-set':
        return this.changeSetDeployment(deploymentMethod);

      case 'execute-change-set':
        return this.executeExistingChangeSet(deploymentMethod);

      case 'direct':
        return this.directDeployment();
    }
  }

  private async changeSetDeployment(deploymentMethod: ChangeSetDeployment): Promise<DeployStackResult> {
    const changeSetName = deploymentMethod.changeSetName ?? DEFAULT_DEPLOY_CHANGE_SET_NAME;
    const execute = deploymentMethod.execute ?? true;
    const importExistingResources = deploymentMethod.importExistingResources ?? false;
    const revertDrift = deploymentMethod.revertDrift ?? false;
    const changeSetReport = await this.createChangeSet(changeSetName, importExistingResources, revertDrift);
    const changeSetDescription = changeSetReport.changeSet;
    await this.updateTerminationProtection();

    if (changeSetHasNoChanges(changeSetDescription)) {
      await this.ioHelper.defaults.debug(format('No changes are to be performed on %s.', this.stackName));
      if (execute) {
        await this.ioHelper.defaults.debug(format('Deleting empty change set %s', changeSetDescription.ChangeSetId));
        await this.cfn.deleteChangeSet({
          StackName: changeSetDescription.StackId ?? this.stackName,
          ChangeSetName: changeSetDescription.ChangeSetId ?? changeSetName,
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
        deleteFailures: [],
        stabilizingResources: [],
      };
    }

    if (!execute) {
      if (!this.options.willExecuteChangeSet) {
        await this.ioHelper.defaults.info(format(
          'Changeset %s created and waiting in review for manual execution (--no-execute)',
          changeSetDescription.ChangeSetId,
        ));
      }
      return {
        type: 'did-deploy-stack',
        noOp: false,
        outputs: this.cloudFormationStack.outputs,
        stackArn: changeSetDescription.StackId!,
        changeSet: changeSetDescription,
        deleteFailures: [],
        stabilizingResources: [],
      };
    }

    // If there are replacements in the changeset, check the rollback flag and stack status
    return this.checkAndExecuteChangeSet(changeSetReport);
  }

  private async executeExistingChangeSet(deploymentMethod: ExecuteChangeSetDeployment): Promise<DeployStackResult> {
    await this.updateTerminationProtection();

    // The change set was created by an earlier command (possibly not even by us). Require it to
    // have completed rather than waiting on it: blocking on someone else's change set
    // indefinitely would be worse than reporting that it isn't ready.
    const changeSetReport = await new ChangeSetDescriber({
      cfn: this.cfn,
      ioHelper: this.ioHelper,
      stackNameOrArn: this.stackName,
      changeSetNameOrArn: deploymentMethod.changeSetName,
    }).describeForExecution({ diagnoser: this.diagnoser });

    return this.checkAndExecuteChangeSet(changeSetReport);
  }

  /**
   * Whether CloudFormation will have rollback disabled for this deployment.
   *
   * Express Mode disables rollback unless it is explicitly requested; standard mode only disables it when
   * `--no-rollback` was passed. Both the replacement guard and `deployConfig()` derive from this, so they cannot
   * disagree about whether rollback ends up disabled server-side.
   *
   * Note this is deliberately NOT the predicate used by `commonExecuteOptions()`. That one decides whether to send
   * `DisableRollback: true` on the API call, which express deployments must never do - they express it through
   * `DeploymentConfig` instead.
   */
  private rollbackDisabled(): boolean {
    return this.options.express ? this.options.rollback !== true : this.options.rollback === false;
  }

  private deployConfig(): DeploymentConfig {
    if (!this.options.express) {
      return { Mode: 'STANDARD' };
    }

    return {
      Mode: 'EXPRESS',
      ...(this.rollbackDisabled() ? undefined : { DisableRollback: false }),
    };
  }

  /**
   * Check rollback/replacement constraints and execute the change set if all checks pass.
   */
  private async checkAndExecuteChangeSet(changeSetReport: ChangeSetReport): Promise<DeployStackResult> {
    const replacements = findReplacements(changeSetReport);
    const isPausedFailState = this.cloudFormationStack.stackStatus.isRollbackable;
    const rollback = this.options.rollback ?? true;

    // For express mode deployments, don't check paused and failed, since express mode stacks cannot use rollback API
    if (!this.options.express) {
      if (isPausedFailState && replacements.length > 0) {
        return { type: 'failpaused-need-rollback-first', reason: 'replacement', status: this.cloudFormationStack.stackStatus.name };
      }
      if (isPausedFailState && rollback) {
        return { type: 'failpaused-need-rollback-first', reason: 'not-norollback', status: this.cloudFormationStack.stackStatus.name };
      }
    }

    // CloudFormation rejects replacement-type updates while rollback is disabled. Standard mode only disables rollback
    // for `--no-rollback`, but Express Mode disables it by default - which is why this condition must not be scoped to
    // non-express deployments. #1745 dropped the express half of it, #1785 restructured what was left, and #1931 is the
    // resulting SEV: the update is submitted, CloudFormation refuses it, and the express stack is left in UPDATE_FAILED
    // with no rollback available.
    //
    // Shelf life: CloudFormation has a server-side fix with a tentative ECD of 2026-11-15. Once that is confirmed in
    // all regions, the express half of this guard - and CDK_TOOLKIT_W5903 - can be deleted.
    if (replacements.length > 0 && this.rollbackDisabled()) {
      if (this.options.express) {
        await this.ioHelper.notify(IO.CDK_TOOLKIT_W5903.msg(
          replacementRoutingMessage({ rejected: false, needsUnwedge: isPausedFailState }),
          {
            stackName: this.stackName,
            changeSetId: changeSetReport.changeSet.ChangeSetId,
            replacements,
            detectedBy: 'change-set',
          },
        ));
      }
      return { type: 'replacement-requires-rollback' };
    }

    const changeSet = changeSetReport.changeSet;
    await this.ioHelper.defaults.debug(format('Initiating execution of changeset %s on stack %s', changeSet.ChangeSetId, this.stackName));

    await this.cfn.executeChangeSet({
      StackName: changeSet.StackId ?? this.stackName,
      ChangeSetName: changeSet.ChangeSetId!,
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
    return this.monitorDeployment(changeSet.CreationTime!, changeSet.StackId!, changeSetLength);
  }

  private async createChangeSet(changeSetName: string, importExistingResources: boolean, revertDrift: boolean): Promise<ChangeSetReport> {
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
      DeploymentMode: revertDrift ? 'REVERT_DRIFT' : undefined,
      IncludeNestedStacks: (this.options.resourcesToImport || revertDrift) ? undefined : true,
      ...this.commonPrepareOptions(),
      DeploymentConfig: this.deployConfig(),
    });

    await this.ioHelper.defaults.debug(format('Initiated creation of changeset: %s; waiting for it to finish creating...', changeSet.Id));
    return new ChangeSetDescriber({
      cfn: this.cfn,
      ioHelper: this.ioHelper,
      stackNameOrArn: changeSet.StackId ?? this.stackName,
      changeSetNameOrArn: changeSet.Id ?? changeSetName,
    }).waitAndThrowOnProblem({
      diagnoser: this.diagnoser,
    });
  }

  private async cleanupOldChangeset(changeSetNameOrArn: string) {
    if (this.cloudFormationStack.exists) {
      const changeSetDisplayName = changeSetNameFromArn(changeSetNameOrArn);
      await this.ioHelper.defaults.debug(`Removing existing change set with name ${changeSetDisplayName} if it exists`);
      // Delete any existing change sets generated by CDK since change set names must be unique.
      // The delete request is successful as long as the stack exists (even if the change set does not exist).
      await this.cfn.deleteChangeSet({
        StackName: this.stackName,
        ChangeSetName: changeSetNameOrArn,
      });

      // Deleting may take a bit, especially if it involves nested stack change sets. Wait until it is gone.
      await new ChangeSetDescriber({
        cfn: this.cfn,
        ioHelper: this.ioHelper,
        stackNameOrArn: this.stackName,
        changeSetNameOrArn: changeSetNameOrArn,
      }).waitForGone();
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
        const stack = await this.cfn.updateStack({
          StackName: this.stackName,
          ClientRequestToken: `update${this.uuid}`,
          DeploymentConfig: this.deployConfig(),
          ...this.commonPrepareOptions(),
          ...this.commonExecuteOptions(),
        });
        return await this.monitorDeployment(startTime, stack.StackId!, undefined);
      } catch (err: any) {
        if (err.message === 'No updates are to be performed.') {
          await this.ioHelper.defaults.debug(format('No updates are to be performed for stack %s', this.stackName));
          return {
            type: 'did-deploy-stack',
            noOp: true,
            outputs: this.cloudFormationStack.outputs,
            stackArn: this.cloudFormationStack.stackId,
            deleteFailures: [],
            stabilizingResources: [],
          };
        }
        throw err;
      }
    } else {
      // Take advantage of the fact that we can set termination protection during create
      const terminationProtection = this.stackArtifact.terminationProtection ?? false;

      const stack = await this.cfn.createStack({
        StackName: this.stackName,
        ClientRequestToken: `create${this.uuid}`,
        DeploymentConfig: this.deployConfig(),
        ...(terminationProtection ? { EnableTerminationProtection: true } : undefined),
        ...this.commonPrepareOptions(),
        ...this.commonExecuteOptions(),
      });

      return this.monitorDeployment(startTime, stack.StackId!, undefined);
    }
  }

  private async monitorDeployment(startTime: Date, stackArn: string, expectedChanges: number | undefined): Promise<SuccessfulDeployStackResult> {
    const monitor = new StackActivityMonitor({
      cfn: this.cfn,
      stack: this.stackArtifact,
      stackArn,
      resourcesTotal: expectedChanges,
      ioHelper: this.ioHelper,
      changeSetCreationTime: startTime,
      envResources: this.options.envResources,
      isStackUpdate: this.update,
      pollingInterval: this.options.stackEventPollingInterval,
    });
    await monitor.start();

    let finalState: CloudFormationStack;
    let monitorStopped = false;

    // `monitor.stop()` performs a final poll, and that poll is what fills `monitor.errors` with the resource-level
    // failures CloudFormation reported. Everything that reads those errors has to run after it. `stop()` is not
    // idempotent (it emits a completion message and polls again), so it must run exactly once.
    const stopMonitor = async () => {
      if (!monitorStopped) {
        monitorStopped = true;
        await monitor.stop();
      }
    };

    try {
      const successStack = await waitForStackDeploy(this.cfn, this.ioHelper, stackArn, this.options.stackEventPollingInterval);

      // This shouldn't really happen, but catch it anyway. You never know.
      if (!successStack) {
        throw new DeploymentError('Stack deploy failed (the stack disappeared while we were deploying it)', DeploymentErrorCodes.STACK_DISAPPEARED_ERROR_CODE);
      }
      finalState = successStack;
    } catch (e: any) {
      await stopMonitor();

      await this.routeReplacementRejectedWithRollbackDisabled(e, monitor.errors);

      // Deployment errors get replaced by a diagnosis of the underlying resource failures, which says more.
      // Any other error, and any failure to diagnose, leaves `e` to propagate as it is.
      if (ToolkitError.isDeploymentError(e)) {
        await this.diagnoseDeploymentFailure(stackArn, monitor.errors);
      }

      throw e;
    } finally {
      await stopMonitor();
    }
    await this.ioHelper.defaults.debug(format('Stack %s has completed updating', this.stackName));
    return {
      type: 'did-deploy-stack',
      noOp: false,
      outputs: finalState.outputs,
      stackArn: finalState.stackId,
      deleteFailures: this.update ? monitor.deleteFailures : [],
      stabilizingResources: monitor.stabilizingResources,
    };
  }

  /**
   * Tell the user how to perform a replacement when CloudFormation rejected one because rollback was disabled.
   *
   * The `--method=direct` path has no change set to inspect, so it cannot be gated up front the way the change set
   * path is; a replacement there is only discovered from the failure CloudFormation reports.
   *
   * `--express --method=direct` is deliberately NOT refused up front, and that gap should not be "fixed": replaying the
   * previous configuration that way is the only exit from a stack already stranded in UPDATE_FAILED, so refusing the
   * combination would strand users permanently.
   *
   * The original error is left to propagate untouched, so a genuinely failing replacement still reports its real
   * underlying service error.
   */
  private async routeReplacementRejectedWithRollbackDisabled(error: any, errors: ResourceErrors): Promise<void> {
    if (!this.rollbackDisabled()) {
      return;
    }

    const rejected = errors.all.filter((e) => mentionsReplacementRejection(e.message));
    const matched = rejected.length > 0 || mentionsReplacementRejection(error?.message ?? '');

    if (!matched) {
      // CloudFormation owns the wording we match on and has a change landing around 2026-11-15. If it is reworded,
      // this is the branch that will start being taken - log what we did see so that shows up in a debug log instead
      // of arriving as a second SEV.
      const reported = errors.allErrorMessages.filter((m) => m.trim() !== '');
      await this.ioHelper.defaults.debug(format(
        'Deployment failed with rollback disabled but no reported error mentioned %j, so no replacement guidance was emitted. Reported reasons: %s',
        CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON,
        reported.length > 0 ? reported.join(' | ') : '(none)',
      ));
      return;
    }

    await this.ioHelper.notify(IO.CDK_TOOLKIT_W5903.msg(
      replacementRoutingMessage({ rejected: true, needsUnwedge: true }),
      {
        stackName: this.stackName,
        replacements: rejected.map((e) => ({
          logicalId: e.logicalId ?? this.stackName,
          resourceType: e.resourceType,
        })),
        detectedBy: 'service-error',
      },
    ));
  }

  /**
   * Throw a `DeploymentError` describing why the deployment failed, if we can establish that
   *
   * Returns normally when no cause could be established, leaving the caller's original error as the better
   * one to report.
   */
  private async diagnoseDeploymentFailure(stackArn: string, errors: ResourceErrors): Promise<void> {
    // Describe the stack as it is now. The pre-deploy description held by this class is either absent (the
    // stack is being created) or describes a state the deployment has since left.
    const deployedState = await this.cfn.describeStacks({ StackName: stackArn })
      .then((response) => response.Stacks?.[0])
      .catch(async (e) => {
        await this.ioHelper.defaults.debug(`Could not describe ${stackArn} to diagnose the failure: ${formatErrorMessage(e)}`);
        return undefined;
      });
    if (!deployedState) {
      return;
    }

    const diagnosis = await this.diagnoser.diagnoseFromErrorCollection(errors, deployedState, true, {
      rollbackEnabled: !this.rollbackDisabled(),
    });
    diagnosis.throwOnError();
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
    // Not `rollbackDisabled()`: express deployments also run with rollback disabled, but they must express that
    // through `DeploymentConfig` rather than by sending `DisableRollback` on the call.
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
  express?: boolean;
  stackEventPollingInterval?: number;
}

export interface DestroyStackResult {
  /**
   * The ARN of the stack that was destroyed, if any.
   *
   * If the stack didn't exist to begin with, the operation will succeed
   * but this value will be undefined.
   */
  readonly stackArn?: string;

  /**
   * Resources that reported deletion as complete but are still tearing down.
   *
   * Non-empty only for Express Mode deletions, where CloudFormation reports a
   * resource as `DELETE_COMPLETE` while it continues tearing down asynchronously.
   */
  readonly stabilizingResources: StabilizingResource[];
}

export async function destroyStack(options: DestroyStackOptions, ioHelper: IoHelper): Promise<DestroyStackResult> {
  const deployName = options.deployName || options.stack.stackName;
  const cfn = options.sdk.cloudFormation();

  const currentStack = await CloudFormationStack.lookup(cfn, deployName);
  if (!currentStack.exists) {
    return { stabilizingResources: [] };
  }
  const monitor = new StackActivityMonitor({
    cfn,
    stack: options.stack,
    stackArn: currentStack.stackId,
    ioHelper: ioHelper,
    pollingInterval: options.stackEventPollingInterval,
  });
  await monitor.start();

  try {
    await cfn.deleteStack({ StackName: currentStack.stackId, RoleARN: options.roleArn, ClientRequestToken: randomUUID(), DeploymentConfig: { Mode: options.express ? 'EXPRESS' : 'STANDARD' } });
    const destroyedStack = await waitForStackDelete(cfn, ioHelper, currentStack.stackId, options.stackEventPollingInterval);
    if (destroyedStack && destroyedStack.stackStatus.name !== 'DELETE_COMPLETE') {
      throw new DeploymentError(`Failed to destroy ${deployName}: ${destroyedStack.stackStatus}`, 'StackDestroyFailed');
    }

    return { stackArn: currentStack.stackId, stabilizingResources: monitor.stabilizingResources };
  } catch (e: any) {
    throw new DeploymentError(suffixWithErrors(formatErrorMessage(e), monitor.errors.allErrorMessages), monitor.errors.rootCauseErrorCode ?? 'StackDestroyFailed');
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

  // Executing an existing change set, never skip
  if (deployStackOptions.deploymentMethod?.method === 'execute-change-set') {
    await ioHelper.defaults.debug(`${deployName}: executing existing change set, never skip`);
    return false;
  }

  // Drift-aware
  if (
    deployStackOptions.deploymentMethod?.method === 'change-set' &&
    deployStackOptions.deploymentMethod.revertDrift
  ) {
    await ioHelper.defaults.debug(`${deployName}: --revert-drift, always creating change set`);
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

  // treat template in the hotswap cache as the source of truth
  const hotswapCacheEnv = deployStackOptions.resolvedEnvironment;
  const hotswapCache = await readHotswapTemplateCache(
    deployStackOptions.stack.assembly.directory,
    deployStackOptions.stack.stackName,
    deployStackOptions.stack.template,
    `${hotswapCacheEnv.account}/${hotswapCacheEnv.region}`,
  );
  if (hotswapCache && diffTemplate(hotswapCache.deployedRootTemplate, deployStackOptions.stack.template).differenceCount > 0) {
    await ioHelper.defaults.debug(`${deployName}: template has changed in relation to last successful hotswap deployment`);
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

/**
 * Find the resource changes in a change set that CloudFormation would perform by replacement
 *
 * `Replacement: 'Conditional'` is deliberately excluded: `CDKMetadata` reports it on essentially every CDK deployment
 * (its `Analytics` property is `RequiresRecreation: 'Conditionally'`), so gating on it would gate almost every express
 * deployment. A `Conditional` change that does turn out to replace is caught after the fact by
 * `routeReplacementRejectedWithRollbackDisabled`.
 */
function findReplacements(report: ChangeSetReport): ReplacedResource[] {
  return (report.changeSet.Changes ?? []).flatMap((c) => {
    const change = c.ResourceChange;
    const policyAction = change?.PolicyAction;
    const replacesResource = policyAction === 'ReplaceAndDelete'
      || policyAction === 'ReplaceAndRetain'
      || policyAction === 'ReplaceAndSnapshot';

    if (!change || !replacesResource) {
      return [];
    }

    return [{
      logicalId: change.LogicalResourceId ?? '<unknown>',
      resourceType: change.ResourceType,
      replacement: change.Replacement,
      policyAction,
    }];
  });
}

/**
 * The reason CloudFormation reports when it refuses a replacement because rollback is disabled.
 *
 * CloudFormation surfaces this as a resource status reason with no structured error code attached (`extractErrorCode`
 * finds no `HandlerErrorCode:`/`Error Code:` prefix in it), so matching this text is the only trigger available. That
 * makes it fragile: CloudFormation owns the string and has a change landing around 2026-11-15. Replace this match with
 * a structured discriminator if CloudFormation ever exposes one. A miss is logged at debug level and only costs the
 * extra guidance - the underlying CloudFormation error is reported either way.
 */
export const CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON = 'Replacement type updates not supported on stack with disable-rollback';

function mentionsReplacementRejection(message: string): boolean {
  return message.toLowerCase().includes(CFN_REPLACEMENT_WITH_ROLLBACK_DISABLED_REASON.toLowerCase());
}

/**
 * Explain how to deploy a replacement when rollback is disabled.
 *
 * Replacements are supported in Express Mode; they are not supported while rollback is disabled, which Express Mode
 * does by default. So this routes the user to what actually works instead of just refusing.
 *
 * When we stopped before submitting anything and the stack is healthy, this stays deliberately short and does NOT tell
 * the user to run anything: the caller is about to offer to retry with rollback enabled (which `--force` accepts
 * automatically), so an instruction to run the deployment by hand would be contradicted by what happens next.
 *
 * TODO: point at a CloudFormation User Guide anchor for Express Mode rollback behaviour once one exists.
 */
function replacementRoutingMessage(opts: { rejected: boolean; needsUnwedge: boolean }): string {
  const withRollback = chalk.blue('cdk deploy --express --rollback');
  const direct = chalk.blue('cdk deploy --express --method=direct');

  const headline = opts.rejected
    ? [
      'CloudFormation refused a replacement because rollback is disabled for this stack.',
      'Express Mode disables rollback by default; replacements themselves are supported.',
    ]
    : [
      'This deployment replaces a resource, which CloudFormation does not support while rollback is disabled.',
      'Express Mode disables rollback unless you ask for it with --rollback; replacements themselves are supported.',
    ];

  if (!opts.needsUnwedge) {
    return headline.join('\n');
  }

  // Deploying with rollback enabled cannot update a stack that is already in a failed state - CloudFormation answers
  // "This stack is currently in a non-terminal [UPDATE_FAILED] state" (verified against CloudFormation). The previous
  // configuration has to be replayed first, so say that rather than sending the user into a second failure.
  return [
    ...headline,
    '',
    `${opts.rejected ? 'The stack may now be' : 'This stack is'} in a failed state, which ${withRollback} cannot update. To recover:`,
    '  1. Revert your change so your app matches the last configuration that deployed successfully.',
    `  2. Run ${direct} - this should replay that configuration as a no-op`,
    '     and return the stack to a terminal state.',
    `  3. Re-apply your change and deploy it with ${withRollback}.`,
  ].join('\n');
}

