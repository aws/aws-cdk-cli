"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deployStack = deployStack;
exports.destroyStack = destroyStack;
const util_1 = require("util");
const chalk = require("chalk");
const uuid = require("uuid");
const asset_manifest_builder_1 = require("./asset-manifest-builder");
const asset_publishing_1 = require("./asset-publishing");
const assets_1 = require("./assets");
const cfn_api_1 = require("./cfn-api");
const checks_1 = require("./checks");
const util_2 = require("../../util");
const cloudformation_1 = require("../cloudformation");
const common_1 = require("../hotswap/common");
const hotswap_deployments_1 = require("../hotswap/hotswap-deployments");
const private_1 = require("../io/private");
const stack_events_1 = require("../stack-events");
const toolkit_error_1 = require("../toolkit-error");
async function deployStack(options, ioHelper) {
    const stackArtifact = options.stack;
    const stackEnv = options.resolvedEnvironment;
    options.sdk.appendCustomUserAgent(options.extraUserAgent);
    const cfn = options.sdk.cloudFormation();
    const deployName = options.deployName || stackArtifact.stackName;
    let cloudFormationStack = await cloudformation_1.CloudFormationStack.lookup(cfn, deployName);
    if (cloudFormationStack.stackStatus.isCreationFailure) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Found existing stack ${deployName} that had previously failed creation. Deleting it before attempting to re-create it.`));
        await cfn.deleteStack({ StackName: deployName });
        const deletedStack = await (0, cfn_api_1.waitForStackDelete)(cfn, ioHelper, deployName);
        if (deletedStack && deletedStack.stackStatus.name !== 'DELETE_COMPLETE') {
            throw new toolkit_error_1.ToolkitError(`Failed deleting stack ${deployName} that had previously failed creation (current state: ${deletedStack.stackStatus})`);
        }
        // Update variable to mark that the stack does not exist anymore, but avoid
        // doing an actual lookup in CloudFormation (which would be silly to do if
        // we just deleted it).
        cloudFormationStack = cloudformation_1.CloudFormationStack.doesNotExist(cfn, deployName);
    }
    // Detect "legacy" assets (which remain in the metadata) and publish them via
    // an ad-hoc asset manifest, while passing their locations via template
    // parameters.
    const legacyAssets = new asset_manifest_builder_1.AssetManifestBuilder();
    const assetParams = await (0, assets_1.addMetadataAssetsToManifest)(ioHelper, stackArtifact, legacyAssets, options.envResources, options.reuseAssets);
    const finalParameterValues = { ...options.parameters, ...assetParams };
    const templateParams = cfn_api_1.TemplateParameters.fromTemplate(stackArtifact.template);
    const stackParams = options.usePreviousParameters
        ? templateParams.updateExisting(finalParameterValues, cloudFormationStack.parameters)
        : templateParams.supplyAll(finalParameterValues);
    const hotswapMode = options.hotswap ?? common_1.HotswapMode.FULL_DEPLOYMENT;
    const hotswapPropertyOverrides = options.hotswapPropertyOverrides ?? new common_1.HotswapPropertyOverrides();
    if (await canSkipDeploy(options, cloudFormationStack, stackParams.hasChanges(cloudFormationStack.parameters), ioHelper)) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: skipping deployment (use --force to override)`));
        // if we can skip deployment and we are performing a hotswap, let the user know
        // that no hotswap deployment happened
        if (hotswapMode !== common_1.HotswapMode.FULL_DEPLOYMENT) {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg((0, util_1.format)(`\n ${common_1.ICON} %s\n`, chalk.bold('hotswap deployment skipped - no changes were detected (use --force to override)'))));
        }
        return {
            type: 'did-deploy-stack',
            noOp: true,
            outputs: cloudFormationStack.outputs,
            stackArn: cloudFormationStack.stackId,
        };
    }
    else {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: deploying...`));
    }
    const bodyParameter = await (0, cloudformation_1.makeBodyParameter)(ioHelper, stackArtifact, options.resolvedEnvironment, legacyAssets, options.envResources, options.overrideTemplate);
    let bootstrapStackName;
    try {
        bootstrapStackName = (await options.envResources.lookupToolkit()).stackName;
    }
    catch (e) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Could not determine the bootstrap stack name: ${e}`));
    }
    await (0, asset_publishing_1.publishAssets)(legacyAssets.toManifest(stackArtifact.assembly.directory), options.sdkProvider, stackEnv, {
        parallel: options.assetParallelism,
        allowCrossAccount: await (0, checks_1.determineAllowCrossAccountAssetPublishing)(options.sdk, ioHelper, bootstrapStackName),
    }, ioHelper);
    if (hotswapMode !== common_1.HotswapMode.FULL_DEPLOYMENT) {
        // attempt to short-circuit the deployment if possible
        try {
            const hotswapDeploymentResult = await (0, hotswap_deployments_1.tryHotswapDeployment)(options.sdkProvider, ioHelper, stackParams.values, cloudFormationStack, stackArtifact, hotswapMode, hotswapPropertyOverrides);
            if (hotswapDeploymentResult) {
                return hotswapDeploymentResult;
            }
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg((0, util_1.format)('Could not perform a hotswap deployment, as the stack %s contains non-Asset changes', stackArtifact.displayName)));
        }
        catch (e) {
            if (!(e instanceof cloudformation_1.CfnEvaluationException)) {
                throw e;
            }
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg((0, util_1.format)('Could not perform a hotswap deployment, because the CloudFormation template could not be resolved: %s', (0, util_2.formatErrorMessage)(e))));
        }
        if (hotswapMode === common_1.HotswapMode.FALL_BACK) {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg('Falling back to doing a full deployment'));
            options.sdk.appendCustomUserAgent('cdk-hotswap/fallback');
        }
        else {
            return {
                type: 'did-deploy-stack',
                noOp: true,
                stackArn: cloudFormationStack.stackId,
                outputs: cloudFormationStack.outputs,
            };
        }
    }
    // could not short-circuit the deployment, perform a full CFN deploy instead
    const fullDeployment = new FullCloudFormationDeployment(options, cloudFormationStack, stackArtifact, stackParams, bodyParameter, ioHelper);
    return fullDeployment.performDeployment();
}
/**
 * This class shares state and functionality between the different full deployment modes
 */
class FullCloudFormationDeployment {
    options;
    cloudFormationStack;
    stackArtifact;
    stackParams;
    bodyParameter;
    ioHelper;
    cfn;
    stackName;
    update;
    verb;
    uuid;
    constructor(options, cloudFormationStack, stackArtifact, stackParams, bodyParameter, ioHelper) {
        this.options = options;
        this.cloudFormationStack = cloudFormationStack;
        this.stackArtifact = stackArtifact;
        this.stackParams = stackParams;
        this.bodyParameter = bodyParameter;
        this.ioHelper = ioHelper;
        this.cfn = options.sdk.cloudFormation();
        this.stackName = options.deployName ?? stackArtifact.stackName;
        this.update = cloudFormationStack.exists && cloudFormationStack.stackStatus.name !== 'REVIEW_IN_PROGRESS';
        this.verb = this.update ? 'update' : 'create';
        this.uuid = uuid.v4();
    }
    async performDeployment() {
        const deploymentMethod = this.options.deploymentMethod ?? {
            method: 'change-set',
        };
        if (deploymentMethod.method === 'direct' && this.options.resourcesToImport) {
            throw new toolkit_error_1.ToolkitError('Importing resources requires a changeset deployment');
        }
        switch (deploymentMethod.method) {
            case 'change-set':
                return this.changeSetDeployment(deploymentMethod);
            case 'direct':
                return this.directDeployment();
        }
    }
    async changeSetDeployment(deploymentMethod) {
        const changeSetName = deploymentMethod.changeSetName ?? 'cdk-deploy-change-set';
        const execute = deploymentMethod.execute ?? true;
        const importExistingResources = deploymentMethod.importExistingResources ?? false;
        const changeSetDescription = await this.createChangeSet(changeSetName, execute, importExistingResources);
        await this.updateTerminationProtection();
        if ((0, cfn_api_1.changeSetHasNoChanges)(changeSetDescription)) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('No changes are to be performed on %s.', this.stackName)));
            if (execute) {
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Deleting empty change set %s', changeSetDescription.ChangeSetId)));
                await this.cfn.deleteChangeSet({
                    StackName: this.stackName,
                    ChangeSetName: changeSetName,
                });
            }
            if (this.options.forceDeployment) {
                await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg([
                    'You used the --force flag, but CloudFormation reported that the deployment would not make any changes.',
                    'According to CloudFormation, all resources are already up-to-date with the state in your CDK app.',
                    '',
                    'You cannot use the --force flag to get rid of changes you made in the console. Try using',
                    'CloudFormation drift detection instead: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html',
                ].join('\n')));
            }
            return {
                type: 'did-deploy-stack',
                noOp: true,
                outputs: this.cloudFormationStack.outputs,
                stackArn: changeSetDescription.StackId,
            };
        }
        if (!execute) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg((0, util_1.format)('Changeset %s created and waiting in review for manual execution (--no-execute)', changeSetDescription.ChangeSetId)));
            return {
                type: 'did-deploy-stack',
                noOp: false,
                outputs: this.cloudFormationStack.outputs,
                stackArn: changeSetDescription.StackId,
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
    async createChangeSet(changeSetName, willExecute, importExistingResources) {
        await this.cleanupOldChangeset(changeSetName);
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Attempting to create ChangeSet with name ${changeSetName} to ${this.verb} stack ${this.stackName}`));
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg((0, util_1.format)('%s: creating CloudFormation changeset...', chalk.bold(this.stackName))));
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
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Initiated creation of changeset: %s; waiting for it to finish creating...', changeSet.Id)));
        // Fetching all pages if we'll execute, so we can have the correct change count when monitoring.
        return (0, cfn_api_1.waitForChangeSet)(this.cfn, this.ioHelper, this.stackName, changeSetName, {
            fetchAll: willExecute,
        });
    }
    async executeChangeSet(changeSet) {
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Initiating execution of changeset %s on stack %s', changeSet.ChangeSetId, this.stackName)));
        await this.cfn.executeChangeSet({
            StackName: this.stackName,
            ChangeSetName: changeSet.ChangeSetName,
            ClientRequestToken: `exec${this.uuid}`,
            ...this.commonExecuteOptions(),
        });
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Execution of changeset %s on stack %s has started; waiting for the update to complete...', changeSet.ChangeSetId, this.stackName)));
        // +1 for the extra event emitted from updates.
        const changeSetLength = (changeSet.Changes ?? []).length + (this.update ? 1 : 0);
        return this.monitorDeployment(changeSet.CreationTime, changeSetLength);
    }
    async cleanupOldChangeset(changeSetName) {
        if (this.cloudFormationStack.exists) {
            // Delete any existing change sets generated by CDK since change set names must be unique.
            // The delete request is successful as long as the stack exists (even if the change set does not exist).
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Removing existing change set with name ${changeSetName} if it exists`));
            await this.cfn.deleteChangeSet({
                StackName: this.stackName,
                ChangeSetName: changeSetName,
            });
        }
    }
    async updateTerminationProtection() {
        // Update termination protection only if it has changed.
        const terminationProtection = this.stackArtifact.terminationProtection ?? false;
        if (!!this.cloudFormationStack.terminationProtection !== terminationProtection) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Updating termination protection from %s to %s for stack %s', this.cloudFormationStack.terminationProtection, terminationProtection, this.stackName)));
            await this.cfn.updateTerminationProtection({
                StackName: this.stackName,
                EnableTerminationProtection: terminationProtection,
            });
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Termination protection updated to %s for stack %s', terminationProtection, this.stackName)));
        }
    }
    async directDeployment() {
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg((0, util_1.format)('%s: %s stack...', chalk.bold(this.stackName), this.update ? 'updating' : 'creating')));
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
            }
            catch (err) {
                if (err.message === 'No updates are to be performed.') {
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('No updates are to be performed for stack %s', this.stackName)));
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
        }
        else {
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
    async monitorDeployment(startTime, expectedChanges) {
        const monitor = new stack_events_1.StackActivityMonitor({
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
            const successStack = await (0, cfn_api_1.waitForStackDeploy)(this.cfn, this.ioHelper, this.stackName);
            // This shouldn't really happen, but catch it anyway. You never know.
            if (!successStack) {
                throw new toolkit_error_1.ToolkitError('Stack deploy failed (the stack disappeared while we were deploying it)');
            }
            finalState = successStack;
        }
        catch (e) {
            throw new toolkit_error_1.ToolkitError(suffixWithErrors((0, util_2.formatErrorMessage)(e), monitor.errors));
        }
        finally {
            await monitor.stop();
        }
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Stack %s has completed updating', this.stackName)));
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
    commonPrepareOptions() {
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
    commonExecuteOptions() {
        const shouldDisableRollback = this.options.rollback === false;
        return {
            StackName: this.stackName,
            ...(shouldDisableRollback ? { DisableRollback: true } : undefined),
        };
    }
}
async function destroyStack(options, ioHelper) {
    const deployName = options.deployName || options.stack.stackName;
    const cfn = options.sdk.cloudFormation();
    const currentStack = await cloudformation_1.CloudFormationStack.lookup(cfn, deployName);
    if (!currentStack.exists) {
        return {};
    }
    const monitor = new stack_events_1.StackActivityMonitor({
        cfn,
        stack: options.stack,
        stackName: deployName,
        ioHelper: ioHelper,
    });
    await monitor.start();
    try {
        await cfn.deleteStack({ StackName: deployName, RoleARN: options.roleArn });
        const destroyedStack = await (0, cfn_api_1.waitForStackDelete)(cfn, ioHelper, deployName);
        if (destroyedStack && destroyedStack.stackStatus.name !== 'DELETE_COMPLETE') {
            throw new toolkit_error_1.ToolkitError(`Failed to destroy ${deployName}: ${destroyedStack.stackStatus}`);
        }
        return { stackArn: currentStack.stackId };
    }
    catch (e) {
        throw new toolkit_error_1.ToolkitError(suffixWithErrors((0, util_2.formatErrorMessage)(e), monitor.errors));
    }
    finally {
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
async function canSkipDeploy(deployStackOptions, cloudFormationStack, parameterChanges, ioHelper) {
    const deployName = deployStackOptions.deployName || deployStackOptions.stack.stackName;
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: checking if we can skip deploy`));
    // Forced deploy
    if (deployStackOptions.forceDeployment) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: forced deployment`));
        return false;
    }
    // Creating changeset only (default true), never skip
    if (deployStackOptions.deploymentMethod?.method === 'change-set' &&
        deployStackOptions.deploymentMethod.execute === false) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: --no-execute, always creating change set`));
        return false;
    }
    // No existing stack
    if (!cloudFormationStack.exists) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: no existing stack`));
        return false;
    }
    // Template has changed (assets taken into account here)
    if (JSON.stringify(deployStackOptions.stack.template) !== JSON.stringify(await cloudFormationStack.template())) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: template has changed`));
        return false;
    }
    // Tags have changed
    if (!compareTags(cloudFormationStack.tags, deployStackOptions.tags ?? [])) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: tags have changed`));
        return false;
    }
    // Notification arns have changed
    if (!arrayEquals(cloudFormationStack.notificationArns, deployStackOptions.notificationArns ?? [])) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: notification arns have changed`));
        return false;
    }
    // Termination protection has been updated
    if (!!deployStackOptions.stack.terminationProtection !== !!cloudFormationStack.terminationProtection) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: termination protection has been updated`));
        return false;
    }
    // Parameters have changed
    if (parameterChanges) {
        if (parameterChanges === 'ssm') {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: some parameters come from SSM so we have to assume they may have changed`));
        }
        else {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: parameters have changed`));
        }
        return false;
    }
    // Existing stack is in a failed state
    if (cloudFormationStack.stackStatus.isFailure) {
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`${deployName}: stack is in a failure state`));
        return false;
    }
    // We can skip deploy
    return true;
}
/**
 * Compares two list of tags, returns true if identical.
 */
function compareTags(a, b) {
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
function suffixWithErrors(msg, errors) {
    return errors && errors.length > 0 ? `${msg}: ${errors.join(', ')}` : msg;
}
function arrayEquals(a, b) {
    return a.every((item) => b.includes(item)) && b.every((item) => a.includes(item));
}
function hasReplacement(cs) {
    return (cs.Changes ?? []).some(c => {
        const a = c.ResourceChange?.PolicyAction;
        return a === 'ReplaceAndDelete' || a === 'ReplaceAndRetain' || a === 'ReplaceAndSnapshot';
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95LXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2FwaS9kZXBsb3ltZW50cy9kZXBsb3ktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUEwTUEsa0NBZ0pDO0FBeVVELG9DQStCQztBQWxzQkQsK0JBQThCO0FBVTlCLCtCQUErQjtBQUMvQiw2QkFBNkI7QUFDN0IscUVBQWdFO0FBQ2hFLHlEQUFtRDtBQUNuRCxxQ0FBdUQ7QUFLdkQsdUNBTW1CO0FBQ25CLHFDQUFxRTtBQUdyRSxxQ0FBZ0Q7QUFHaEQsc0RBQW1HO0FBRW5HLDhDQUFnRjtBQUNoRix3RUFBc0U7QUFDdEUsMkNBQWtEO0FBRWxELGtEQUF1RDtBQUN2RCxvREFBZ0Q7QUFtS3pDLEtBQUssVUFBVSxXQUFXLENBQUMsT0FBMkIsRUFBRSxRQUFrQjtJQUMvRSxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDO0lBRXBDLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQztJQUU3QyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUMxRCxNQUFNLEdBQUcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsRUFBRSxDQUFDO0lBQ3pDLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxVQUFVLElBQUksYUFBYSxDQUFDLFNBQVMsQ0FBQztJQUNqRSxJQUFJLG1CQUFtQixHQUFHLE1BQU0sb0NBQW1CLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxVQUFVLENBQUMsQ0FBQztJQUU1RSxJQUFJLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQ3RELE1BQU0sUUFBUSxDQUFDLE1BQU0sQ0FBQyxZQUFFLENBQUMscUJBQXFCLENBQUMsR0FBRyxDQUNoRCx3QkFBd0IsVUFBVSxzRkFBc0YsQ0FDekgsQ0FBQyxDQUFDO1FBQ0gsTUFB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QUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7QUFDNUUsQ0FBQztBQUVELFNBQVMsV0FBVyxDQUFDLENBQVEsRUFBRSxDQUFRO0lBQ3JDLE9BQU8sQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUNwRixDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsRUFBa0M7SUFDeEQsT0FBTyxDQUFDLEVBQUUsQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFO1FBQ2pDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxjQUFjLEVBQUUsWUFBWSxDQUFDO1FBQ3pDLE9BQU8sQ0FBQyxLQUFLLGtCQUFrQixJQUFJLENBQUMsS0FBSyxrQkFBa0IsSUFBSSxDQUFDLEtBQUssb0JBQW9CLENBQUM7SUFDNUYsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZm9ybWF0IH0gZnJvbSAndXRpbCc7XG5pbXBvcnQgdHlwZSAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgdHlwZSB7XG4gIENyZWF0ZUNoYW5nZVNldENvbW1hbmRJbnB1dCxcbiAgQ3JlYXRlU3RhY2tDb21tYW5kSW5wdXQsXG4gIERlc2NyaWJlQ2hhbmdlU2V0Q29tbWFuZE91dHB1dCxcbiAgRXhlY3V0ZUNoYW5nZVNldENvbW1hbmRJbnB1dCxcbiAgVXBkYXRlU3RhY2tDb21tYW5kSW5wdXQsXG4gIFRhZyxcbn0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uJztcbmltcG9ydCAqIGFzIGNoYWxrIGZyb20gJ2NoYWxrJztcbmltcG9ydCAqIGFzIHV1aWQgZnJvbSAndXVpZCc7XG5pbXBvcnQgeyBBc3NldE1hbmlmZXN0QnVpbGRlciB9IGZyb20gJy4vYXNzZXQtbWFuaWZlc3QtYnVpbGRlcic7XG5pbXBvcnQgeyBwdWJsaXNoQXNzZXRzIH0gZnJvbSAnLi9hc3NldC1wdWJsaXNoaW5nJztcbmltcG9ydCB7IGFkZE1ldGFkYXRhQXNzZXRzVG9NYW5pZmVzdCB9IGZyb20gJy4vYXNzZXRzJztcbmltcG9ydCB0eXBlIHtcbiAgUGFyYW1ldGVyVmFsdWVzLFxuICBQYXJhbWV0ZXJDaGFuZ2VzLFxufSBmcm9tICcuL2Nmbi1hcGknO1xuaW1wb3J0IHtcbiAgY2hhbmdlU2V0SGFzTm9DaGFuZ2VzLFxuICBUZW1wbGF0ZVBhcmFtZXRlcnMsXG4gIHdhaXRGb3JDaGFuZ2VTZXQsXG4gIHdhaXRGb3JTdGFja0RlcGxveSxcbiAgd2FpdEZvclN0YWNrRGVsZXRlLFxufSBmcm9tICcuL2Nmbi1hcGknO1xuaW1wb3J0IHsgZGV0ZXJtaW5lQWxsb3dDcm9zc0FjY291bnRBc3NldFB1Ymxpc2hpbmcgfSBmcm9tICcuL2NoZWNrcyc7XG5pbXBvcnQgdHlwZSB7IENoYW5nZVNldERlcGxveW1lbnRNZXRob2QsIERlcGxveW1lbnRNZXRob2QgfSBmcm9tICcuL2RlcGxveW1lbnQtbWV0aG9kJztcbmltcG9ydCB0eXBlIHsgRGVwbG95U3RhY2tSZXN1bHQsIFN1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdCB9IGZyb20gJy4vZGVwbG95bWVudC1yZXN1bHQnO1xuaW1wb3J0IHsgZm9ybWF0RXJyb3JNZXNzYWdlIH0gZnJvbSAnLi4vLi4vdXRpbCc7XG5pbXBvcnQgdHlwZSB7IFNESywgU2RrUHJvdmlkZXIsIElDbG91ZEZvcm1hdGlvbkNsaWVudCB9IGZyb20gJy4uL2F3cy1hdXRoJztcbmltcG9ydCB0eXBlIHsgVGVtcGxhdGVCb2R5UGFyYW1ldGVyIH0gZnJvbSAnLi4vY2xvdWRmb3JtYXRpb24nO1xuaW1wb3J0IHsgbWFrZUJvZHlQYXJhbWV0ZXIsIENmbkV2YWx1YXRpb25FeGNlcHRpb24sIENsb3VkRm9ybWF0aW9uU3RhY2sgfSBmcm9tICcuLi9jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgdHlwZSB7IEVudmlyb25tZW50UmVzb3VyY2VzLCBTdHJpbmdXaXRob3V0UGxhY2Vob2xkZXJzIH0gZnJvbSAnLi4vZW52aXJvbm1lbnQnO1xuaW1wb3J0IHsgSG90c3dhcE1vZGUsIEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcywgSUNPTiB9IGZyb20gJy4uL2hvdHN3YXAvY29tbW9uJztcbmltcG9ydCB7IHRyeUhvdHN3YXBEZXBsb3ltZW50IH0gZnJvbSAnLi4vaG90c3dhcC9ob3Rzd2FwLWRlcGxveW1lbnRzJztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgdHlwZSB7IFJlc291cmNlc1RvSW1wb3J0IH0gZnJvbSAnLi4vcmVzb3VyY2UtaW1wb3J0JztcbmltcG9ydCB7IFN0YWNrQWN0aXZpdHlNb25pdG9yIH0gZnJvbSAnLi4vc3RhY2stZXZlbnRzJztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4uL3Rvb2xraXQtZXJyb3InO1xuXG5leHBvcnQgaW50ZXJmYWNlIERlcGxveVN0YWNrT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgc3RhY2sgdG8gYmUgZGVwbG95ZWRcbiAgICovXG4gIHJlYWRvbmx5IHN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q7XG5cbiAgLyoqXG4gICAqIFRoZSBlbnZpcm9ubWVudCB0byBkZXBsb3kgdGhpcyBzdGFjayBpblxuICAgKlxuICAgKiBUaGUgZW52aXJvbm1lbnQgb24gdGhlIHN0YWNrIGFydGlmYWN0IG1heSBiZSB1bnJlc29sdmVkLCB0aGlzIG9uZVxuICAgKiBtdXN0IGJlIHJlc29sdmVkLlxuICAgKi9cbiAgcmVhZG9ubHkgcmVzb2x2ZWRFbnZpcm9ubWVudDogY3hhcGkuRW52aXJvbm1lbnQ7XG5cbiAgLyoqXG4gICAqIFRoZSBTREsgdG8gdXNlIGZvciBkZXBsb3lpbmcgdGhlIHN0YWNrXG4gICAqXG4gICAqIFNob3VsZCBoYXZlIGJlZW4gaW5pdGlhbGl6ZWQgd2l0aCB0aGUgY29ycmVjdCByb2xlIHdpdGggd2hpY2hcbiAgICogc3RhY2sgb3BlcmF0aW9ucyBzaG91bGQgYmUgcGVyZm9ybWVkLlxuICAgKi9cbiAgcmVhZG9ubHkgc2RrOiBTREs7XG5cbiAgLyoqXG4gICAqIFNESyBwcm92aWRlciAoc2VlZGVkIHdpdGggZGVmYXVsdCBjcmVkZW50aWFscylcbiAgICpcbiAgICogV2lsbCBiZSB1c2VkIHRvOlxuICAgKlxuICAgKiAtIFB1Ymxpc2ggYXNzZXRzLCBlaXRoZXIgbGVnYWN5IGFzc2V0cyBvciBsYXJnZSBDRk4gdGVtcGxhdGVzXG4gICAqICAgdGhhdCBhcmVuJ3QgdGhlbXNlbHZlcyBhc3NldHMgZnJvbSBhIG1hbmlmZXN0LiAoTmVlZHMgYW4gU0RLXG4gICAqICAgUHJvdmlkZXIgYmVjYXVzZSB0aGUgZmlsZSBwdWJsaXNoaW5nIHJvbGUgaXMgZGVjbGFyZWQgYXMgcGFydFxuICAgKiAgIG9mIHRoZSBhc3NldCkuXG4gICAqIC0gSG90c3dhcFxuICAgKi9cbiAgcmVhZG9ubHkgc2RrUHJvdmlkZXI6IFNka1Byb3ZpZGVyO1xuXG4gIC8qKlxuICAgKiBJbmZvcm1hdGlvbiBhYm91dCB0aGUgYm9vdHN0cmFwIHN0YWNrIGZvdW5kIGluIHRoZSB0YXJnZXQgZW52aXJvbm1lbnRcbiAgICovXG4gIHJlYWRvbmx5IGVudlJlc291cmNlczogRW52aXJvbm1lbnRSZXNvdXJjZXM7XG5cbiAgLyoqXG4gICAqIFJvbGUgdG8gcGFzcyB0byBDbG91ZEZvcm1hdGlvbiB0byBleGVjdXRlIHRoZSBjaGFuZ2Ugc2V0XG4gICAqXG4gICAqIFRvIG9idGFpbiBhIGBTdHJpbmdXaXRob3V0UGxhY2Vob2xkZXJzYCwgcnVuIGEgcmVndWxhclxuICAgKiBzdHJpbmcgdGhvdWdoIGBUYXJnZXRFbnZpcm9ubWVudC5yZXBsYWNlUGxhY2Vob2xkZXJzYC5cbiAgICpcbiAgICogQGRlZmF1bHQgLSBObyBleGVjdXRpb24gcm9sZTsgQ2xvdWRGb3JtYXRpb24gZWl0aGVyIHVzZXMgdGhlIHJvbGUgY3VycmVudGx5IGFzc29jaWF0ZWQgd2l0aFxuICAgKiB0aGUgc3RhY2ssIG9yIG90aGVyd2lzZSB1c2VzIGN1cnJlbnQgQVdTIGNyZWRlbnRpYWxzLlxuICAgKi9cbiAgcmVhZG9ubHkgcm9sZUFybj86IFN0cmluZ1dpdGhvdXRQbGFjZWhvbGRlcnM7XG5cbiAgLyoqXG4gICAqIE5vdGlmaWNhdGlvbiBBUk5zIHRvIHBhc3MgdG8gQ2xvdWRGb3JtYXRpb24gdG8gbm90aWZ5IHdoZW4gdGhlIGNoYW5nZSBzZXQgaGFzIGNvbXBsZXRlZFxuICAgKlxuICAgKiBAZGVmYXVsdCAtIE5vIG5vdGlmaWNhdGlvbnNcbiAgICovXG4gIHJlYWRvbmx5IG5vdGlmaWNhdGlvbkFybnM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogTmFtZSB0byBkZXBsb3kgdGhlIHN0YWNrIHVuZGVyXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gTmFtZSBmcm9tIGFzc2VtYmx5XG4gICAqL1xuICByZWFkb25seSBkZXBsb3lOYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBMaXN0IG9mIGFzc2V0IElEcyB3aGljaCBzaG91bGRuJ3QgYmUgYnVpbHRcbiAgICpcbiAgICogQGRlZmF1bHQgLSBCdWlsZCBhbGwgYXNzZXRzXG4gICAqL1xuICByZWFkb25seSByZXVzZUFzc2V0cz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBUYWdzIHRvIHBhc3MgdG8gQ2xvdWRGb3JtYXRpb24gdG8gYWRkIHRvIHN0YWNrXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gTm8gdGFnc1xuICAgKi9cbiAgcmVhZG9ubHkgdGFncz86IFRhZ1tdO1xuXG4gIC8qKlxuICAgKiBXaGF0IGRlcGxveW1lbnQgbWV0aG9kIHRvIHVzZVxuICAgKlxuICAgKiBAZGVmYXVsdCAtIENoYW5nZSBzZXQgd2l0aCBkZWZhdWx0c1xuICAgKi9cbiAgcmVhZG9ubHkgZGVwbG95bWVudE1ldGhvZD86IERlcGxveW1lbnRNZXRob2Q7XG5cbiAgLyoqXG4gICAqIFRoZSBjb2xsZWN0aW9uIG9mIGV4dHJhIHBhcmFtZXRlcnNcbiAgICogKGluIGFkZGl0aW9uIHRvIHRob3NlIHVzZWQgZm9yIGFzc2V0cylcbiAgICogdG8gcGFzcyB0byB0aGUgZGVwbG95ZWQgdGVtcGxhdGUuXG4gICAqIE5vdGUgdGhhdCBwYXJhbWV0ZXJzIHdpdGggYHVuZGVmaW5lZGAgb3IgZW1wdHkgdmFsdWVzIHdpbGwgYmUgaWdub3JlZCxcbiAgICogYW5kIG5vdCBwYXNzZWQgdG8gdGhlIHRlbXBsYXRlLlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIG5vIGFkZGl0aW9uYWwgcGFyYW1ldGVycyB3aWxsIGJlIHBhc3NlZCB0byB0aGUgdGVtcGxhdGVcbiAgICovXG4gIHJlYWRvbmx5IHBhcmFtZXRlcnM/OiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfCB1bmRlZmluZWQgfTtcblxuICAvKipcbiAgICogVXNlIHByZXZpb3VzIHZhbHVlcyBmb3IgdW5zcGVjaWZpZWQgcGFyYW1ldGVyc1xuICAgKlxuICAgKiBJZiBub3Qgc2V0LCBhbGwgcGFyYW1ldGVycyBtdXN0IGJlIHNwZWNpZmllZCBmb3IgZXZlcnkgZGVwbG95bWVudC5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IHVzZVByZXZpb3VzUGFyYW1ldGVycz86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERlcGxveSBldmVuIGlmIHRoZSBkZXBsb3llZCB0ZW1wbGF0ZSBpcyBpZGVudGljYWwgdG8gdGhlIG9uZSB3ZSBhcmUgYWJvdXQgdG8gZGVwbG95LlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgZm9yY2VEZXBsb3ltZW50PzogYm9vbGVhbjtcblxuICAvKipcbiAgICogUm9sbGJhY2sgZmFpbGVkIGRlcGxveW1lbnRzXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IHJvbGxiYWNrPzogYm9vbGVhbjtcblxuICAvKlxuICAgKiBXaGV0aGVyIHRvIHBlcmZvcm0gYSAnaG90c3dhcCcgZGVwbG95bWVudC5cbiAgICogQSAnaG90c3dhcCcgZGVwbG95bWVudCB3aWxsIGF0dGVtcHQgdG8gc2hvcnQtY2lyY3VpdCBDbG91ZEZvcm1hdGlvblxuICAgKiBhbmQgdXBkYXRlIHRoZSBhZmZlY3RlZCByZXNvdXJjZXMgbGlrZSBMYW1iZGEgZnVuY3Rpb25zIGRpcmVjdGx5LlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIGBIb3Rzd2FwTW9kZS5GVUxMX0RFUExPWU1FTlRgIGZvciByZWd1bGFyIGRlcGxveW1lbnRzLCBgSG90c3dhcE1vZGUuSE9UU1dBUF9PTkxZYCBmb3IgJ3dhdGNoJyBkZXBsb3ltZW50c1xuICAgKi9cbiAgcmVhZG9ubHkgaG90c3dhcD86IEhvdHN3YXBNb2RlO1xuXG4gIC8qKlxuICAgKiBFeHRyYSBwcm9wZXJ0aWVzIHRoYXQgY29uZmlndXJlIGhvdHN3YXAgYmVoYXZpb3JcbiAgICovXG4gIHJlYWRvbmx5IGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcz86IEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcztcblxuICAvKipcbiAgICogVGhlIGV4dHJhIHN0cmluZyB0byBhcHBlbmQgdG8gdGhlIFVzZXItQWdlbnQgaGVhZGVyIHdoZW4gcGVyZm9ybWluZyBBV1MgU0RLIGNhbGxzLlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIG5vdGhpbmcgZXh0cmEgaXMgYXBwZW5kZWQgdG8gdGhlIFVzZXItQWdlbnQgaGVhZGVyXG4gICAqL1xuICByZWFkb25seSBleHRyYVVzZXJBZ2VudD86IHN0cmluZztcblxuICAvKipcbiAgICogSWYgc2V0LCBjaGFuZ2Ugc2V0IG9mIHR5cGUgSU1QT1JUIHdpbGwgYmUgY3JlYXRlZCwgYW5kIHJlc291cmNlc1RvSW1wb3J0XG4gICAqIHBhc3NlZCB0byBpdC5cbiAgICovXG4gIHJlYWRvbmx5IHJlc291cmNlc1RvSW1wb3J0PzogUmVzb3VyY2VzVG9JbXBvcnQ7XG5cbiAgLyoqXG4gICAqIElmIHByZXNlbnQsIHVzZSB0aGlzIGdpdmVuIHRlbXBsYXRlIGluc3RlYWQgb2YgdGhlIHN0b3JlZCBvbmVcbiAgICpcbiAgICogQGRlZmF1bHQgLSBVc2UgdGhlIHN0b3JlZCB0ZW1wbGF0ZVxuICAgKi9cbiAgcmVhZG9ubHkgb3ZlcnJpZGVUZW1wbGF0ZT86IGFueTtcblxuICAvKipcbiAgICogV2hldGhlciB0byBidWlsZC9wdWJsaXNoIGFzc2V0cyBpbiBwYXJhbGxlbFxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlIFRvIHJlbWFpbiBiYWNrd2FyZCBjb21wYXRpYmxlLlxuICAgKi9cbiAgcmVhZG9ubHkgYXNzZXRQYXJhbGxlbGlzbT86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZXBsb3lTdGFjayhvcHRpb25zOiBEZXBsb3lTdGFja09wdGlvbnMsIGlvSGVscGVyOiBJb0hlbHBlcik6IFByb21pc2U8RGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgY29uc3Qgc3RhY2tBcnRpZmFjdCA9IG9wdGlvbnMuc3RhY2s7XG5cbiAgY29uc3Qgc3RhY2tFbnYgPSBvcHRpb25zLnJlc29sdmVkRW52aXJvbm1lbnQ7XG5cbiAgb3B0aW9ucy5zZGsuYXBwZW5kQ3VzdG9tVXNlckFnZW50KG9wdGlvbnMuZXh0cmFVc2VyQWdlbnQpO1xuICBjb25zdCBjZm4gPSBvcHRpb25zLnNkay5jbG91ZEZvcm1hdGlvbigpO1xuICBjb25zdCBkZXBsb3lOYW1lID0gb3B0aW9ucy5kZXBsb3lOYW1lIHx8IHN0YWNrQXJ0aWZhY3Quc3RhY2tOYW1lO1xuICBsZXQgY2xvdWRGb3JtYXRpb25TdGFjayA9IGF3YWl0IENsb3VkRm9ybWF0aW9uU3RhY2subG9va3VwKGNmbiwgZGVwbG95TmFtZSk7XG5cbiAgaWYgKGNsb3VkRm9ybWF0aW9uU3RhY2suc3RhY2tTdGF0dXMuaXNDcmVhdGlvbkZhaWx1cmUpIHtcbiAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhcbiAgICAgIGBGb3VuZCBleGlzdGluZyBzdGFjayAke2RlcGxveU5hbWV9IHRoYXQgaGFkIHByZXZpb3VzbHkgZmFpbGVkIGNyZWF0aW9uLiBEZWxldGluZyBpdCBiZWZvcmUgYXR0ZW1wdGluZyB0byByZS1jcmVhdGUgaXQuYCxcbiAgICApKTtcbiAgICBhd2FpdCBjZm4uZGVsZXRlU3RhY2soeyBTdGFja05hbWU6IGRlcGxveU5hbWUgfSk7XG4gICAgY29uc3QgZGVsZXRlZFN0YWNrID0gYXdhaXQgd2FpdEZvclN0YWNrRGVsZXRlKGNmbiwgaW9IZWxwZXIsIGRlcGxveU5hbWUpO1xuICAgIGlmIChkZWxldGVkU3RhY2sgJiYgZGVsZXRlZFN0YWNrLnN0YWNrU3RhdHVzLm5hbWUgIT09ICdERUxFVEVfQ09NUExFVEUnKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKFxuICAgICAgICBgRmFpbGVkIGRlbGV0aW5nIHN0YWNrICR7ZGVwbG95TmFtZX0gdGhhdCBoYWQgcHJldmlvdXNseSBmYWlsZWQgY3JlYXRpb24gKGN1cnJlbnQgc3RhdGU6ICR7ZGVsZXRlZFN0YWNrLnN0YWNrU3RhdHVzfSlgLFxuICAgICAgKTtcbiAgICB9XG4gICAgLy8gVXBkYXRlIHZhcmlhYmxlIHRvIG1hcmsgdGhhdCB0aGUgc3RhY2sgZG9lcyBub3QgZXhpc3QgYW55bW9yZSwgYnV0IGF2b2lkXG4gICAgLy8gZG9pbmcgYW4gYWN0dWFsIGxvb2t1cCBpbiBDbG91ZEZvcm1hdGlvbiAod2hpY2ggd291bGQgYmUgc2lsbHkgdG8gZG8gaWZcbiAgICAvLyB3ZSBqdXN0IGRlbGV0ZWQgaXQpLlxuICAgIGNsb3VkRm9ybWF0aW9uU3RhY2sgPSBDbG91ZEZvcm1hdGlvblN0YWNrLmRvZXNOb3RFeGlzdChjZm4sIGRlcGxveU5hbWUpO1xuICB9XG5cbiAgLy8gRGV0ZWN0IFwibGVnYWN5XCIgYXNzZXRzICh3aGljaCByZW1haW4gaW4gdGhlIG1ldGFkYXRhKSBhbmQgcHVibGlzaCB0aGVtIHZpYVxuICAvLyBhbiBhZC1ob2MgYXNzZXQgbWFuaWZlc3QsIHdoaWxlIHBhc3NpbmcgdGhlaXIgbG9jYXRpb25zIHZpYSB0ZW1wbGF0ZVxuICAvLyBwYXJhbWV0ZXJzLlxuICBjb25zdCBsZWdhY3lBc3NldHMgPSBuZXcgQXNzZXRNYW5pZmVzdEJ1aWxkZXIoKTtcbiAgY29uc3QgYXNzZXRQYXJhbXMgPSBhd2FpdCBhZGRNZXRhZGF0YUFzc2V0c1RvTWFuaWZlc3QoXG4gICAgaW9IZWxwZXIsXG4gICAgc3RhY2tBcnRpZmFjdCxcbiAgICBsZWdhY3lBc3NldHMsXG4gICAgb3B0aW9ucy5lbnZSZXNvdXJjZXMsXG4gICAgb3B0aW9ucy5yZXVzZUFzc2V0cyxcbiAgKTtcblxuICBjb25zdCBmaW5hbFBhcmFtZXRlclZhbHVlcyA9IHsgLi4ub3B0aW9ucy5wYXJhbWV0ZXJzLCAuLi5hc3NldFBhcmFtcyB9O1xuXG4gIGNvbnN0IHRlbXBsYXRlUGFyYW1zID0gVGVtcGxhdGVQYXJhbWV0ZXJzLmZyb21UZW1wbGF0ZShzdGFja0FydGlmYWN0LnRlbXBsYXRlKTtcbiAgY29uc3Qgc3RhY2tQYXJhbXMgPSBvcHRpb25zLnVzZVByZXZpb3VzUGFyYW1ldGVyc1xuICAgID8gdGVtcGxhdGVQYXJhbXMudXBkYXRlRXhpc3RpbmcoZmluYWxQYXJhbWV0ZXJWYWx1ZXMsIGNsb3VkRm9ybWF0aW9uU3RhY2sucGFyYW1ldGVycylcbiAgICA6IHRlbXBsYXRlUGFyYW1zLnN1cHBseUFsbChmaW5hbFBhcmFtZXRlclZhbHVlcyk7XG5cbiAgY29uc3QgaG90c3dhcE1vZGUgPSBvcHRpb25zLmhvdHN3YXAgPz8gSG90c3dhcE1vZGUuRlVMTF9ERVBMT1lNRU5UO1xuICBjb25zdCBob3Rzd2FwUHJvcGVydHlPdmVycmlkZXMgPSBvcHRpb25zLmhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyA/PyBuZXcgSG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzKCk7XG5cbiAgaWYgKGF3YWl0IGNhblNraXBEZXBsb3kob3B0aW9ucywgY2xvdWRGb3JtYXRpb25TdGFjaywgc3RhY2tQYXJhbXMuaGFzQ2hhbmdlcyhjbG91ZEZvcm1hdGlvblN0YWNrLnBhcmFtZXRlcnMpLCBpb0hlbHBlcikpIHtcbiAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZXBsb3lOYW1lfTogc2tpcHBpbmcgZGVwbG95bWVudCAodXNlIC0tZm9yY2UgdG8gb3ZlcnJpZGUpYCkpO1xuICAgIC8vIGlmIHdlIGNhbiBza2lwIGRlcGxveW1lbnQgYW5kIHdlIGFyZSBwZXJmb3JtaW5nIGEgaG90c3dhcCwgbGV0IHRoZSB1c2VyIGtub3dcbiAgICAvLyB0aGF0IG5vIGhvdHN3YXAgZGVwbG95bWVudCBoYXBwZW5lZFxuICAgIGlmIChob3Rzd2FwTW9kZSAhPT0gSG90c3dhcE1vZGUuRlVMTF9ERVBMT1lNRU5UKSB7XG4gICAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0lORk8ubXNnKFxuICAgICAgICBmb3JtYXQoXG4gICAgICAgICAgYFxcbiAke0lDT059ICVzXFxuYCxcbiAgICAgICAgICBjaGFsay5ib2xkKCdob3Rzd2FwIGRlcGxveW1lbnQgc2tpcHBlZCAtIG5vIGNoYW5nZXMgd2VyZSBkZXRlY3RlZCAodXNlIC0tZm9yY2UgdG8gb3ZlcnJpZGUpJyksXG4gICAgICAgICksXG4gICAgICApKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6ICdkaWQtZGVwbG95LXN0YWNrJyxcbiAgICAgIG5vT3A6IHRydWUsXG4gICAgICBvdXRwdXRzOiBjbG91ZEZvcm1hdGlvblN0YWNrLm91dHB1dHMsXG4gICAgICBzdGFja0FybjogY2xvdWRGb3JtYXRpb25TdGFjay5zdGFja0lkLFxuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYCR7ZGVwbG95TmFtZX06IGRlcGxveWluZy4uLmApKTtcbiAgfVxuXG4gIGNvbnN0IGJvZHlQYXJhbWV0ZXIgPSBhd2FpdCBtYWtlQm9keVBhcmFtZXRlcihcbiAgICBpb0hlbHBlcixcbiAgICBzdGFja0FydGlmYWN0LFxuICAgIG9wdGlvbnMucmVzb2x2ZWRFbnZpcm9ubWVudCxcbiAgICBsZWdhY3lBc3NldHMsXG4gICAgb3B0aW9ucy5lbnZSZXNvdXJjZXMsXG4gICAgb3B0aW9ucy5vdmVycmlkZVRlbXBsYXRlLFxuICApO1xuICBsZXQgYm9vdHN0cmFwU3RhY2tOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHRyeSB7XG4gICAgYm9vdHN0cmFwU3RhY2tOYW1lID0gKGF3YWl0IG9wdGlvbnMuZW52UmVzb3VyY2VzLmxvb2t1cFRvb2xraXQoKSkuc3RhY2tOYW1lO1xuICB9IGNhdGNoIChlKSB7XG4gICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYENvdWxkIG5vdCBkZXRlcm1pbmUgdGhlIGJvb3RzdHJhcCBzdGFjayBuYW1lOiAke2V9YCkpO1xuICB9XG4gIGF3YWl0IHB1Ymxpc2hBc3NldHMobGVnYWN5QXNzZXRzLnRvTWFuaWZlc3Qoc3RhY2tBcnRpZmFjdC5hc3NlbWJseS5kaXJlY3RvcnkpLCBvcHRpb25zLnNka1Byb3ZpZGVyLCBzdGFja0Vudiwge1xuICAgIHBhcmFsbGVsOiBvcHRpb25zLmFzc2V0UGFyYWxsZWxpc20sXG4gICAgYWxsb3dDcm9zc0FjY291bnQ6IGF3YWl0IGRldGVybWluZUFsbG93Q3Jvc3NBY2NvdW50QXNzZXRQdWJsaXNoaW5nKG9wdGlvbnMuc2RrLCBpb0hlbHBlciwgYm9vdHN0cmFwU3RhY2tOYW1lKSxcbiAgfSwgaW9IZWxwZXIpO1xuXG4gIGlmIChob3Rzd2FwTW9kZSAhPT0gSG90c3dhcE1vZGUuRlVMTF9ERVBMT1lNRU5UKSB7XG4gICAgLy8gYXR0ZW1wdCB0byBzaG9ydC1jaXJjdWl0IHRoZSBkZXBsb3ltZW50IGlmIHBvc3NpYmxlXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhvdHN3YXBEZXBsb3ltZW50UmVzdWx0ID0gYXdhaXQgdHJ5SG90c3dhcERlcGxveW1lbnQoXG4gICAgICAgIG9wdGlvbnMuc2RrUHJvdmlkZXIsXG4gICAgICAgIGlvSGVscGVyLFxuICAgICAgICBzdGFja1BhcmFtcy52YWx1ZXMsXG4gICAgICAgIGNsb3VkRm9ybWF0aW9uU3RhY2ssXG4gICAgICAgIHN0YWNrQXJ0aWZhY3QsXG4gICAgICAgIGhvdHN3YXBNb2RlLFxuICAgICAgICBob3Rzd2FwUHJvcGVydHlPdmVycmlkZXMsXG4gICAgICApO1xuXG4gICAgICBpZiAoaG90c3dhcERlcGxveW1lbnRSZXN1bHQpIHtcbiAgICAgICAgcmV0dXJuIGhvdHN3YXBEZXBsb3ltZW50UmVzdWx0O1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0lORk8ubXNnKGZvcm1hdChcbiAgICAgICAgJ0NvdWxkIG5vdCBwZXJmb3JtIGEgaG90c3dhcCBkZXBsb3ltZW50LCBhcyB0aGUgc3RhY2sgJXMgY29udGFpbnMgbm9uLUFzc2V0IGNoYW5nZXMnLFxuICAgICAgICBzdGFja0FydGlmYWN0LmRpc3BsYXlOYW1lLFxuICAgICAgKSkpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmICghKGUgaW5zdGFuY2VvZiBDZm5FdmFsdWF0aW9uRXhjZXB0aW9uKSkge1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuICAgICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9JTkZPLm1zZyhmb3JtYXQoXG4gICAgICAgICdDb3VsZCBub3QgcGVyZm9ybSBhIGhvdHN3YXAgZGVwbG95bWVudCwgYmVjYXVzZSB0aGUgQ2xvdWRGb3JtYXRpb24gdGVtcGxhdGUgY291bGQgbm90IGJlIHJlc29sdmVkOiAlcycsXG4gICAgICAgIGZvcm1hdEVycm9yTWVzc2FnZShlKSxcbiAgICAgICkpKTtcbiAgICB9XG5cbiAgICBpZiAoaG90c3dhcE1vZGUgPT09IEhvdHN3YXBNb2RlLkZBTExfQkFDSykge1xuICAgICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9JTkZPLm1zZygnRmFsbGluZyBiYWNrIHRvIGRvaW5nIGEgZnVsbCBkZXBsb3ltZW50JykpO1xuICAgICAgb3B0aW9ucy5zZGsuYXBwZW5kQ3VzdG9tVXNlckFnZW50KCdjZGstaG90c3dhcC9mYWxsYmFjaycpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnZGlkLWRlcGxveS1zdGFjaycsXG4gICAgICAgIG5vT3A6IHRydWUsXG4gICAgICAgIHN0YWNrQXJuOiBjbG91ZEZvcm1hdGlvblN0YWNrLnN0YWNrSWQsXG4gICAgICAgIG91dHB1dHM6IGNsb3VkRm9ybWF0aW9uU3RhY2sub3V0cHV0cyxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gY291bGQgbm90IHNob3J0LWNpcmN1aXQgdGhlIGRlcGxveW1lbnQsIHBlcmZvcm0gYSBmdWxsIENGTiBkZXBsb3kgaW5zdGVhZFxuICBjb25zdCBmdWxsRGVwbG95bWVudCA9IG5ldyBGdWxsQ2xvdWRGb3JtYXRpb25EZXBsb3ltZW50KFxuICAgIG9wdGlvbnMsXG4gICAgY2xvdWRGb3JtYXRpb25TdGFjayxcbiAgICBzdGFja0FydGlmYWN0LFxuICAgIHN0YWNrUGFyYW1zLFxuICAgIGJvZHlQYXJhbWV0ZXIsXG4gICAgaW9IZWxwZXIsXG4gICk7XG4gIHJldHVybiBmdWxsRGVwbG95bWVudC5wZXJmb3JtRGVwbG95bWVudCgpO1xufVxuXG50eXBlIENvbW1vblByZXBhcmVPcHRpb25zID0ga2V5b2YgQ3JlYXRlU3RhY2tDb21tYW5kSW5wdXQgJlxua2V5b2YgVXBkYXRlU3RhY2tDb21tYW5kSW5wdXQgJlxua2V5b2YgQ3JlYXRlQ2hhbmdlU2V0Q29tbWFuZElucHV0O1xudHlwZSBDb21tb25FeGVjdXRlT3B0aW9ucyA9IGtleW9mIENyZWF0ZVN0YWNrQ29tbWFuZElucHV0ICZcbmtleW9mIFVwZGF0ZVN0YWNrQ29tbWFuZElucHV0ICZcbmtleW9mIEV4ZWN1dGVDaGFuZ2VTZXRDb21tYW5kSW5wdXQ7XG5cbi8qKlxuICogVGhpcyBjbGFzcyBzaGFyZXMgc3RhdGUgYW5kIGZ1bmN0aW9uYWxpdHkgYmV0d2VlbiB0aGUgZGlmZmVyZW50IGZ1bGwgZGVwbG95bWVudCBtb2Rlc1xuICovXG5jbGFzcyBGdWxsQ2xvdWRGb3JtYXRpb25EZXBsb3ltZW50IHtcbiAgcHJpdmF0ZSByZWFkb25seSBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudDtcbiAgcHJpdmF0ZSByZWFkb25seSBzdGFja05hbWU6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSB1cGRhdGU6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgdmVyYjogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHV1aWQ6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IERlcGxveVN0YWNrT3B0aW9ucyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNsb3VkRm9ybWF0aW9uU3RhY2s6IENsb3VkRm9ybWF0aW9uU3RhY2ssXG4gICAgcHJpdmF0ZSByZWFkb25seSBzdGFja0FydGlmYWN0OiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QsXG4gICAgcHJpdmF0ZSByZWFkb25seSBzdGFja1BhcmFtczogUGFyYW1ldGVyVmFsdWVzLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYm9keVBhcmFtZXRlcjogVGVtcGxhdGVCb2R5UGFyYW1ldGVyLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgaW9IZWxwZXI6IElvSGVscGVyLFxuICApIHtcbiAgICB0aGlzLmNmbiA9IG9wdGlvbnMuc2RrLmNsb3VkRm9ybWF0aW9uKCk7XG4gICAgdGhpcy5zdGFja05hbWUgPSBvcHRpb25zLmRlcGxveU5hbWUgPz8gc3RhY2tBcnRpZmFjdC5zdGFja05hbWU7XG5cbiAgICB0aGlzLnVwZGF0ZSA9IGNsb3VkRm9ybWF0aW9uU3RhY2suZXhpc3RzICYmIGNsb3VkRm9ybWF0aW9uU3RhY2suc3RhY2tTdGF0dXMubmFtZSAhPT0gJ1JFVklFV19JTl9QUk9HUkVTUyc7XG4gICAgdGhpcy52ZXJiID0gdGhpcy51cGRhdGUgPyAndXBkYXRlJyA6ICdjcmVhdGUnO1xuICAgIHRoaXMudXVpZCA9IHV1aWQudjQoKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBwZXJmb3JtRGVwbG95bWVudCgpOiBQcm9taXNlPERlcGxveVN0YWNrUmVzdWx0PiB7XG4gICAgY29uc3QgZGVwbG95bWVudE1ldGhvZCA9IHRoaXMub3B0aW9ucy5kZXBsb3ltZW50TWV0aG9kID8/IHtcbiAgICAgIG1ldGhvZDogJ2NoYW5nZS1zZXQnLFxuICAgIH07XG5cbiAgICBpZiAoZGVwbG95bWVudE1ldGhvZC5tZXRob2QgPT09ICdkaXJlY3QnICYmIHRoaXMub3B0aW9ucy5yZXNvdXJjZXNUb0ltcG9ydCkge1xuICAgICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcignSW1wb3J0aW5nIHJlc291cmNlcyByZXF1aXJlcyBhIGNoYW5nZXNldCBkZXBsb3ltZW50Jyk7XG4gICAgfVxuXG4gICAgc3dpdGNoIChkZXBsb3ltZW50TWV0aG9kLm1ldGhvZCkge1xuICAgICAgY2FzZSAnY2hhbmdlLXNldCc6XG4gICAgICAgIHJldHVybiB0aGlzLmNoYW5nZVNldERlcGxveW1lbnQoZGVwbG95bWVudE1ldGhvZCk7XG5cbiAgICAgIGNhc2UgJ2RpcmVjdCc6XG4gICAgICAgIHJldHVybiB0aGlzLmRpcmVjdERlcGxveW1lbnQoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNoYW5nZVNldERlcGxveW1lbnQoZGVwbG95bWVudE1ldGhvZDogQ2hhbmdlU2V0RGVwbG95bWVudE1ldGhvZCk6IFByb21pc2U8RGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgICBjb25zdCBjaGFuZ2VTZXROYW1lID0gZGVwbG95bWVudE1ldGhvZC5jaGFuZ2VTZXROYW1lID8/ICdjZGstZGVwbG95LWNoYW5nZS1zZXQnO1xuICAgIGNvbnN0IGV4ZWN1dGUgPSBkZXBsb3ltZW50TWV0aG9kLmV4ZWN1dGUgPz8gdHJ1ZTtcbiAgICBjb25zdCBpbXBvcnRFeGlzdGluZ1Jlc291cmNlcyA9IGRlcGxveW1lbnRNZXRob2QuaW1wb3J0RXhpc3RpbmdSZXNvdXJjZXMgPz8gZmFsc2U7XG4gICAgY29uc3QgY2hhbmdlU2V0RGVzY3JpcHRpb24gPSBhd2FpdCB0aGlzLmNyZWF0ZUNoYW5nZVNldChjaGFuZ2VTZXROYW1lLCBleGVjdXRlLCBpbXBvcnRFeGlzdGluZ1Jlc291cmNlcyk7XG4gICAgYXdhaXQgdGhpcy51cGRhdGVUZXJtaW5hdGlvblByb3RlY3Rpb24oKTtcblxuICAgIGlmIChjaGFuZ2VTZXRIYXNOb0NoYW5nZXMoY2hhbmdlU2V0RGVzY3JpcHRpb24pKSB7XG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGZvcm1hdCgnTm8gY2hhbmdlcyBhcmUgdG8gYmUgcGVyZm9ybWVkIG9uICVzLicsIHRoaXMuc3RhY2tOYW1lKSkpO1xuICAgICAgaWYgKGV4ZWN1dGUpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhmb3JtYXQoJ0RlbGV0aW5nIGVtcHR5IGNoYW5nZSBzZXQgJXMnLCBjaGFuZ2VTZXREZXNjcmlwdGlvbi5DaGFuZ2VTZXRJZCkpKTtcbiAgICAgICAgYXdhaXQgdGhpcy5jZm4uZGVsZXRlQ2hhbmdlU2V0KHtcbiAgICAgICAgICBTdGFja05hbWU6IHRoaXMuc3RhY2tOYW1lLFxuICAgICAgICAgIENoYW5nZVNldE5hbWU6IGNoYW5nZVNldE5hbWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5vcHRpb25zLmZvcmNlRGVwbG95bWVudCkge1xuICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfV0FSTi5tc2coXG4gICAgICAgICAgW1xuICAgICAgICAgICAgJ1lvdSB1c2VkIHRoZSAtLWZvcmNlIGZsYWcsIGJ1dCBDbG91ZEZvcm1hdGlvbiByZXBvcnRlZCB0aGF0IHRoZSBkZXBsb3ltZW50IHdvdWxkIG5vdCBtYWtlIGFueSBjaGFuZ2VzLicsXG4gICAgICAgICAgICAnQWNjb3JkaW5nIHRvIENsb3VkRm9ybWF0aW9uLCBhbGwgcmVzb3VyY2VzIGFyZSBhbHJlYWR5IHVwLXRvLWRhdGUgd2l0aCB0aGUgc3RhdGUgaW4geW91ciBDREsgYXBwLicsXG4gICAgICAgICAgICAnJyxcbiAgICAgICAgICAgICdZb3UgY2Fubm90IHVzZSB0aGUgLS1mb3JjZSBmbGFnIHRvIGdldCByaWQgb2YgY2hhbmdlcyB5b3UgbWFkZSBpbiB0aGUgY29uc29sZS4gVHJ5IHVzaW5nJyxcbiAgICAgICAgICAgICdDbG91ZEZvcm1hdGlvbiBkcmlmdCBkZXRlY3Rpb24gaW5zdGVhZDogaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FXU0Nsb3VkRm9ybWF0aW9uL2xhdGVzdC9Vc2VyR3VpZGUvdXNpbmctY2ZuLXN0YWNrLWRyaWZ0Lmh0bWwnLFxuICAgICAgICAgIF0uam9pbignXFxuJyksXG4gICAgICAgICkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICB0eXBlOiAnZGlkLWRlcGxveS1zdGFjaycsXG4gICAgICAgIG5vT3A6IHRydWUsXG4gICAgICAgIG91dHB1dHM6IHRoaXMuY2xvdWRGb3JtYXRpb25TdGFjay5vdXRwdXRzLFxuICAgICAgICBzdGFja0FybjogY2hhbmdlU2V0RGVzY3JpcHRpb24uU3RhY2tJZCEsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmICghZXhlY3V0ZSkge1xuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0lORk8ubXNnKGZvcm1hdChcbiAgICAgICAgJ0NoYW5nZXNldCAlcyBjcmVhdGVkIGFuZCB3YWl0aW5nIGluIHJldmlldyBmb3IgbWFudWFsIGV4ZWN1dGlvbiAoLS1uby1leGVjdXRlKScsXG4gICAgICAgIGNoYW5nZVNldERlc2NyaXB0aW9uLkNoYW5nZVNldElkLFxuICAgICAgKSkpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdHlwZTogJ2RpZC1kZXBsb3ktc3RhY2snLFxuICAgICAgICBub09wOiBmYWxzZSxcbiAgICAgICAgb3V0cHV0czogdGhpcy5jbG91ZEZvcm1hdGlvblN0YWNrLm91dHB1dHMsXG4gICAgICAgIHN0YWNrQXJuOiBjaGFuZ2VTZXREZXNjcmlwdGlvbi5TdGFja0lkISxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlcmUgYXJlIHJlcGxhY2VtZW50cyBpbiB0aGUgY2hhbmdlc2V0LCBjaGVjayB0aGUgcm9sbGJhY2sgZmxhZyBhbmQgc3RhY2sgc3RhdHVzXG4gICAgY29uc3QgcmVwbGFjZW1lbnQgPSBoYXNSZXBsYWNlbWVudChjaGFuZ2VTZXREZXNjcmlwdGlvbik7XG4gICAgY29uc3QgaXNQYXVzZWRGYWlsU3RhdGUgPSB0aGlzLmNsb3VkRm9ybWF0aW9uU3RhY2suc3RhY2tTdGF0dXMuaXNSb2xsYmFja2FibGU7XG4gICAgY29uc3Qgcm9sbGJhY2sgPSB0aGlzLm9wdGlvbnMucm9sbGJhY2sgPz8gdHJ1ZTtcbiAgICBpZiAoaXNQYXVzZWRGYWlsU3RhdGUgJiYgcmVwbGFjZW1lbnQpIHtcbiAgICAgIHJldHVybiB7IHR5cGU6ICdmYWlscGF1c2VkLW5lZWQtcm9sbGJhY2stZmlyc3QnLCByZWFzb246ICdyZXBsYWNlbWVudCcsIHN0YXR1czogdGhpcy5jbG91ZEZvcm1hdGlvblN0YWNrLnN0YWNrU3RhdHVzLm5hbWUgfTtcbiAgICB9XG4gICAgaWYgKGlzUGF1c2VkRmFpbFN0YXRlICYmIHJvbGxiYWNrKSB7XG4gICAgICByZXR1cm4geyB0eXBlOiAnZmFpbHBhdXNlZC1uZWVkLXJvbGxiYWNrLWZpcnN0JywgcmVhc29uOiAnbm90LW5vcm9sbGJhY2snLCBzdGF0dXM6IHRoaXMuY2xvdWRGb3JtYXRpb25TdGFjay5zdGFja1N0YXR1cy5uYW1lIH07XG4gICAgfVxuICAgIGlmICghcm9sbGJhY2sgJiYgcmVwbGFjZW1lbnQpIHtcbiAgICAgIHJldHVybiB7IHR5cGU6ICdyZXBsYWNlbWVudC1yZXF1aXJlcy1yb2xsYmFjaycgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5leGVjdXRlQ2hhbmdlU2V0KGNoYW5nZVNldERlc2NyaXB0aW9uKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY3JlYXRlQ2hhbmdlU2V0KGNoYW5nZVNldE5hbWU6IHN0cmluZywgd2lsbEV4ZWN1dGU6IGJvb2xlYW4sIGltcG9ydEV4aXN0aW5nUmVzb3VyY2VzOiBib29sZWFuKSB7XG4gICAgYXdhaXQgdGhpcy5jbGVhbnVwT2xkQ2hhbmdlc2V0KGNoYW5nZVNldE5hbWUpO1xuXG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgQXR0ZW1wdGluZyB0byBjcmVhdGUgQ2hhbmdlU2V0IHdpdGggbmFtZSAke2NoYW5nZVNldE5hbWV9IHRvICR7dGhpcy52ZXJifSBzdGFjayAke3RoaXMuc3RhY2tOYW1lfWApKTtcbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfSU5GTy5tc2coZm9ybWF0KCclczogY3JlYXRpbmcgQ2xvdWRGb3JtYXRpb24gY2hhbmdlc2V0Li4uJywgY2hhbGsuYm9sZCh0aGlzLnN0YWNrTmFtZSkpKSk7XG4gICAgY29uc3QgY2hhbmdlU2V0ID0gYXdhaXQgdGhpcy5jZm4uY3JlYXRlQ2hhbmdlU2V0KHtcbiAgICAgIFN0YWNrTmFtZTogdGhpcy5zdGFja05hbWUsXG4gICAgICBDaGFuZ2VTZXROYW1lOiBjaGFuZ2VTZXROYW1lLFxuICAgICAgQ2hhbmdlU2V0VHlwZTogdGhpcy5vcHRpb25zLnJlc291cmNlc1RvSW1wb3J0ID8gJ0lNUE9SVCcgOiB0aGlzLnVwZGF0ZSA/ICdVUERBVEUnIDogJ0NSRUFURScsXG4gICAgICBSZXNvdXJjZXNUb0ltcG9ydDogdGhpcy5vcHRpb25zLnJlc291cmNlc1RvSW1wb3J0LFxuICAgICAgRGVzY3JpcHRpb246IGBDREsgQ2hhbmdlc2V0IGZvciBleGVjdXRpb24gJHt0aGlzLnV1aWR9YCxcbiAgICAgIENsaWVudFRva2VuOiBgY3JlYXRlJHt0aGlzLnV1aWR9YCxcbiAgICAgIEltcG9ydEV4aXN0aW5nUmVzb3VyY2VzOiBpbXBvcnRFeGlzdGluZ1Jlc291cmNlcyxcbiAgICAgIC4uLnRoaXMuY29tbW9uUHJlcGFyZU9wdGlvbnMoKSxcbiAgICB9KTtcblxuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coZm9ybWF0KCdJbml0aWF0ZWQgY3JlYXRpb24gb2YgY2hhbmdlc2V0OiAlczsgd2FpdGluZyBmb3IgaXQgdG8gZmluaXNoIGNyZWF0aW5nLi4uJywgY2hhbmdlU2V0LklkKSkpO1xuICAgIC8vIEZldGNoaW5nIGFsbCBwYWdlcyBpZiB3ZSdsbCBleGVjdXRlLCBzbyB3ZSBjYW4gaGF2ZSB0aGUgY29ycmVjdCBjaGFuZ2UgY291bnQgd2hlbiBtb25pdG9yaW5nLlxuICAgIHJldHVybiB3YWl0Rm9yQ2hhbmdlU2V0KHRoaXMuY2ZuLCB0aGlzLmlvSGVscGVyLCB0aGlzLnN0YWNrTmFtZSwgY2hhbmdlU2V0TmFtZSwge1xuICAgICAgZmV0Y2hBbGw6IHdpbGxFeGVjdXRlLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBleGVjdXRlQ2hhbmdlU2V0KGNoYW5nZVNldDogRGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0KTogUHJvbWlzZTxTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGZvcm1hdCgnSW5pdGlhdGluZyBleGVjdXRpb24gb2YgY2hhbmdlc2V0ICVzIG9uIHN0YWNrICVzJywgY2hhbmdlU2V0LkNoYW5nZVNldElkLCB0aGlzLnN0YWNrTmFtZSkpKTtcblxuICAgIGF3YWl0IHRoaXMuY2ZuLmV4ZWN1dGVDaGFuZ2VTZXQoe1xuICAgICAgU3RhY2tOYW1lOiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgIENoYW5nZVNldE5hbWU6IGNoYW5nZVNldC5DaGFuZ2VTZXROYW1lISxcbiAgICAgIENsaWVudFJlcXVlc3RUb2tlbjogYGV4ZWMke3RoaXMudXVpZH1gLFxuICAgICAgLi4udGhpcy5jb21tb25FeGVjdXRlT3B0aW9ucygpLFxuICAgIH0pO1xuXG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhcbiAgICAgIGZvcm1hdChcbiAgICAgICAgJ0V4ZWN1dGlvbiBvZiBjaGFuZ2VzZXQgJXMgb24gc3RhY2sgJXMgaGFzIHN0YXJ0ZWQ7IHdhaXRpbmcgZm9yIHRoZSB1cGRhdGUgdG8gY29tcGxldGUuLi4nLFxuICAgICAgICBjaGFuZ2VTZXQuQ2hhbmdlU2V0SWQsXG4gICAgICAgIHRoaXMuc3RhY2tOYW1lLFxuICAgICAgKSxcbiAgICApKTtcblxuICAgIC8vICsxIGZvciB0aGUgZXh0cmEgZXZlbnQgZW1pdHRlZCBmcm9tIHVwZGF0ZXMuXG4gICAgY29uc3QgY2hhbmdlU2V0TGVuZ3RoOiBudW1iZXIgPSAoY2hhbmdlU2V0LkNoYW5nZXMgPz8gW10pLmxlbmd0aCArICh0aGlzLnVwZGF0ZSA/IDEgOiAwKTtcbiAgICByZXR1cm4gdGhpcy5tb25pdG9yRGVwbG95bWVudChjaGFuZ2VTZXQuQ3JlYXRpb25UaW1lISwgY2hhbmdlU2V0TGVuZ3RoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2xlYW51cE9sZENoYW5nZXNldChjaGFuZ2VTZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5jbG91ZEZvcm1hdGlvblN0YWNrLmV4aXN0cykge1xuICAgICAgLy8gRGVsZXRlIGFueSBleGlzdGluZyBjaGFuZ2Ugc2V0cyBnZW5lcmF0ZWQgYnkgQ0RLIHNpbmNlIGNoYW5nZSBzZXQgbmFtZXMgbXVzdCBiZSB1bmlxdWUuXG4gICAgICAvLyBUaGUgZGVsZXRlIHJlcXVlc3QgaXMgc3VjY2Vzc2Z1bCBhcyBsb25nIGFzIHRoZSBzdGFjayBleGlzdHMgKGV2ZW4gaWYgdGhlIGNoYW5nZSBzZXQgZG9lcyBub3QgZXhpc3QpLlxuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgUmVtb3ZpbmcgZXhpc3RpbmcgY2hhbmdlIHNldCB3aXRoIG5hbWUgJHtjaGFuZ2VTZXROYW1lfSBpZiBpdCBleGlzdHNgKSk7XG4gICAgICBhd2FpdCB0aGlzLmNmbi5kZWxldGVDaGFuZ2VTZXQoe1xuICAgICAgICBTdGFja05hbWU6IHRoaXMuc3RhY2tOYW1lLFxuICAgICAgICBDaGFuZ2VTZXROYW1lOiBjaGFuZ2VTZXROYW1lLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB1cGRhdGVUZXJtaW5hdGlvblByb3RlY3Rpb24oKSB7XG4gICAgLy8gVXBkYXRlIHRlcm1pbmF0aW9uIHByb3RlY3Rpb24gb25seSBpZiBpdCBoYXMgY2hhbmdlZC5cbiAgICBjb25zdCB0ZXJtaW5hdGlvblByb3RlY3Rpb24gPSB0aGlzLnN0YWNrQXJ0aWZhY3QudGVybWluYXRpb25Qcm90ZWN0aW9uID8/IGZhbHNlO1xuICAgIGlmICghIXRoaXMuY2xvdWRGb3JtYXRpb25TdGFjay50ZXJtaW5hdGlvblByb3RlY3Rpb24gIT09IHRlcm1pbmF0aW9uUHJvdGVjdGlvbikge1xuICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhcbiAgICAgICAgZm9ybWF0IChcbiAgICAgICAgICAnVXBkYXRpbmcgdGVybWluYXRpb24gcHJvdGVjdGlvbiBmcm9tICVzIHRvICVzIGZvciBzdGFjayAlcycsXG4gICAgICAgICAgdGhpcy5jbG91ZEZvcm1hdGlvblN0YWNrLnRlcm1pbmF0aW9uUHJvdGVjdGlvbixcbiAgICAgICAgICB0ZXJtaW5hdGlvblByb3RlY3Rpb24sXG4gICAgICAgICAgdGhpcy5zdGFja05hbWUsXG4gICAgICAgICksXG4gICAgICApKTtcbiAgICAgIGF3YWl0IHRoaXMuY2ZuLnVwZGF0ZVRlcm1pbmF0aW9uUHJvdGVjdGlvbih7XG4gICAgICAgIFN0YWNrTmFtZTogdGhpcy5zdGFja05hbWUsXG4gICAgICAgIEVuYWJsZVRlcm1pbmF0aW9uUHJvdGVjdGlvbjogdGVybWluYXRpb25Qcm90ZWN0aW9uLFxuICAgICAgfSk7XG4gICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGZvcm1hdCgnVGVybWluYXRpb24gcHJvdGVjdGlvbiB1cGRhdGVkIHRvICVzIGZvciBzdGFjayAlcycsIHRlcm1pbmF0aW9uUHJvdGVjdGlvbiwgdGhpcy5zdGFja05hbWUpKSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBkaXJlY3REZXBsb3ltZW50KCk6IFByb21pc2U8U3VjY2Vzc2Z1bERlcGxveVN0YWNrUmVzdWx0PiB7XG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0lORk8ubXNnKGZvcm1hdCgnJXM6ICVzIHN0YWNrLi4uJywgY2hhbGsuYm9sZCh0aGlzLnN0YWNrTmFtZSksIHRoaXMudXBkYXRlID8gJ3VwZGF0aW5nJyA6ICdjcmVhdGluZycpKSk7XG5cbiAgICBjb25zdCBzdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuXG4gICAgaWYgKHRoaXMudXBkYXRlKSB7XG4gICAgICBhd2FpdCB0aGlzLnVwZGF0ZVRlcm1pbmF0aW9uUHJvdGVjdGlvbigpO1xuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLmNmbi51cGRhdGVTdGFjayh7XG4gICAgICAgICAgU3RhY2tOYW1lOiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgICAgICBDbGllbnRSZXF1ZXN0VG9rZW46IGB1cGRhdGUke3RoaXMudXVpZH1gLFxuICAgICAgICAgIC4uLnRoaXMuY29tbW9uUHJlcGFyZU9wdGlvbnMoKSxcbiAgICAgICAgICAuLi50aGlzLmNvbW1vbkV4ZWN1dGVPcHRpb25zKCksXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyOiBhbnkpIHtcbiAgICAgICAgaWYgKGVyci5tZXNzYWdlID09PSAnTm8gdXBkYXRlcyBhcmUgdG8gYmUgcGVyZm9ybWVkLicpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGZvcm1hdCgnTm8gdXBkYXRlcyBhcmUgdG8gYmUgcGVyZm9ybWVkIGZvciBzdGFjayAlcycsIHRoaXMuc3RhY2tOYW1lKSkpO1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiAnZGlkLWRlcGxveS1zdGFjaycsXG4gICAgICAgICAgICBub09wOiB0cnVlLFxuICAgICAgICAgICAgb3V0cHV0czogdGhpcy5jbG91ZEZvcm1hdGlvblN0YWNrLm91dHB1dHMsXG4gICAgICAgICAgICBzdGFja0FybjogdGhpcy5jbG91ZEZvcm1hdGlvblN0YWNrLnN0YWNrSWQsXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0aGlzLm1vbml0b3JEZXBsb3ltZW50KHN0YXJ0VGltZSwgdW5kZWZpbmVkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gVGFrZSBhZHZhbnRhZ2Ugb2YgdGhlIGZhY3QgdGhhdCB3ZSBjYW4gc2V0IHRlcm1pbmF0aW9uIHByb3RlY3Rpb24gZHVyaW5nIGNyZWF0ZVxuICAgICAgY29uc3QgdGVybWluYXRpb25Qcm90ZWN0aW9uID0gdGhpcy5zdGFja0FydGlmYWN0LnRlcm1pbmF0aW9uUHJvdGVjdGlvbiA/PyBmYWxzZTtcblxuICAgICAgYXdhaXQgdGhpcy5jZm4uY3JlYXRlU3RhY2soe1xuICAgICAgICBTdGFja05hbWU6IHRoaXMuc3RhY2tOYW1lLFxuICAgICAgICBDbGllbnRSZXF1ZXN0VG9rZW46IGBjcmVhdGUke3RoaXMudXVpZH1gLFxuICAgICAgICAuLi4odGVybWluYXRpb25Qcm90ZWN0aW9uID8geyBFbmFibGVUZXJtaW5hdGlvblByb3RlY3Rpb246IHRydWUgfSA6IHVuZGVmaW5lZCksXG4gICAgICAgIC4uLnRoaXMuY29tbW9uUHJlcGFyZU9wdGlvbnMoKSxcbiAgICAgICAgLi4udGhpcy5jb21tb25FeGVjdXRlT3B0aW9ucygpLFxuICAgICAgfSk7XG5cbiAgICAgIHJldHVybiB0aGlzLm1vbml0b3JEZXBsb3ltZW50KHN0YXJ0VGltZSwgdW5kZWZpbmVkKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIG1vbml0b3JEZXBsb3ltZW50KHN0YXJ0VGltZTogRGF0ZSwgZXhwZWN0ZWRDaGFuZ2VzOiBudW1iZXIgfCB1bmRlZmluZWQpOiBQcm9taXNlPFN1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdD4ge1xuICAgIGNvbnN0IG1vbml0b3IgPSBuZXcgU3RhY2tBY3Rpdml0eU1vbml0b3Ioe1xuICAgICAgY2ZuOiB0aGlzLmNmbixcbiAgICAgIHN0YWNrOiB0aGlzLnN0YWNrQXJ0aWZhY3QsXG4gICAgICBzdGFja05hbWU6IHRoaXMuc3RhY2tOYW1lLFxuICAgICAgcmVzb3VyY2VzVG90YWw6IGV4cGVjdGVkQ2hhbmdlcyxcbiAgICAgIGlvSGVscGVyOiB0aGlzLmlvSGVscGVyLFxuICAgICAgY2hhbmdlU2V0Q3JlYXRpb25UaW1lOiBzdGFydFRpbWUsXG4gICAgfSk7XG4gICAgYXdhaXQgbW9uaXRvci5zdGFydCgpO1xuXG4gICAgbGV0IGZpbmFsU3RhdGUgPSB0aGlzLmNsb3VkRm9ybWF0aW9uU3RhY2s7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN1Y2Nlc3NTdGFjayA9IGF3YWl0IHdhaXRGb3JTdGFja0RlcGxveSh0aGlzLmNmbiwgdGhpcy5pb0hlbHBlciwgdGhpcy5zdGFja05hbWUpO1xuXG4gICAgICAvLyBUaGlzIHNob3VsZG4ndCByZWFsbHkgaGFwcGVuLCBidXQgY2F0Y2ggaXQgYW55d2F5LiBZb3UgbmV2ZXIga25vdy5cbiAgICAgIGlmICghc3VjY2Vzc1N0YWNrKSB7XG4gICAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJ1N0YWNrIGRlcGxveSBmYWlsZWQgKHRoZSBzdGFjayBkaXNhcHBlYXJlZCB3aGlsZSB3ZSB3ZXJlIGRlcGxveWluZyBpdCknKTtcbiAgICAgIH1cbiAgICAgIGZpbmFsU3RhdGUgPSBzdWNjZXNzU3RhY2s7XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKHN1ZmZpeFdpdGhFcnJvcnMoZm9ybWF0RXJyb3JNZXNzYWdlKGUpLCBtb25pdG9yLmVycm9ycykpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBtb25pdG9yLnN0b3AoKTtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhmb3JtYXQoJ1N0YWNrICVzIGhhcyBjb21wbGV0ZWQgdXBkYXRpbmcnLCB0aGlzLnN0YWNrTmFtZSkpKTtcbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogJ2RpZC1kZXBsb3ktc3RhY2snLFxuICAgICAgbm9PcDogZmFsc2UsXG4gICAgICBvdXRwdXRzOiBmaW5hbFN0YXRlLm91dHB1dHMsXG4gICAgICBzdGFja0FybjogZmluYWxTdGF0ZS5zdGFja0lkLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHRoZSBvcHRpb25zIHRoYXQgYXJlIHNoYXJlZCBiZXR3ZWVuIENyZWF0ZVN0YWNrLCBVcGRhdGVTdGFjayBhbmQgQ3JlYXRlQ2hhbmdlU2V0XG4gICAqL1xuICBwcml2YXRlIGNvbW1vblByZXBhcmVPcHRpb25zKCk6IFBhcnRpYWw8UGljazxVcGRhdGVTdGFja0NvbW1hbmRJbnB1dCwgQ29tbW9uUHJlcGFyZU9wdGlvbnM+PiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIENhcGFiaWxpdGllczogWydDQVBBQklMSVRZX0lBTScsICdDQVBBQklMSVRZX05BTUVEX0lBTScsICdDQVBBQklMSVRZX0FVVE9fRVhQQU5EJ10sXG4gICAgICBOb3RpZmljYXRpb25BUk5zOiB0aGlzLm9wdGlvbnMubm90aWZpY2F0aW9uQXJucyxcbiAgICAgIFBhcmFtZXRlcnM6IHRoaXMuc3RhY2tQYXJhbXMuYXBpUGFyYW1ldGVycyxcbiAgICAgIFJvbGVBUk46IHRoaXMub3B0aW9ucy5yb2xlQXJuLFxuICAgICAgVGVtcGxhdGVCb2R5OiB0aGlzLmJvZHlQYXJhbWV0ZXIuVGVtcGxhdGVCb2R5LFxuICAgICAgVGVtcGxhdGVVUkw6IHRoaXMuYm9keVBhcmFtZXRlci5UZW1wbGF0ZVVSTCxcbiAgICAgIFRhZ3M6IHRoaXMub3B0aW9ucy50YWdzLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHRoZSBvcHRpb25zIHRoYXQgYXJlIHNoYXJlZCBiZXR3ZWVuIFVwZGF0ZVN0YWNrIGFuZCBDcmVhdGVDaGFuZ2VTZXRcbiAgICpcbiAgICogQmUgY2FyZWZ1bCBub3QgdG8gYWRkIGluIGtleXMgZm9yIG9wdGlvbnMgdGhhdCBhcmVuJ3QgdXNlZCwgYXMgdGhlIGZlYXR1cmVzIG1heSBub3QgaGF2ZSBiZWVuXG4gICAqIGRlcGxveWVkIGV2ZXJ5d2hlcmUgeWV0LlxuICAgKi9cbiAgcHJpdmF0ZSBjb21tb25FeGVjdXRlT3B0aW9ucygpOiBQYXJ0aWFsPFBpY2s8VXBkYXRlU3RhY2tDb21tYW5kSW5wdXQsIENvbW1vbkV4ZWN1dGVPcHRpb25zPj4ge1xuICAgIGNvbnN0IHNob3VsZERpc2FibGVSb2xsYmFjayA9IHRoaXMub3B0aW9ucy5yb2xsYmFjayA9PT0gZmFsc2U7XG5cbiAgICByZXR1cm4ge1xuICAgICAgU3RhY2tOYW1lOiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgIC4uLihzaG91bGREaXNhYmxlUm9sbGJhY2sgPyB7IERpc2FibGVSb2xsYmFjazogdHJ1ZSB9IDogdW5kZWZpbmVkKSxcbiAgICB9O1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGVzdHJveVN0YWNrT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgc3RhY2sgdG8gYmUgZGVzdHJveWVkXG4gICAqL1xuICBzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0O1xuXG4gIHNkazogU0RLO1xuICByb2xlQXJuPzogc3RyaW5nO1xuICBkZXBsb3lOYW1lPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIERlc3Ryb3lTdGFja1Jlc3VsdCB7XG4gIC8qKlxuICAgKiBUaGUgQVJOIG9mIHRoZSBzdGFjayB0aGF0IHdhcyBkZXN0cm95ZWQsIGlmIGFueS5cbiAgICpcbiAgICogSWYgdGhlIHN0YWNrIGRpZG4ndCBleGlzdCB0byBiZWdpbiB3aXRoLCB0aGUgb3BlcmF0aW9uIHdpbGwgc3VjY2VlZFxuICAgKiBidXQgdGhpcyB2YWx1ZSB3aWxsIGJlIHVuZGVmaW5lZC5cbiAgICovXG4gIHJlYWRvbmx5IHN0YWNrQXJuPzogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVzdHJveVN0YWNrKG9wdGlvbnM6IERlc3Ryb3lTdGFja09wdGlvbnMsIGlvSGVscGVyOiBJb0hlbHBlcik6IFByb21pc2U8RGVzdHJveVN0YWNrUmVzdWx0PiB7XG4gIGNvbnN0IGRlcGxveU5hbWUgPSBvcHRpb25zLmRlcGxveU5hbWUgfHwgb3B0aW9ucy5zdGFjay5zdGFja05hbWU7XG4gIGNvbnN0IGNmbiA9IG9wdGlvbnMuc2RrLmNsb3VkRm9ybWF0aW9uKCk7XG5cbiAgY29uc3QgY3VycmVudFN0YWNrID0gYXdhaXQgQ2xvdWRGb3JtYXRpb25TdGFjay5sb29rdXAoY2ZuLCBkZXBsb3lOYW1lKTtcbiAgaWYgKCFjdXJyZW50U3RhY2suZXhpc3RzKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGNvbnN0IG1vbml0b3IgPSBuZXcgU3RhY2tBY3Rpdml0eU1vbml0b3Ioe1xuICAgIGNmbixcbiAgICBzdGFjazogb3B0aW9ucy5zdGFjayxcbiAgICBzdGFja05hbWU6IGRlcGxveU5hbWUsXG4gICAgaW9IZWxwZXI6IGlvSGVscGVyLFxuICB9KTtcbiAgYXdhaXQgbW9uaXRvci5zdGFydCgpO1xuXG4gIHRyeSB7XG4gICAgYXdhaXQgY2ZuLmRlbGV0ZVN0YWNrKHsgU3RhY2tOYW1lOiBkZXBsb3lOYW1lLCBSb2xlQVJOOiBvcHRpb25zLnJvbGVBcm4gfSk7XG4gICAgY29uc3QgZGVzdHJveWVkU3RhY2sgPSBhd2FpdCB3YWl0Rm9yU3RhY2tEZWxldGUoY2ZuLCBpb0hlbHBlciwgZGVwbG95TmFtZSk7XG4gICAgaWYgKGRlc3Ryb3llZFN0YWNrICYmIGRlc3Ryb3llZFN0YWNrLnN0YWNrU3RhdHVzLm5hbWUgIT09ICdERUxFVEVfQ09NUExFVEUnKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBGYWlsZWQgdG8gZGVzdHJveSAke2RlcGxveU5hbWV9OiAke2Rlc3Ryb3llZFN0YWNrLnN0YWNrU3RhdHVzfWApO1xuICAgIH1cblxuICAgIHJldHVybiB7IHN0YWNrQXJuOiBjdXJyZW50U3RhY2suc3RhY2tJZCB9O1xuICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKHN1ZmZpeFdpdGhFcnJvcnMoZm9ybWF0RXJyb3JNZXNzYWdlKGUpLCBtb25pdG9yLmVycm9ycykpO1xuICB9IGZpbmFsbHkge1xuICAgIGlmIChtb25pdG9yKSB7XG4gICAgICBhd2FpdCBtb25pdG9yLnN0b3AoKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciB3ZSBjYW4gc2tpcCBkZXBsb3ltZW50XG4gKlxuICogV2UgZG8gdGhpcyBpbiBhIGNvbXBsaWNhdGVkIHdheSBieSBwcmVwcm9jZXNzaW5nIChpbnN0ZWFkIG9mIGp1c3RcbiAqIGxvb2tpbmcgYXQgdGhlIGNoYW5nZXNldCksIGJlY2F1c2UgaWYgdGhlcmUgYXJlIG5lc3RlZCBzdGFja3MgaW52b2x2ZWRcbiAqIHRoZSBjaGFuZ2VzZXQgd2lsbCBhbHdheXMgc2hvdyB0aGUgbmVzdGVkIHN0YWNrcyBhcyBuZWVkaW5nIHRvIGJlXG4gKiB1cGRhdGVkLCBhbmQgdGhlIGRlcGxveW1lbnQgd2lsbCB0YWtlIGEgbG9uZyB0aW1lIHRvIGluIGVmZmVjdCBub3RcbiAqIGRvIGFueXRoaW5nLlxuICovXG5hc3luYyBmdW5jdGlvbiBjYW5Ta2lwRGVwbG95KFxuICBkZXBsb3lTdGFja09wdGlvbnM6IERlcGxveVN0YWNrT3B0aW9ucyxcbiAgY2xvdWRGb3JtYXRpb25TdGFjazogQ2xvdWRGb3JtYXRpb25TdGFjayxcbiAgcGFyYW1ldGVyQ2hhbmdlczogUGFyYW1ldGVyQ2hhbmdlcyxcbiAgaW9IZWxwZXI6IElvSGVscGVyLFxuKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGRlcGxveU5hbWUgPSBkZXBsb3lTdGFja09wdGlvbnMuZGVwbG95TmFtZSB8fCBkZXBsb3lTdGFja09wdGlvbnMuc3RhY2suc3RhY2tOYW1lO1xuICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZXBsb3lOYW1lfTogY2hlY2tpbmcgaWYgd2UgY2FuIHNraXAgZGVwbG95YCkpO1xuXG4gIC8vIEZvcmNlZCBkZXBsb3lcbiAgaWYgKGRlcGxveVN0YWNrT3B0aW9ucy5mb3JjZURlcGxveW1lbnQpIHtcbiAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZXBsb3lOYW1lfTogZm9yY2VkIGRlcGxveW1lbnRgKSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gQ3JlYXRpbmcgY2hhbmdlc2V0IG9ubHkgKGRlZmF1bHQgdHJ1ZSksIG5ldmVyIHNraXBcbiAgaWYgKFxuICAgIGRlcGxveVN0YWNrT3B0aW9ucy5kZXBsb3ltZW50TWV0aG9kPy5tZXRob2QgPT09ICdjaGFuZ2Utc2V0JyAmJlxuICAgIGRlcGxveVN0YWNrT3B0aW9ucy5kZXBsb3ltZW50TWV0aG9kLmV4ZWN1dGUgPT09IGZhbHNlXG4gICkge1xuICAgIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGAke2RlcGxveU5hbWV9OiAtLW5vLWV4ZWN1dGUsIGFsd2F5cyBjcmVhdGluZyBjaGFuZ2Ugc2V0YCkpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIE5vIGV4aXN0aW5nIHN0YWNrXG4gIGlmICghY2xvdWRGb3JtYXRpb25TdGFjay5leGlzdHMpIHtcbiAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZXBsb3lOYW1lfTogbm8gZXhpc3Rpbmcgc3RhY2tgKSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gVGVtcGxhdGUgaGFzIGNoYW5nZWQgKGFzc2V0cyB0YWtlbiBpbnRvIGFjY291bnQgaGVyZSlcbiAgaWYgKEpTT04uc3RyaW5naWZ5KGRlcGxveVN0YWNrT3B0aW9ucy5zdGFjay50ZW1wbGF0ZSkgIT09IEpTT04uc3RyaW5naWZ5KGF3YWl0IGNsb3VkRm9ybWF0aW9uU3RhY2sudGVtcGxhdGUoKSkpIHtcbiAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZXBsb3lOYW1lfTogdGVtcGxhdGUgaGFzIGNoYW5nZWRgKSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gVGFncyBoYXZlIGNoYW5nZWRcbiAgaWYgKCFjb21wYXJlVGFncyhjbG91ZEZvcm1hdGlvblN0YWNrLnRhZ3MsIGRlcGxveVN0YWNrT3B0aW9ucy50YWdzID8/IFtdKSkge1xuICAgIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGAke2RlcGxveU5hbWV9OiB0YWdzIGhhdmUgY2hhbmdlZGApKTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvLyBOb3RpZmljYXRpb24gYXJucyBoYXZlIGNoYW5nZWRcbiAgaWYgKCFhcnJheUVxdWFscyhjbG91ZEZvcm1hdGlvblN0YWNrLm5vdGlmaWNhdGlvbkFybnMsIGRlcGxveVN0YWNrT3B0aW9ucy5ub3RpZmljYXRpb25Bcm5zID8/IFtdKSkge1xuICAgIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGAke2RlcGxveU5hbWV9OiBub3RpZmljYXRpb24gYXJucyBoYXZlIGNoYW5nZWRgKSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gVGVybWluYXRpb24gcHJvdGVjdGlvbiBoYXMgYmVlbiB1cGRhdGVkXG4gIGlmICghIWRlcGxveVN0YWNrT3B0aW9ucy5zdGFjay50ZXJtaW5hdGlvblByb3RlY3Rpb24gIT09ICEhY2xvdWRGb3JtYXRpb25TdGFjay50ZXJtaW5hdGlvblByb3RlY3Rpb24pIHtcbiAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZXBsb3lOYW1lfTogdGVybWluYXRpb24gcHJvdGVjdGlvbiBoYXMgYmVlbiB1cGRhdGVkYCkpO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIFBhcmFtZXRlcnMgaGF2ZSBjaGFuZ2VkXG4gIGlmIChwYXJhbWV0ZXJDaGFuZ2VzKSB7XG4gICAgaWYgKHBhcmFtZXRlckNoYW5nZXMgPT09ICdzc20nKSB7XG4gICAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZXBsb3lOYW1lfTogc29tZSBwYXJhbWV0ZXJzIGNvbWUgZnJvbSBTU00gc28gd2UgaGF2ZSB0byBhc3N1bWUgdGhleSBtYXkgaGF2ZSBjaGFuZ2VkYCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgJHtkZXBsb3lOYW1lfTogcGFyYW1ldGVycyBoYXZlIGNoYW5nZWRgKSk7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIEV4aXN0aW5nIHN0YWNrIGlzIGluIGEgZmFpbGVkIHN0YXRlXG4gIGlmIChjbG91ZEZvcm1hdGlvblN0YWNrLnN0YWNrU3RhdHVzLmlzRmFpbHVyZSkge1xuICAgIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGAke2RlcGxveU5hbWV9OiBzdGFjayBpcyBpbiBhIGZhaWx1cmUgc3RhdGVgKSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLy8gV2UgY2FuIHNraXAgZGVwbG95XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKipcbiAqIENvbXBhcmVzIHR3byBsaXN0IG9mIHRhZ3MsIHJldHVybnMgdHJ1ZSBpZiBpZGVudGljYWwuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVUYWdzKGE6IFRhZ1tdLCBiOiBUYWdbXSk6IGJvb2xlYW4ge1xuICBpZiAoYS5sZW5ndGggIT09IGIubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgZm9yIChjb25zdCBhVGFnIG9mIGEpIHtcbiAgICBjb25zdCBiVGFnID0gYi5maW5kKCh0YWcpID0+IHRhZy5LZXkgPT09IGFUYWcuS2V5KTtcblxuICAgIGlmICghYlRhZyB8fCBiVGFnLlZhbHVlICE9PSBhVGFnLlZhbHVlKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIHN1ZmZpeFdpdGhFcnJvcnMobXNnOiBzdHJpbmcsIGVycm9ycz86IHN0cmluZ1tdKSB7XG4gIHJldHVybiBlcnJvcnMgJiYgZXJyb3JzLmxlbmd0aCA+IDAgPyBgJHttc2d9OiAke2Vycm9ycy5qb2luKCcsICcpfWAgOiBtc2c7XG59XG5cbmZ1bmN0aW9uIGFycmF5RXF1YWxzKGE6IGFueVtdLCBiOiBhbnlbXSk6IGJvb2xlYW4ge1xuICByZXR1cm4gYS5ldmVyeSgoaXRlbSkgPT4gYi5pbmNsdWRlcyhpdGVtKSkgJiYgYi5ldmVyeSgoaXRlbSkgPT4gYS5pbmNsdWRlcyhpdGVtKSk7XG59XG5cbmZ1bmN0aW9uIGhhc1JlcGxhY2VtZW50KGNzOiBEZXNjcmliZUNoYW5nZVNldENvbW1hbmRPdXRwdXQpIHtcbiAgcmV0dXJuIChjcy5DaGFuZ2VzID8/IFtdKS5zb21lKGMgPT4ge1xuICAgIGNvbnN0IGEgPSBjLlJlc291cmNlQ2hhbmdlPy5Qb2xpY3lBY3Rpb247XG4gICAgcmV0dXJuIGEgPT09ICdSZXBsYWNlQW5kRGVsZXRlJyB8fCBhID09PSAnUmVwbGFjZUFuZFJldGFpbicgfHwgYSA9PT0gJ1JlcGxhY2VBbmRTbmFwc2hvdCc7XG4gIH0pO1xufVxuIl19