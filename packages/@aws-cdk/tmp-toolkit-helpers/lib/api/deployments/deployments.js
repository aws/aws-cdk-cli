"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Deployments = void 0;
const crypto_1 = require("crypto");
const cdk_assets = require("cdk-assets");
const chalk = require("chalk");
const asset_manifest_builder_1 = require("./asset-manifest-builder");
const asset_publishing_1 = require("./asset-publishing");
const cfn_api_1 = require("./cfn-api");
const checks_1 = require("./checks");
const deploy_stack_1 = require("./deploy-stack");
const util_1 = require("../../util");
const cloudformation_1 = require("../cloudformation");
const environment_1 = require("../environment");
const private_1 = require("../io/private");
const stack_events_1 = require("../stack-events");
const toolkit_error_1 = require("../toolkit-error");
const toolkit_info_1 = require("../toolkit-info");
const BOOTSTRAP_STACK_VERSION_FOR_ROLLBACK = 23;
/**
 * Scope for a single set of deployments from a set of Cloud Assembly Artifacts
 *
 * Manages lookup of SDKs, Bootstrap stacks, etc.
 */
class Deployments {
    props;
    envs;
    /**
     * SDK provider for asset publishing (do not use for anything else).
     *
     * This SDK provider is only allowed to be used for that purpose, nothing else.
     *
     * It's not a different object, but the field name should imply that this
     * object should not be used directly, except to pass to asset handling routines.
     */
    assetSdkProvider;
    /**
     * SDK provider for passing to deployStack
     *
     * This SDK provider is only allowed to be used for that purpose, nothing else.
     *
     * It's not a different object, but the field name should imply that this
     * object should not be used directly, except to pass to `deployStack`.
     */
    deployStackSdkProvider;
    publisherCache = new Map();
    _allowCrossAccountAssetPublishing;
    ioHelper;
    constructor(props) {
        this.props = props;
        this.assetSdkProvider = props.sdkProvider;
        this.deployStackSdkProvider = props.sdkProvider;
        this.ioHelper = props.ioHelper;
        this.envs = new environment_1.EnvironmentAccess(props.sdkProvider, props.toolkitStackName ?? toolkit_info_1.DEFAULT_TOOLKIT_STACK_NAME, this.ioHelper);
    }
    /**
     * Resolves the environment for a stack.
     */
    async resolveEnvironment(stack) {
        return this.envs.resolveStackEnvironment(stack);
    }
    async readCurrentTemplateWithNestedStacks(rootStackArtifact, retrieveProcessedTemplate = false) {
        const env = await this.envs.accessStackForLookupBestEffort(rootStackArtifact);
        return (0, cloudformation_1.loadCurrentTemplateWithNestedStacks)(rootStackArtifact, env.sdk, retrieveProcessedTemplate);
    }
    async readCurrentTemplate(stackArtifact) {
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Reading existing template for stack ${stackArtifact.displayName}.`));
        const env = await this.envs.accessStackForLookupBestEffort(stackArtifact);
        return (0, cloudformation_1.loadCurrentTemplate)(stackArtifact, env.sdk);
    }
    async resourceIdentifierSummaries(stackArtifact) {
        await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Retrieving template summary for stack ${stackArtifact.displayName}.`));
        // Currently, needs to use `deploy-role` since it may need to read templates in the staging
        // bucket which have been encrypted with a KMS key (and lookup-role may not read encrypted things)
        const env = await this.envs.accessStackForReadOnlyStackOperations(stackArtifact);
        const cfn = env.sdk.cloudFormation();
        await (0, cfn_api_1.uploadStackTemplateAssets)(stackArtifact, this);
        // Upload the template, if necessary, before passing it to CFN
        const builder = new asset_manifest_builder_1.AssetManifestBuilder();
        const cfnParam = await (0, cloudformation_1.makeBodyParameter)(this.ioHelper, stackArtifact, env.resolvedEnvironment, builder, env.resources);
        // If the `makeBodyParameter` before this added assets, make sure to publish them before
        // calling the API.
        const addedAssets = builder.toManifest(stackArtifact.assembly.directory);
        for (const entry of addedAssets.entries) {
            await this.buildSingleAsset('no-version-validation', addedAssets, entry, {
                stack: stackArtifact,
            });
            await this.publishSingleAsset(addedAssets, entry, {
                stack: stackArtifact,
            });
        }
        const response = await cfn.getTemplateSummary(cfnParam);
        if (!response.ResourceIdentifierSummaries) {
            await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg('GetTemplateSummary API call did not return "ResourceIdentifierSummaries"'));
        }
        return response.ResourceIdentifierSummaries ?? [];
    }
    async deployStack(options) {
        let deploymentMethod = options.deploymentMethod;
        if (options.changeSetName || options.execute !== undefined) {
            if (deploymentMethod) {
                throw new toolkit_error_1.ToolkitError("You cannot supply both 'deploymentMethod' and 'changeSetName/execute'. Supply one or the other.");
            }
            deploymentMethod = {
                method: 'change-set',
                changeSetName: options.changeSetName,
                execute: options.execute,
            };
        }
        const env = await this.envs.accessStackForMutableStackOperations(options.stack);
        // Do a verification of the bootstrap stack version
        await this.validateBootstrapStackVersion(options.stack.stackName, options.stack.requiresBootstrapStackVersion, options.stack.bootstrapStackVersionSsmParameter, env.resources);
        const executionRoleArn = await env.replacePlaceholders(options.roleArn ?? options.stack.cloudFormationExecutionRoleArn);
        return (0, deploy_stack_1.deployStack)({
            stack: options.stack,
            resolvedEnvironment: env.resolvedEnvironment,
            deployName: options.deployName,
            notificationArns: options.notificationArns,
            sdk: env.sdk,
            sdkProvider: this.deployStackSdkProvider,
            roleArn: executionRoleArn,
            reuseAssets: options.reuseAssets,
            envResources: env.resources,
            tags: options.tags,
            deploymentMethod,
            forceDeployment: options.forceDeployment,
            parameters: options.parameters,
            usePreviousParameters: options.usePreviousParameters,
            rollback: options.rollback,
            hotswap: options.hotswap,
            hotswapPropertyOverrides: options.hotswapPropertyOverrides,
            extraUserAgent: options.extraUserAgent,
            resourcesToImport: options.resourcesToImport,
            overrideTemplate: options.overrideTemplate,
            assetParallelism: options.assetParallelism,
        }, this.ioHelper);
    }
    async rollbackStack(options) {
        let resourcesToSkip = options.orphanLogicalIds ?? [];
        if (options.orphanFailedResources && resourcesToSkip.length > 0) {
            throw new toolkit_error_1.ToolkitError('Cannot combine --force with --orphan');
        }
        const env = await this.envs.accessStackForMutableStackOperations(options.stack);
        if (options.validateBootstrapStackVersion ?? true) {
            // Do a verification of the bootstrap stack version
            await this.validateBootstrapStackVersion(options.stack.stackName, BOOTSTRAP_STACK_VERSION_FOR_ROLLBACK, options.stack.bootstrapStackVersionSsmParameter, env.resources);
        }
        const cfn = env.sdk.cloudFormation();
        const deployName = options.stack.stackName;
        // We loop in case of `--force` and the stack ends up in `CONTINUE_UPDATE_ROLLBACK`.
        let maxLoops = 10;
        while (maxLoops--) {
            const cloudFormationStack = await cloudformation_1.CloudFormationStack.lookup(cfn, deployName);
            const stackArn = cloudFormationStack.stackId;
            const executionRoleArn = await env.replacePlaceholders(options.roleArn ?? options.stack.cloudFormationExecutionRoleArn);
            switch (cloudFormationStack.stackStatus.rollbackChoice) {
                case stack_events_1.RollbackChoice.NONE:
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Stack ${deployName} does not need a rollback: ${cloudFormationStack.stackStatus}`));
                    return { stackArn: cloudFormationStack.stackId, notInRollbackableState: true };
                case stack_events_1.RollbackChoice.START_ROLLBACK:
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Initiating rollback of stack ${deployName}`));
                    await cfn.rollbackStack({
                        StackName: deployName,
                        RoleARN: executionRoleArn,
                        ClientRequestToken: (0, crypto_1.randomUUID)(),
                        // Enabling this is just the better overall default, the only reason it isn't the upstream default is backwards compatibility
                        RetainExceptOnCreate: true,
                    });
                    break;
                case stack_events_1.RollbackChoice.CONTINUE_UPDATE_ROLLBACK:
                    if (options.orphanFailedResources) {
                        // Find the failed resources from the deployment and automatically skip them
                        // (Using deployment log because we definitely have `DescribeStackEvents` permissions, and we might not have
                        // `DescribeStackResources` permissions).
                        const poller = new stack_events_1.StackEventPoller(cfn, {
                            stackName: deployName,
                            stackStatuses: ['ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_IN_PROGRESS'],
                        });
                        await poller.poll();
                        resourcesToSkip = poller.resourceErrors
                            .filter((r) => !r.isStackEvent && r.parentStackLogicalIds.length === 0)
                            .map((r) => r.event.LogicalResourceId ?? '');
                    }
                    const skipDescription = resourcesToSkip.length > 0 ? ` (orphaning: ${resourcesToSkip.join(', ')})` : '';
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Continuing rollback of stack ${deployName}${skipDescription}`));
                    await cfn.continueUpdateRollback({
                        StackName: deployName,
                        ClientRequestToken: (0, crypto_1.randomUUID)(),
                        RoleARN: executionRoleArn,
                        ResourcesToSkip: resourcesToSkip,
                    });
                    break;
                case stack_events_1.RollbackChoice.ROLLBACK_FAILED:
                    await this.ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_WARN.msg(`Stack ${deployName} failed creation and rollback. This state cannot be rolled back. You can recreate this stack by running 'cdk deploy'.`));
                    return { stackArn, notInRollbackableState: true };
                default:
                    throw new toolkit_error_1.ToolkitError(`Unexpected rollback choice: ${cloudFormationStack.stackStatus.rollbackChoice}`);
            }
            const monitor = new stack_events_1.StackActivityMonitor({
                cfn,
                stack: options.stack,
                stackName: deployName,
                ioHelper: this.ioHelper,
            });
            await monitor.start();
            let stackErrorMessage = undefined;
            let finalStackState = cloudFormationStack;
            try {
                const successStack = await (0, cfn_api_1.stabilizeStack)(cfn, this.ioHelper, deployName);
                // This shouldn't really happen, but catch it anyway. You never know.
                if (!successStack) {
                    throw new toolkit_error_1.ToolkitError('Stack deploy failed (the stack disappeared while we were rolling it back)');
                }
                finalStackState = successStack;
                const errors = monitor.errors.join(', ');
                if (errors) {
                    stackErrorMessage = errors;
                }
            }
            catch (e) {
                stackErrorMessage = suffixWithErrors((0, util_1.formatErrorMessage)(e), monitor.errors);
            }
            finally {
                await monitor.stop();
            }
            if (finalStackState.stackStatus.isRollbackSuccess || !stackErrorMessage) {
                return { stackArn, success: true };
            }
            // Either we need to ignore some resources to continue the rollback, or something went wrong
            if (finalStackState.stackStatus.rollbackChoice === stack_events_1.RollbackChoice.CONTINUE_UPDATE_ROLLBACK && options.orphanFailedResources) {
                // Do another loop-de-loop
                continue;
            }
            throw new toolkit_error_1.ToolkitError(`${stackErrorMessage} (fix problem and retry, or orphan these resources using --orphan or --force)`);
        }
        throw new toolkit_error_1.ToolkitError("Rollback did not finish after a large number of iterations; stopping because it looks like we're not making progress anymore. You can retry if rollback was progressing as expected.");
    }
    async destroyStack(options) {
        const env = await this.envs.accessStackForMutableStackOperations(options.stack);
        const executionRoleArn = await env.replacePlaceholders(options.roleArn ?? options.stack.cloudFormationExecutionRoleArn);
        return (0, deploy_stack_1.destroyStack)({
            sdk: env.sdk,
            roleArn: executionRoleArn,
            stack: options.stack,
            deployName: options.deployName,
        }, this.ioHelper);
    }
    async stackExists(options) {
        let env;
        if (options.tryLookupRole) {
            env = await this.envs.accessStackForLookupBestEffort(options.stack);
        }
        else {
            env = await this.envs.accessStackForReadOnlyStackOperations(options.stack);
        }
        const stack = await cloudformation_1.CloudFormationStack.lookup(env.sdk.cloudFormation(), options.deployName ?? options.stack.stackName);
        return stack.exists;
    }
    /**
     * Build a single asset from an asset manifest
     *
     * If an assert manifest artifact is given, the bootstrap stack version
     * will be validated according to the constraints in that manifest artifact.
     * If that is not necessary, `'no-version-validation'` can be passed.
     */
    // eslint-disable-next-line max-len
    async buildSingleAsset(assetArtifact, assetManifest, asset, options) {
        if (assetArtifact !== 'no-version-validation') {
            const env = await this.envs.accessStackForReadOnlyStackOperations(options.stack);
            await this.validateBootstrapStackVersion(options.stack.stackName, assetArtifact.requiresBootstrapStackVersion, assetArtifact.bootstrapStackVersionSsmParameter, env.resources);
        }
        const resolvedEnvironment = await this.envs.resolveStackEnvironment(options.stack);
        const publisher = this.cachedPublisher(assetManifest, resolvedEnvironment, options.stackName);
        await publisher.buildEntry(asset);
        if (publisher.hasFailures) {
            throw new toolkit_error_1.ToolkitError(`Failed to build asset ${asset.displayName(false)}`);
        }
    }
    /**
     * Publish a single asset from an asset manifest
     */
    async publishSingleAsset(assetManifest, asset, options) {
        const stackEnv = await this.envs.resolveStackEnvironment(options.stack);
        // No need to validate anymore, we already did that during build
        const publisher = this.cachedPublisher(assetManifest, stackEnv, options.stackName);
        await publisher.publishEntry(asset, {
            allowCrossAccount: await this.allowCrossAccountAssetPublishingForEnv(options.stack),
            force: options.forcePublish,
        });
        if (publisher.hasFailures) {
            throw new toolkit_error_1.ToolkitError(`Failed to publish asset ${asset.displayName(true)}`);
        }
    }
    async allowCrossAccountAssetPublishingForEnv(stack) {
        if (this._allowCrossAccountAssetPublishing === undefined) {
            const env = await this.envs.accessStackForReadOnlyStackOperations(stack);
            this._allowCrossAccountAssetPublishing = await (0, checks_1.determineAllowCrossAccountAssetPublishing)(env.sdk, this.ioHelper, this.props.toolkitStackName);
        }
        return this._allowCrossAccountAssetPublishing;
    }
    /**
     * Return whether a single asset has been published already
     */
    async isSingleAssetPublished(assetManifest, asset, options) {
        const stackEnv = await this.envs.resolveStackEnvironment(options.stack);
        const publisher = this.cachedPublisher(assetManifest, stackEnv, options.stackName);
        return publisher.isEntryPublished(asset);
    }
    /**
     * Validate that the bootstrap stack has the right version for this stack
     *
     * Call into envResources.validateVersion, but prepend the stack name in case of failure.
     */
    async validateBootstrapStackVersion(stackName, requiresBootstrapStackVersion, bootstrapStackVersionSsmParameter, envResources) {
        try {
            await envResources.validateVersion(requiresBootstrapStackVersion, bootstrapStackVersionSsmParameter);
        }
        catch (e) {
            throw new toolkit_error_1.ToolkitError(`${stackName}: ${(0, util_1.formatErrorMessage)(e)}`);
        }
    }
    cachedPublisher(assetManifest, env, stackName) {
        const existing = this.publisherCache.get(assetManifest);
        if (existing) {
            return existing;
        }
        const prefix = stackName ? `${chalk.bold(stackName)}: ` : '';
        const publisher = new cdk_assets.AssetPublishing(assetManifest, {
            // The AssetPublishing class takes care of role assuming etc, so it's okay to
            // give it a direct `SdkProvider`.
            aws: new asset_publishing_1.PublishingAws(this.assetSdkProvider, env),
            progressListener: new ParallelSafeAssetProgress(prefix, this.ioHelper),
        });
        this.publisherCache.set(assetManifest, publisher);
        return publisher;
    }
}
exports.Deployments = Deployments;
/**
 * Asset progress that doesn't do anything with percentages (currently)
 */
class ParallelSafeAssetProgress extends asset_publishing_1.BasePublishProgressListener {
    prefix;
    constructor(prefix, ioHelper) {
        super(ioHelper);
        this.prefix = prefix;
    }
    getMessage(type, event) {
        return `${this.prefix}${type}: ${event.message}`;
    }
}
function suffixWithErrors(msg, errors) {
    return errors && errors.length > 0 ? `${msg}: ${errors.join(', ')}` : msg;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95bWVudHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYXBpL2RlcGxveW1lbnRzL2RlcGxveW1lbnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFvQztBQUVwQyx5Q0FBeUM7QUFDekMsK0JBQStCO0FBQy9CLHFFQUFnRTtBQUNoRSx5REFHNEI7QUFDNUIsdUNBR21CO0FBQ25CLHFDQUFxRTtBQUVyRSxpREFBMkQ7QUFHM0QscUNBQWdEO0FBTWhELHNEQUsyQjtBQUMzQixnREFBOEU7QUFFOUUsMkNBQWtEO0FBRWxELGtEQUF5RjtBQUV6RixvREFBZ0Q7QUFDaEQsa0RBQTZEO0FBRTdELE1BQU0sb0NBQW9DLEdBQUcsRUFBRSxDQUFDO0FBMFBoRDs7OztHQUlHO0FBQ0gsTUFBYSxXQUFXO0lBNkJPO0lBNUJiLElBQUksQ0FBb0I7SUFFeEM7Ozs7Ozs7T0FPRztJQUNjLGdCQUFnQixDQUFjO0lBRS9DOzs7Ozs7O09BT0c7SUFDYyxzQkFBc0IsQ0FBYztJQUVwQyxjQUFjLEdBQUcsSUFBSSxHQUFHLEVBQXdELENBQUM7SUFFMUYsaUNBQWlDLENBQXNCO0lBRTlDLFFBQVEsQ0FBVztJQUVwQyxZQUE2QixLQUF1QjtRQUF2QixVQUFLLEdBQUwsS0FBSyxDQUFrQjtRQUNsRCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsS0FBSyxDQUFDLFdBQVcsQ0FBQztRQUMxQyxJQUFJLENBQUMsc0JBQXNCLEdBQUcsS0FBSyxDQUFDLFdBQVcsQ0FBQztRQUNoRCxJQUFJLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQyxRQUFRLENBQUM7UUFDL0IsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLCtCQUFpQixDQUMvQixLQUFLLENBQUMsV0FBVyxFQUNqQixLQUFLLENBQUMsZ0JBQWdCLElBQUkseUNBQTBCLEVBQ3BELElBQUksQ0FBQyxRQUFRLENBQ2QsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNJLEtBQUss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QixTQUFRLDhDQUEyQjtJQUNoRCxNQUFNLENBQVM7SUFFaEMsWUFBWSxNQUFjLEVBQUUsUUFBa0I7UUFDNUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ2hCLElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0lBQ3ZCLENBQUM7SUFFUyxVQUFVLENBQUMsSUFBMEIsRUFBRSxLQUFrQztRQUNqRixPQUFPLEdBQUcsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQ25ELENBQUM7Q0FDRjtBQUVELFNBQVMsZ0JBQWdCLENBQUMsR0FBVyxFQUFFLE1BQWlCO0lBQ3RELE9BQU8sTUFBTSxJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsS0FBSyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQztBQUM1RSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgdHlwZSAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgKiBhcyBjZGtfYXNzZXRzIGZyb20gJ2Nkay1hc3NldHMnO1xuaW1wb3J0ICogYXMgY2hhbGsgZnJvbSAnY2hhbGsnO1xuaW1wb3J0IHsgQXNzZXRNYW5pZmVzdEJ1aWxkZXIgfSBmcm9tICcuL2Fzc2V0LW1hbmlmZXN0LWJ1aWxkZXInO1xuaW1wb3J0IHtcbiAgQmFzZVB1Ymxpc2hQcm9ncmVzc0xpc3RlbmVyLFxuICBQdWJsaXNoaW5nQXdzLFxufSBmcm9tICcuL2Fzc2V0LXB1Ymxpc2hpbmcnO1xuaW1wb3J0IHtcbiAgc3RhYmlsaXplU3RhY2ssXG4gIHVwbG9hZFN0YWNrVGVtcGxhdGVBc3NldHMsXG59IGZyb20gJy4vY2ZuLWFwaSc7XG5pbXBvcnQgeyBkZXRlcm1pbmVBbGxvd0Nyb3NzQWNjb3VudEFzc2V0UHVibGlzaGluZyB9IGZyb20gJy4vY2hlY2tzJztcblxuaW1wb3J0IHsgZGVwbG95U3RhY2ssIGRlc3Ryb3lTdGFjayB9IGZyb20gJy4vZGVwbG95LXN0YWNrJztcbmltcG9ydCB0eXBlIHsgRGVwbG95bWVudE1ldGhvZCB9IGZyb20gJy4vZGVwbG95bWVudC1tZXRob2QnO1xuaW1wb3J0IHR5cGUgeyBEZXBsb3lTdGFja1Jlc3VsdCB9IGZyb20gJy4vZGVwbG95bWVudC1yZXN1bHQnO1xuaW1wb3J0IHsgZm9ybWF0RXJyb3JNZXNzYWdlIH0gZnJvbSAnLi4vLi4vdXRpbCc7XG5pbXBvcnQgdHlwZSB7IFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHR5cGUge1xuICBUZW1wbGF0ZSxcbiAgUm9vdFRlbXBsYXRlV2l0aE5lc3RlZFN0YWNrcyxcbn0gZnJvbSAnLi4vY2xvdWRmb3JtYXRpb24nO1xuaW1wb3J0IHtcbiAgQ2xvdWRGb3JtYXRpb25TdGFjayxcbiAgbG9hZEN1cnJlbnRUZW1wbGF0ZSxcbiAgbG9hZEN1cnJlbnRUZW1wbGF0ZVdpdGhOZXN0ZWRTdGFja3MsXG4gIG1ha2VCb2R5UGFyYW1ldGVyLFxufSBmcm9tICcuLi9jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgeyB0eXBlIEVudmlyb25tZW50UmVzb3VyY2VzLCBFbnZpcm9ubWVudEFjY2VzcyB9IGZyb20gJy4uL2Vudmlyb25tZW50JztcbmltcG9ydCB0eXBlIHsgSG90c3dhcE1vZGUsIEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyB9IGZyb20gJy4uL2hvdHN3YXAvY29tbW9uJztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgdHlwZSB7IFJlc291cmNlSWRlbnRpZmllclN1bW1hcmllcywgUmVzb3VyY2VzVG9JbXBvcnQgfSBmcm9tICcuLi9yZXNvdXJjZS1pbXBvcnQnO1xuaW1wb3J0IHsgU3RhY2tBY3Rpdml0eU1vbml0b3IsIFN0YWNrRXZlbnRQb2xsZXIsIFJvbGxiYWNrQ2hvaWNlIH0gZnJvbSAnLi4vc3RhY2stZXZlbnRzJztcbmltcG9ydCB0eXBlIHsgVGFnIH0gZnJvbSAnLi4vdGFncyc7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcbmltcG9ydCB7IERFRkFVTFRfVE9PTEtJVF9TVEFDS19OQU1FIH0gZnJvbSAnLi4vdG9vbGtpdC1pbmZvJztcblxuY29uc3QgQk9PVFNUUkFQX1NUQUNLX1ZFUlNJT05fRk9SX1JPTExCQUNLID0gMjM7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGVwbG95U3RhY2tPcHRpb25zIHtcbiAgLyoqXG4gICAqIFN0YWNrIHRvIGRlcGxveVxuICAgKi9cbiAgcmVhZG9ubHkgc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdDtcblxuICAvKipcbiAgICogRXhlY3V0aW9uIHJvbGUgZm9yIHRoZSBkZXBsb3ltZW50IChwYXNzIHRocm91Z2ggdG8gQ2xvdWRGb3JtYXRpb24pXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gQ3VycmVudCByb2xlXG4gICAqL1xuICByZWFkb25seSByb2xlQXJuPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUb3BpYyBBUk5zIHRvIHNlbmQgYSBtZXNzYWdlIHdoZW4gZGVwbG95bWVudCBmaW5pc2hlcyAocGFzcyB0aHJvdWdoIHRvIENsb3VkRm9ybWF0aW9uKVxuICAgKlxuICAgKiBAZGVmYXVsdCAtIE5vIG5vdGlmaWNhdGlvbnNcbiAgICovXG4gIHJlYWRvbmx5IG5vdGlmaWNhdGlvbkFybnM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogT3ZlcnJpZGUgbmFtZSB1bmRlciB3aGljaCBzdGFjayB3aWxsIGJlIGRlcGxveWVkXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gVXNlIGFydGlmYWN0IGRlZmF1bHRcbiAgICovXG4gIHJlYWRvbmx5IGRlcGxveU5hbWU/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIE5hbWUgb2YgdGhlIHRvb2xraXQgc3RhY2ssIGlmIG5vdCB0aGUgZGVmYXVsdCBuYW1lXG4gICAqXG4gICAqIEBkZWZhdWx0ICdDREtUb29sa2l0J1xuICAgKi9cbiAgcmVhZG9ubHkgdG9vbGtpdFN0YWNrTmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogTGlzdCBvZiBhc3NldCBJRHMgd2hpY2ggc2hvdWxkIE5PVCBiZSBidWlsdCBvciB1cGxvYWRlZFxuICAgKlxuICAgKiBAZGVmYXVsdCAtIEJ1aWxkIGFsbCBhc3NldHNcbiAgICovXG4gIHJlYWRvbmx5IHJldXNlQXNzZXRzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIFN0YWNrIHRhZ3MgKHBhc3MgdGhyb3VnaCB0byBDbG91ZEZvcm1hdGlvbilcbiAgICovXG4gIHJlYWRvbmx5IHRhZ3M/OiBUYWdbXTtcblxuICAvKipcbiAgICogU3RhZ2UgdGhlIGNoYW5nZSBzZXQgYnV0IGRvbid0IGV4ZWN1dGUgaXRcbiAgICpcbiAgICogQGRlZmF1bHQgLSB0cnVlXG4gICAqIEBkZXByZWNhdGVkIFVzZSAnZGVwbG95bWVudE1ldGhvZCcgaW5zdGVhZFxuICAgKi9cbiAgcmVhZG9ubHkgZXhlY3V0ZT86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIG5hbWUgdG8gdXNlIGZvciB0aGUgQ2xvdWRGb3JtYXRpb24gY2hhbmdlIHNldC5cbiAgICogSWYgbm90IHByb3ZpZGVkLCBhIG5hbWUgd2lsbCBiZSBnZW5lcmF0ZWQgYXV0b21hdGljYWxseS5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVXNlICdkZXBsb3ltZW50TWV0aG9kJyBpbnN0ZWFkXG4gICAqL1xuICByZWFkb25seSBjaGFuZ2VTZXROYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBTZWxlY3QgdGhlIGRlcGxveW1lbnQgbWV0aG9kIChkaXJlY3Qgb3IgdXNpbmcgYSBjaGFuZ2Ugc2V0KVxuICAgKlxuICAgKiBAZGVmYXVsdCAtIENoYW5nZSBzZXQgd2l0aCBkZWZhdWx0IG9wdGlvbnNcbiAgICovXG4gIHJlYWRvbmx5IGRlcGxveW1lbnRNZXRob2Q/OiBEZXBsb3ltZW50TWV0aG9kO1xuXG4gIC8qKlxuICAgKiBGb3JjZSBkZXBsb3ltZW50LCBldmVuIGlmIHRoZSBkZXBsb3llZCB0ZW1wbGF0ZSBpcyBpZGVudGljYWwgdG8gdGhlIG9uZSB3ZSBhcmUgYWJvdXQgdG8gZGVwbG95LlxuICAgKiBAZGVmYXVsdCBmYWxzZSBkZXBsb3ltZW50IHdpbGwgYmUgc2tpcHBlZCBpZiB0aGUgdGVtcGxhdGUgaXMgaWRlbnRpY2FsXG4gICAqL1xuICByZWFkb25seSBmb3JjZURlcGxveW1lbnQ/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBFeHRyYSBwYXJhbWV0ZXJzIGZvciBDbG91ZEZvcm1hdGlvblxuICAgKiBAZGVmYXVsdCAtIG5vIGFkZGl0aW9uYWwgcGFyYW1ldGVycyB3aWxsIGJlIHBhc3NlZCB0byB0aGUgdGVtcGxhdGVcbiAgICovXG4gIHJlYWRvbmx5IHBhcmFtZXRlcnM/OiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfCB1bmRlZmluZWQgfTtcblxuICAvKipcbiAgICogVXNlIHByZXZpb3VzIHZhbHVlcyBmb3IgdW5zcGVjaWZpZWQgcGFyYW1ldGVyc1xuICAgKlxuICAgKiBJZiBub3Qgc2V0LCBhbGwgcGFyYW1ldGVycyBtdXN0IGJlIHNwZWNpZmllZCBmb3IgZXZlcnkgZGVwbG95bWVudC5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgdXNlUHJldmlvdXNQYXJhbWV0ZXJzPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogUm9sbGJhY2sgZmFpbGVkIGRlcGxveW1lbnRzXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IHJvbGxiYWNrPzogYm9vbGVhbjtcblxuICAvKlxuICAgKiBXaGV0aGVyIHRvIHBlcmZvcm0gYSAnaG90c3dhcCcgZGVwbG95bWVudC5cbiAgICogQSAnaG90c3dhcCcgZGVwbG95bWVudCB3aWxsIGF0dGVtcHQgdG8gc2hvcnQtY2lyY3VpdCBDbG91ZEZvcm1hdGlvblxuICAgKiBhbmQgdXBkYXRlIHRoZSBhZmZlY3RlZCByZXNvdXJjZXMgbGlrZSBMYW1iZGEgZnVuY3Rpb25zIGRpcmVjdGx5LlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIGBIb3Rzd2FwTW9kZS5GVUxMX0RFUExPWU1FTlRgIGZvciByZWd1bGFyIGRlcGxveW1lbnRzLCBgSG90c3dhcE1vZGUuSE9UU1dBUF9PTkxZYCBmb3IgJ3dhdGNoJyBkZXBsb3ltZW50c1xuICAgKi9cbiAgcmVhZG9ubHkgaG90c3dhcD86IEhvdHN3YXBNb2RlO1xuXG4gIC8qKlxuICAgKiBQcm9wZXJ0aWVzIHRoYXQgY29uZmlndXJlIGhvdHN3YXAgYmVoYXZpb3JcbiAgICovXG4gIHJlYWRvbmx5IGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcz86IEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcztcblxuICAvKipcbiAgICogVGhlIGV4dHJhIHN0cmluZyB0byBhcHBlbmQgdG8gdGhlIFVzZXItQWdlbnQgaGVhZGVyIHdoZW4gcGVyZm9ybWluZyBBV1MgU0RLIGNhbGxzLlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIG5vdGhpbmcgZXh0cmEgaXMgYXBwZW5kZWQgdG8gdGhlIFVzZXItQWdlbnQgaGVhZGVyXG4gICAqL1xuICByZWFkb25seSBleHRyYVVzZXJBZ2VudD86IHN0cmluZztcblxuICAvKipcbiAgICogTGlzdCBvZiBleGlzdGluZyByZXNvdXJjZXMgdG8gYmUgSU1QT1JURUQgaW50byB0aGUgc3RhY2ssIGluc3RlYWQgb2YgYmVpbmcgQ1JFQVRFRFxuICAgKi9cbiAgcmVhZG9ubHkgcmVzb3VyY2VzVG9JbXBvcnQ/OiBSZXNvdXJjZXNUb0ltcG9ydDtcblxuICAvKipcbiAgICogSWYgcHJlc2VudCwgdXNlIHRoaXMgZ2l2ZW4gdGVtcGxhdGUgaW5zdGVhZCBvZiB0aGUgc3RvcmVkIG9uZVxuICAgKlxuICAgKiBAZGVmYXVsdCAtIFVzZSB0aGUgc3RvcmVkIHRlbXBsYXRlXG4gICAqL1xuICByZWFkb25seSBvdmVycmlkZVRlbXBsYXRlPzogYW55O1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGJ1aWxkL3B1Ymxpc2ggYXNzZXRzIGluIHBhcmFsbGVsXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWUgVG8gcmVtYWluIGJhY2t3YXJkIGNvbXBhdGlibGUuXG4gICAqL1xuICByZWFkb25seSBhc3NldFBhcmFsbGVsaXNtPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogV2hldGhlciB0byBkZXBsb3kgaWYgdGhlIGFwcCBjb250YWlucyBubyBzdGFja3MuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHRoaXMgb3B0aW9uIHNlZW1zIHRvIGJlIHVuc2VkIGluc2lkZSBkZXBsb3ltZW50c1xuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgaWdub3JlTm9TdGFja3M/OiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJvbGxiYWNrU3RhY2tPcHRpb25zIHtcbiAgLyoqXG4gICAqIFN0YWNrIHRvIHJvbGwgYmFja1xuICAgKi9cbiAgcmVhZG9ubHkgc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdDtcblxuICAvKipcbiAgICogRXhlY3V0aW9uIHJvbGUgZm9yIHRoZSBkZXBsb3ltZW50IChwYXNzIHRocm91Z2ggdG8gQ2xvdWRGb3JtYXRpb24pXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gQ3VycmVudCByb2xlXG4gICAqL1xuICByZWFkb25seSByb2xlQXJuPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBOYW1lIG9mIHRoZSB0b29sa2l0IHN0YWNrLCBpZiBub3QgdGhlIGRlZmF1bHQgbmFtZVxuICAgKlxuICAgKiBAZGVmYXVsdCAnQ0RLVG9vbGtpdCdcbiAgICovXG4gIHJlYWRvbmx5IHRvb2xraXRTdGFja05hbWU/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gYXV0b21hdGljYWxseSBvcnBoYW4gYWxsIGZhaWxlZCByZXNvdXJjZXMgZHVyaW5nIHRoZSByb2xsYmFja1xuICAgKlxuICAgKiBUaGlzIHdpbGwgZm9yY2UgYSByb2xsYmFjayB0aGF0IG90aGVyd2lzZSB3b3VsZCBoYXZlIGZhaWxlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IG9ycGhhbkZhaWxlZFJlc291cmNlcz86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIE9ycGhhbiB0aGUgcmVzb3VyY2VzIHdpdGggdGhlIGdpdmVuIGxvZ2ljYWwgSURzXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gTm8gb3JwaGFuaW5nXG4gICAqL1xuICByZWFkb25seSBvcnBoYW5Mb2dpY2FsSWRzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gdmFsaWRhdGUgdGhlIHZlcnNpb24gb2YgdGhlIGJvb3RzdHJhcCBzdGFjayBwZXJtaXNzaW9uc1xuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSB2YWxpZGF0ZUJvb3RzdHJhcFN0YWNrVmVyc2lvbj86IGJvb2xlYW47XG59XG5cbmV4cG9ydCB0eXBlIFJvbGxiYWNrU3RhY2tSZXN1bHQgPSB7IHJlYWRvbmx5IHN0YWNrQXJuOiBzdHJpbmcgfSAmIChcbiAgfCB7IHJlYWRvbmx5IG5vdEluUm9sbGJhY2thYmxlU3RhdGU6IHRydWUgfVxuICB8IHsgcmVhZG9ubHkgc3VjY2VzczogdHJ1ZTsgbm90SW5Sb2xsYmFja2FibGVTdGF0ZT86IHVuZGVmaW5lZCB9XG4pO1xuXG5pbnRlcmZhY2UgQXNzZXRPcHRpb25zIHtcbiAgLyoqXG4gICAqIFN0YWNrIHdpdGggYXNzZXRzIHRvIGJ1aWxkLlxuICAgKi9cbiAgcmVhZG9ubHkgc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdDtcblxuICAvKipcbiAgICogRXhlY3V0aW9uIHJvbGUgZm9yIHRoZSBidWlsZGluZy5cbiAgICpcbiAgICogQGRlZmF1bHQgLSBDdXJyZW50IHJvbGVcbiAgICovXG4gIHJlYWRvbmx5IHJvbGVBcm4/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQnVpbGRTdGFja0Fzc2V0c09wdGlvbnMgZXh0ZW5kcyBBc3NldE9wdGlvbnMge1xuICAvKipcbiAgICogU3RhY2sgbmFtZSB0aGlzIGFzc2V0IGlzIGZvclxuICAgKi9cbiAgcmVhZG9ubHkgc3RhY2tOYW1lPzogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgUHVibGlzaFN0YWNrQXNzZXRzT3B0aW9ucyBleHRlbmRzIEFzc2V0T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBTdGFjayBuYW1lIHRoaXMgYXNzZXQgaXMgZm9yXG4gICAqL1xuICByZWFkb25seSBzdGFja05hbWU/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEFsd2F5cyBwdWJsaXNoLCBldmVuIGlmIGl0IGFscmVhZHkgZXhpc3RzXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBmb3JjZVB1Ymxpc2g/OiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIERlc3Ryb3lTdGFja09wdGlvbnMge1xuICBzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0O1xuICBkZXBsb3lOYW1lPzogc3RyaW5nO1xuICByb2xlQXJuPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0YWNrRXhpc3RzT3B0aW9ucyB7XG4gIHN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q7XG4gIGRlcGxveU5hbWU/OiBzdHJpbmc7XG4gIHRyeUxvb2t1cFJvbGU/OiBib29sZWFuO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIERlcGxveW1lbnRzUHJvcHMge1xuICByZWFkb25seSBzZGtQcm92aWRlcjogU2RrUHJvdmlkZXI7XG4gIHJlYWRvbmx5IHRvb2xraXRTdGFja05hbWU/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcjtcbn1cblxuLyoqXG4gKiBTY29wZSBmb3IgYSBzaW5nbGUgc2V0IG9mIGRlcGxveW1lbnRzIGZyb20gYSBzZXQgb2YgQ2xvdWQgQXNzZW1ibHkgQXJ0aWZhY3RzXG4gKlxuICogTWFuYWdlcyBsb29rdXAgb2YgU0RLcywgQm9vdHN0cmFwIHN0YWNrcywgZXRjLlxuICovXG5leHBvcnQgY2xhc3MgRGVwbG95bWVudHMge1xuICBwdWJsaWMgcmVhZG9ubHkgZW52czogRW52aXJvbm1lbnRBY2Nlc3M7XG5cbiAgLyoqXG4gICAqIFNESyBwcm92aWRlciBmb3IgYXNzZXQgcHVibGlzaGluZyAoZG8gbm90IHVzZSBmb3IgYW55dGhpbmcgZWxzZSkuXG4gICAqXG4gICAqIFRoaXMgU0RLIHByb3ZpZGVyIGlzIG9ubHkgYWxsb3dlZCB0byBiZSB1c2VkIGZvciB0aGF0IHB1cnBvc2UsIG5vdGhpbmcgZWxzZS5cbiAgICpcbiAgICogSXQncyBub3QgYSBkaWZmZXJlbnQgb2JqZWN0LCBidXQgdGhlIGZpZWxkIG5hbWUgc2hvdWxkIGltcGx5IHRoYXQgdGhpc1xuICAgKiBvYmplY3Qgc2hvdWxkIG5vdCBiZSB1c2VkIGRpcmVjdGx5LCBleGNlcHQgdG8gcGFzcyB0byBhc3NldCBoYW5kbGluZyByb3V0aW5lcy5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgYXNzZXRTZGtQcm92aWRlcjogU2RrUHJvdmlkZXI7XG5cbiAgLyoqXG4gICAqIFNESyBwcm92aWRlciBmb3IgcGFzc2luZyB0byBkZXBsb3lTdGFja1xuICAgKlxuICAgKiBUaGlzIFNESyBwcm92aWRlciBpcyBvbmx5IGFsbG93ZWQgdG8gYmUgdXNlZCBmb3IgdGhhdCBwdXJwb3NlLCBub3RoaW5nIGVsc2UuXG4gICAqXG4gICAqIEl0J3Mgbm90IGEgZGlmZmVyZW50IG9iamVjdCwgYnV0IHRoZSBmaWVsZCBuYW1lIHNob3VsZCBpbXBseSB0aGF0IHRoaXNcbiAgICogb2JqZWN0IHNob3VsZCBub3QgYmUgdXNlZCBkaXJlY3RseSwgZXhjZXB0IHRvIHBhc3MgdG8gYGRlcGxveVN0YWNrYC5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgZGVwbG95U3RhY2tTZGtQcm92aWRlcjogU2RrUHJvdmlkZXI7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBwdWJsaXNoZXJDYWNoZSA9IG5ldyBNYXA8Y2RrX2Fzc2V0cy5Bc3NldE1hbmlmZXN0LCBjZGtfYXNzZXRzLkFzc2V0UHVibGlzaGluZz4oKTtcblxuICBwcml2YXRlIF9hbGxvd0Nyb3NzQWNjb3VudEFzc2V0UHVibGlzaGluZzogYm9vbGVhbiB8IHVuZGVmaW5lZDtcblxuICBwcml2YXRlIHJlYWRvbmx5IGlvSGVscGVyOiBJb0hlbHBlcjtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHByb3BzOiBEZXBsb3ltZW50c1Byb3BzKSB7XG4gICAgdGhpcy5hc3NldFNka1Byb3ZpZGVyID0gcHJvcHMuc2RrUHJvdmlkZXI7XG4gICAgdGhpcy5kZXBsb3lTdGFja1Nka1Byb3ZpZGVyID0gcHJvcHMuc2RrUHJvdmlkZXI7XG4gICAgdGhpcy5pb0hlbHBlciA9IHByb3BzLmlvSGVscGVyO1xuICAgIHRoaXMuZW52cyA9IG5ldyBFbnZpcm9ubWVudEFjY2VzcyhcbiAgICAgIHByb3BzLnNka1Byb3ZpZGVyLFxuICAgICAgcHJvcHMudG9vbGtpdFN0YWNrTmFtZSA/PyBERUZBVUxUX1RPT0xLSVRfU1RBQ0tfTkFNRSxcbiAgICAgIHRoaXMuaW9IZWxwZXIsXG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgZW52aXJvbm1lbnQgZm9yIGEgc3RhY2suXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcmVzb2x2ZUVudmlyb25tZW50KHN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QpOiBQcm9taXNlPGN4YXBpLkVudmlyb25tZW50PiB7XG4gICAgcmV0dXJuIHRoaXMuZW52cy5yZXNvbHZlU3RhY2tFbnZpcm9ubWVudChzdGFjayk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcmVhZEN1cnJlbnRUZW1wbGF0ZVdpdGhOZXN0ZWRTdGFja3MoXG4gICAgcm9vdFN0YWNrQXJ0aWZhY3Q6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCxcbiAgICByZXRyaWV2ZVByb2Nlc3NlZFRlbXBsYXRlOiBib29sZWFuID0gZmFsc2UsXG4gICk6IFByb21pc2U8Um9vdFRlbXBsYXRlV2l0aE5lc3RlZFN0YWNrcz4ge1xuICAgIGNvbnN0IGVudiA9IGF3YWl0IHRoaXMuZW52cy5hY2Nlc3NTdGFja0Zvckxvb2t1cEJlc3RFZmZvcnQocm9vdFN0YWNrQXJ0aWZhY3QpO1xuICAgIHJldHVybiBsb2FkQ3VycmVudFRlbXBsYXRlV2l0aE5lc3RlZFN0YWNrcyhyb290U3RhY2tBcnRpZmFjdCwgZW52LnNkaywgcmV0cmlldmVQcm9jZXNzZWRUZW1wbGF0ZSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcmVhZEN1cnJlbnRUZW1wbGF0ZShzdGFja0FydGlmYWN0OiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QpOiBQcm9taXNlPFRlbXBsYXRlPiB7XG4gICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgUmVhZGluZyBleGlzdGluZyB0ZW1wbGF0ZSBmb3Igc3RhY2sgJHtzdGFja0FydGlmYWN0LmRpc3BsYXlOYW1lfS5gKSk7XG4gICAgY29uc3QgZW52ID0gYXdhaXQgdGhpcy5lbnZzLmFjY2Vzc1N0YWNrRm9yTG9va3VwQmVzdEVmZm9ydChzdGFja0FydGlmYWN0KTtcbiAgICByZXR1cm4gbG9hZEN1cnJlbnRUZW1wbGF0ZShzdGFja0FydGlmYWN0LCBlbnYuc2RrKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyByZXNvdXJjZUlkZW50aWZpZXJTdW1tYXJpZXMoXG4gICAgc3RhY2tBcnRpZmFjdDogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LFxuICApOiBQcm9taXNlPFJlc291cmNlSWRlbnRpZmllclN1bW1hcmllcz4ge1xuICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coYFJldHJpZXZpbmcgdGVtcGxhdGUgc3VtbWFyeSBmb3Igc3RhY2sgJHtzdGFja0FydGlmYWN0LmRpc3BsYXlOYW1lfS5gKSk7XG4gICAgLy8gQ3VycmVudGx5LCBuZWVkcyB0byB1c2UgYGRlcGxveS1yb2xlYCBzaW5jZSBpdCBtYXkgbmVlZCB0byByZWFkIHRlbXBsYXRlcyBpbiB0aGUgc3RhZ2luZ1xuICAgIC8vIGJ1Y2tldCB3aGljaCBoYXZlIGJlZW4gZW5jcnlwdGVkIHdpdGggYSBLTVMga2V5IChhbmQgbG9va3VwLXJvbGUgbWF5IG5vdCByZWFkIGVuY3J5cHRlZCB0aGluZ3MpXG4gICAgY29uc3QgZW52ID0gYXdhaXQgdGhpcy5lbnZzLmFjY2Vzc1N0YWNrRm9yUmVhZE9ubHlTdGFja09wZXJhdGlvbnMoc3RhY2tBcnRpZmFjdCk7XG4gICAgY29uc3QgY2ZuID0gZW52LnNkay5jbG91ZEZvcm1hdGlvbigpO1xuXG4gICAgYXdhaXQgdXBsb2FkU3RhY2tUZW1wbGF0ZUFzc2V0cyhzdGFja0FydGlmYWN0LCB0aGlzKTtcblxuICAgIC8vIFVwbG9hZCB0aGUgdGVtcGxhdGUsIGlmIG5lY2Vzc2FyeSwgYmVmb3JlIHBhc3NpbmcgaXQgdG8gQ0ZOXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyBBc3NldE1hbmlmZXN0QnVpbGRlcigpO1xuICAgIGNvbnN0IGNmblBhcmFtID0gYXdhaXQgbWFrZUJvZHlQYXJhbWV0ZXIoXG4gICAgICB0aGlzLmlvSGVscGVyLFxuICAgICAgc3RhY2tBcnRpZmFjdCxcbiAgICAgIGVudi5yZXNvbHZlZEVudmlyb25tZW50LFxuICAgICAgYnVpbGRlcixcbiAgICAgIGVudi5yZXNvdXJjZXMsXG4gICAgKTtcblxuICAgIC8vIElmIHRoZSBgbWFrZUJvZHlQYXJhbWV0ZXJgIGJlZm9yZSB0aGlzIGFkZGVkIGFzc2V0cywgbWFrZSBzdXJlIHRvIHB1Ymxpc2ggdGhlbSBiZWZvcmVcbiAgICAvLyBjYWxsaW5nIHRoZSBBUEkuXG4gICAgY29uc3QgYWRkZWRBc3NldHMgPSBidWlsZGVyLnRvTWFuaWZlc3Qoc3RhY2tBcnRpZmFjdC5hc3NlbWJseS5kaXJlY3RvcnkpO1xuICAgIGZvciAoY29uc3QgZW50cnkgb2YgYWRkZWRBc3NldHMuZW50cmllcykge1xuICAgICAgYXdhaXQgdGhpcy5idWlsZFNpbmdsZUFzc2V0KCduby12ZXJzaW9uLXZhbGlkYXRpb24nLCBhZGRlZEFzc2V0cywgZW50cnksIHtcbiAgICAgICAgc3RhY2s6IHN0YWNrQXJ0aWZhY3QsXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHRoaXMucHVibGlzaFNpbmdsZUFzc2V0KGFkZGVkQXNzZXRzLCBlbnRyeSwge1xuICAgICAgICBzdGFjazogc3RhY2tBcnRpZmFjdCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2ZuLmdldFRlbXBsYXRlU3VtbWFyeShjZm5QYXJhbSk7XG4gICAgaWYgKCFyZXNwb25zZS5SZXNvdXJjZUlkZW50aWZpZXJTdW1tYXJpZXMpIHtcbiAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coJ0dldFRlbXBsYXRlU3VtbWFyeSBBUEkgY2FsbCBkaWQgbm90IHJldHVybiBcIlJlc291cmNlSWRlbnRpZmllclN1bW1hcmllc1wiJykpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzcG9uc2UuUmVzb3VyY2VJZGVudGlmaWVyU3VtbWFyaWVzID8/IFtdO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIGRlcGxveVN0YWNrKG9wdGlvbnM6IERlcGxveVN0YWNrT3B0aW9ucyk6IFByb21pc2U8RGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgICBsZXQgZGVwbG95bWVudE1ldGhvZCA9IG9wdGlvbnMuZGVwbG95bWVudE1ldGhvZDtcbiAgICBpZiAob3B0aW9ucy5jaGFuZ2VTZXROYW1lIHx8IG9wdGlvbnMuZXhlY3V0ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoZGVwbG95bWVudE1ldGhvZCkge1xuICAgICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKFxuICAgICAgICAgIFwiWW91IGNhbm5vdCBzdXBwbHkgYm90aCAnZGVwbG95bWVudE1ldGhvZCcgYW5kICdjaGFuZ2VTZXROYW1lL2V4ZWN1dGUnLiBTdXBwbHkgb25lIG9yIHRoZSBvdGhlci5cIixcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGRlcGxveW1lbnRNZXRob2QgPSB7XG4gICAgICAgIG1ldGhvZDogJ2NoYW5nZS1zZXQnLFxuICAgICAgICBjaGFuZ2VTZXROYW1lOiBvcHRpb25zLmNoYW5nZVNldE5hbWUsXG4gICAgICAgIGV4ZWN1dGU6IG9wdGlvbnMuZXhlY3V0ZSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgZW52ID0gYXdhaXQgdGhpcy5lbnZzLmFjY2Vzc1N0YWNrRm9yTXV0YWJsZVN0YWNrT3BlcmF0aW9ucyhvcHRpb25zLnN0YWNrKTtcblxuICAgIC8vIERvIGEgdmVyaWZpY2F0aW9uIG9mIHRoZSBib290c3RyYXAgc3RhY2sgdmVyc2lvblxuICAgIGF3YWl0IHRoaXMudmFsaWRhdGVCb290c3RyYXBTdGFja1ZlcnNpb24oXG4gICAgICBvcHRpb25zLnN0YWNrLnN0YWNrTmFtZSxcbiAgICAgIG9wdGlvbnMuc3RhY2sucmVxdWlyZXNCb290c3RyYXBTdGFja1ZlcnNpb24sXG4gICAgICBvcHRpb25zLnN0YWNrLmJvb3RzdHJhcFN0YWNrVmVyc2lvblNzbVBhcmFtZXRlcixcbiAgICAgIGVudi5yZXNvdXJjZXMpO1xuXG4gICAgY29uc3QgZXhlY3V0aW9uUm9sZUFybiA9IGF3YWl0IGVudi5yZXBsYWNlUGxhY2Vob2xkZXJzKG9wdGlvbnMucm9sZUFybiA/PyBvcHRpb25zLnN0YWNrLmNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUm9sZUFybik7XG5cbiAgICByZXR1cm4gZGVwbG95U3RhY2soe1xuICAgICAgc3RhY2s6IG9wdGlvbnMuc3RhY2ssXG4gICAgICByZXNvbHZlZEVudmlyb25tZW50OiBlbnYucmVzb2x2ZWRFbnZpcm9ubWVudCxcbiAgICAgIGRlcGxveU5hbWU6IG9wdGlvbnMuZGVwbG95TmFtZSxcbiAgICAgIG5vdGlmaWNhdGlvbkFybnM6IG9wdGlvbnMubm90aWZpY2F0aW9uQXJucyxcbiAgICAgIHNkazogZW52LnNkayxcbiAgICAgIHNka1Byb3ZpZGVyOiB0aGlzLmRlcGxveVN0YWNrU2RrUHJvdmlkZXIsXG4gICAgICByb2xlQXJuOiBleGVjdXRpb25Sb2xlQXJuLFxuICAgICAgcmV1c2VBc3NldHM6IG9wdGlvbnMucmV1c2VBc3NldHMsXG4gICAgICBlbnZSZXNvdXJjZXM6IGVudi5yZXNvdXJjZXMsXG4gICAgICB0YWdzOiBvcHRpb25zLnRhZ3MsXG4gICAgICBkZXBsb3ltZW50TWV0aG9kLFxuICAgICAgZm9yY2VEZXBsb3ltZW50OiBvcHRpb25zLmZvcmNlRGVwbG95bWVudCxcbiAgICAgIHBhcmFtZXRlcnM6IG9wdGlvbnMucGFyYW1ldGVycyxcbiAgICAgIHVzZVByZXZpb3VzUGFyYW1ldGVyczogb3B0aW9ucy51c2VQcmV2aW91c1BhcmFtZXRlcnMsXG4gICAgICByb2xsYmFjazogb3B0aW9ucy5yb2xsYmFjayxcbiAgICAgIGhvdHN3YXA6IG9wdGlvbnMuaG90c3dhcCxcbiAgICAgIGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlczogb3B0aW9ucy5ob3Rzd2FwUHJvcGVydHlPdmVycmlkZXMsXG4gICAgICBleHRyYVVzZXJBZ2VudDogb3B0aW9ucy5leHRyYVVzZXJBZ2VudCxcbiAgICAgIHJlc291cmNlc1RvSW1wb3J0OiBvcHRpb25zLnJlc291cmNlc1RvSW1wb3J0LFxuICAgICAgb3ZlcnJpZGVUZW1wbGF0ZTogb3B0aW9ucy5vdmVycmlkZVRlbXBsYXRlLFxuICAgICAgYXNzZXRQYXJhbGxlbGlzbTogb3B0aW9ucy5hc3NldFBhcmFsbGVsaXNtLFxuICAgIH0sIHRoaXMuaW9IZWxwZXIpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJvbGxiYWNrU3RhY2sob3B0aW9uczogUm9sbGJhY2tTdGFja09wdGlvbnMpOiBQcm9taXNlPFJvbGxiYWNrU3RhY2tSZXN1bHQ+IHtcbiAgICBsZXQgcmVzb3VyY2VzVG9Ta2lwOiBzdHJpbmdbXSA9IG9wdGlvbnMub3JwaGFuTG9naWNhbElkcyA/PyBbXTtcbiAgICBpZiAob3B0aW9ucy5vcnBoYW5GYWlsZWRSZXNvdXJjZXMgJiYgcmVzb3VyY2VzVG9Ta2lwLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJ0Nhbm5vdCBjb21iaW5lIC0tZm9yY2Ugd2l0aCAtLW9ycGhhbicpO1xuICAgIH1cblxuICAgIGNvbnN0IGVudiA9IGF3YWl0IHRoaXMuZW52cy5hY2Nlc3NTdGFja0Zvck11dGFibGVTdGFja09wZXJhdGlvbnMob3B0aW9ucy5zdGFjayk7XG5cbiAgICBpZiAob3B0aW9ucy52YWxpZGF0ZUJvb3RzdHJhcFN0YWNrVmVyc2lvbiA/PyB0cnVlKSB7XG4gICAgICAvLyBEbyBhIHZlcmlmaWNhdGlvbiBvZiB0aGUgYm9vdHN0cmFwIHN0YWNrIHZlcnNpb25cbiAgICAgIGF3YWl0IHRoaXMudmFsaWRhdGVCb290c3RyYXBTdGFja1ZlcnNpb24oXG4gICAgICAgIG9wdGlvbnMuc3RhY2suc3RhY2tOYW1lLFxuICAgICAgICBCT09UU1RSQVBfU1RBQ0tfVkVSU0lPTl9GT1JfUk9MTEJBQ0ssXG4gICAgICAgIG9wdGlvbnMuc3RhY2suYm9vdHN0cmFwU3RhY2tWZXJzaW9uU3NtUGFyYW1ldGVyLFxuICAgICAgICBlbnYucmVzb3VyY2VzKTtcbiAgICB9XG5cbiAgICBjb25zdCBjZm4gPSBlbnYuc2RrLmNsb3VkRm9ybWF0aW9uKCk7XG4gICAgY29uc3QgZGVwbG95TmFtZSA9IG9wdGlvbnMuc3RhY2suc3RhY2tOYW1lO1xuXG4gICAgLy8gV2UgbG9vcCBpbiBjYXNlIG9mIGAtLWZvcmNlYCBhbmQgdGhlIHN0YWNrIGVuZHMgdXAgaW4gYENPTlRJTlVFX1VQREFURV9ST0xMQkFDS2AuXG4gICAgbGV0IG1heExvb3BzID0gMTA7XG4gICAgd2hpbGUgKG1heExvb3BzLS0pIHtcbiAgICAgIGNvbnN0IGNsb3VkRm9ybWF0aW9uU3RhY2sgPSBhd2FpdCBDbG91ZEZvcm1hdGlvblN0YWNrLmxvb2t1cChjZm4sIGRlcGxveU5hbWUpO1xuICAgICAgY29uc3Qgc3RhY2tBcm4gPSBjbG91ZEZvcm1hdGlvblN0YWNrLnN0YWNrSWQ7XG5cbiAgICAgIGNvbnN0IGV4ZWN1dGlvblJvbGVBcm4gPSBhd2FpdCBlbnYucmVwbGFjZVBsYWNlaG9sZGVycyhvcHRpb25zLnJvbGVBcm4gPz8gb3B0aW9ucy5zdGFjay5jbG91ZEZvcm1hdGlvbkV4ZWN1dGlvblJvbGVBcm4pO1xuXG4gICAgICBzd2l0Y2ggKGNsb3VkRm9ybWF0aW9uU3RhY2suc3RhY2tTdGF0dXMucm9sbGJhY2tDaG9pY2UpIHtcbiAgICAgICAgY2FzZSBSb2xsYmFja0Nob2ljZS5OT05FOlxuICAgICAgICAgIGF3YWl0IHRoaXMuaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9XQVJOLm1zZyhgU3RhY2sgJHtkZXBsb3lOYW1lfSBkb2VzIG5vdCBuZWVkIGEgcm9sbGJhY2s6ICR7Y2xvdWRGb3JtYXRpb25TdGFjay5zdGFja1N0YXR1c31gKSk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhY2tBcm46IGNsb3VkRm9ybWF0aW9uU3RhY2suc3RhY2tJZCwgbm90SW5Sb2xsYmFja2FibGVTdGF0ZTogdHJ1ZSB9O1xuXG4gICAgICAgIGNhc2UgUm9sbGJhY2tDaG9pY2UuU1RBUlRfUk9MTEJBQ0s6XG4gICAgICAgICAgYXdhaXQgdGhpcy5pb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgSW5pdGlhdGluZyByb2xsYmFjayBvZiBzdGFjayAke2RlcGxveU5hbWV9YCkpO1xuICAgICAgICAgIGF3YWl0IGNmbi5yb2xsYmFja1N0YWNrKHtcbiAgICAgICAgICAgIFN0YWNrTmFtZTogZGVwbG95TmFtZSxcbiAgICAgICAgICAgIFJvbGVBUk46IGV4ZWN1dGlvblJvbGVBcm4sXG4gICAgICAgICAgICBDbGllbnRSZXF1ZXN0VG9rZW46IHJhbmRvbVVVSUQoKSxcbiAgICAgICAgICAgIC8vIEVuYWJsaW5nIHRoaXMgaXMganVzdCB0aGUgYmV0dGVyIG92ZXJhbGwgZGVmYXVsdCwgdGhlIG9ubHkgcmVhc29uIGl0IGlzbid0IHRoZSB1cHN0cmVhbSBkZWZhdWx0IGlzIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5XG4gICAgICAgICAgICBSZXRhaW5FeGNlcHRPbkNyZWF0ZTogdHJ1ZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBicmVhaztcblxuICAgICAgICBjYXNlIFJvbGxiYWNrQ2hvaWNlLkNPTlRJTlVFX1VQREFURV9ST0xMQkFDSzpcbiAgICAgICAgICBpZiAob3B0aW9ucy5vcnBoYW5GYWlsZWRSZXNvdXJjZXMpIHtcbiAgICAgICAgICAgIC8vIEZpbmQgdGhlIGZhaWxlZCByZXNvdXJjZXMgZnJvbSB0aGUgZGVwbG95bWVudCBhbmQgYXV0b21hdGljYWxseSBza2lwIHRoZW1cbiAgICAgICAgICAgIC8vIChVc2luZyBkZXBsb3ltZW50IGxvZyBiZWNhdXNlIHdlIGRlZmluaXRlbHkgaGF2ZSBgRGVzY3JpYmVTdGFja0V2ZW50c2AgcGVybWlzc2lvbnMsIGFuZCB3ZSBtaWdodCBub3QgaGF2ZVxuICAgICAgICAgICAgLy8gYERlc2NyaWJlU3RhY2tSZXNvdXJjZXNgIHBlcm1pc3Npb25zKS5cbiAgICAgICAgICAgIGNvbnN0IHBvbGxlciA9IG5ldyBTdGFja0V2ZW50UG9sbGVyKGNmbiwge1xuICAgICAgICAgICAgICBzdGFja05hbWU6IGRlcGxveU5hbWUsXG4gICAgICAgICAgICAgIHN0YWNrU3RhdHVzZXM6IFsnUk9MTEJBQ0tfSU5fUFJPR1JFU1MnLCAnVVBEQVRFX1JPTExCQUNLX0lOX1BST0dSRVNTJ10sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGF3YWl0IHBvbGxlci5wb2xsKCk7XG4gICAgICAgICAgICByZXNvdXJjZXNUb1NraXAgPSBwb2xsZXIucmVzb3VyY2VFcnJvcnNcbiAgICAgICAgICAgICAgLmZpbHRlcigocikgPT4gIXIuaXNTdGFja0V2ZW50ICYmIHIucGFyZW50U3RhY2tMb2dpY2FsSWRzLmxlbmd0aCA9PT0gMClcbiAgICAgICAgICAgICAgLm1hcCgocikgPT4gci5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCA/PyAnJyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3Qgc2tpcERlc2NyaXB0aW9uID0gcmVzb3VyY2VzVG9Ta2lwLmxlbmd0aCA+IDAgPyBgIChvcnBoYW5pbmc6ICR7cmVzb3VyY2VzVG9Ta2lwLmpvaW4oJywgJyl9KWAgOiAnJztcbiAgICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfV0FSTi5tc2coYENvbnRpbnVpbmcgcm9sbGJhY2sgb2Ygc3RhY2sgJHtkZXBsb3lOYW1lfSR7c2tpcERlc2NyaXB0aW9ufWApKTtcbiAgICAgICAgICBhd2FpdCBjZm4uY29udGludWVVcGRhdGVSb2xsYmFjayh7XG4gICAgICAgICAgICBTdGFja05hbWU6IGRlcGxveU5hbWUsXG4gICAgICAgICAgICBDbGllbnRSZXF1ZXN0VG9rZW46IHJhbmRvbVVVSUQoKSxcbiAgICAgICAgICAgIFJvbGVBUk46IGV4ZWN1dGlvblJvbGVBcm4sXG4gICAgICAgICAgICBSZXNvdXJjZXNUb1NraXA6IHJlc291cmNlc1RvU2tpcCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBicmVhaztcblxuICAgICAgICBjYXNlIFJvbGxiYWNrQ2hvaWNlLlJPTExCQUNLX0ZBSUxFRDpcbiAgICAgICAgICBhd2FpdCB0aGlzLmlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfV0FSTi5tc2coXG4gICAgICAgICAgICBgU3RhY2sgJHtkZXBsb3lOYW1lfSBmYWlsZWQgY3JlYXRpb24gYW5kIHJvbGxiYWNrLiBUaGlzIHN0YXRlIGNhbm5vdCBiZSByb2xsZWQgYmFjay4gWW91IGNhbiByZWNyZWF0ZSB0aGlzIHN0YWNrIGJ5IHJ1bm5pbmcgJ2NkayBkZXBsb3knLmAsXG4gICAgICAgICAgKSk7XG4gICAgICAgICAgcmV0dXJuIHsgc3RhY2tBcm4sIG5vdEluUm9sbGJhY2thYmxlU3RhdGU6IHRydWUgfTtcblxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYFVuZXhwZWN0ZWQgcm9sbGJhY2sgY2hvaWNlOiAke2Nsb3VkRm9ybWF0aW9uU3RhY2suc3RhY2tTdGF0dXMucm9sbGJhY2tDaG9pY2V9YCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1vbml0b3IgPSBuZXcgU3RhY2tBY3Rpdml0eU1vbml0b3Ioe1xuICAgICAgICBjZm4sXG4gICAgICAgIHN0YWNrOiBvcHRpb25zLnN0YWNrLFxuICAgICAgICBzdGFja05hbWU6IGRlcGxveU5hbWUsXG4gICAgICAgIGlvSGVscGVyOiB0aGlzLmlvSGVscGVyLFxuICAgICAgfSk7XG4gICAgICBhd2FpdCBtb25pdG9yLnN0YXJ0KCk7XG5cbiAgICAgIGxldCBzdGFja0Vycm9yTWVzc2FnZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgICAgbGV0IGZpbmFsU3RhY2tTdGF0ZSA9IGNsb3VkRm9ybWF0aW9uU3RhY2s7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzdWNjZXNzU3RhY2sgPSBhd2FpdCBzdGFiaWxpemVTdGFjayhjZm4sIHRoaXMuaW9IZWxwZXIsIGRlcGxveU5hbWUpO1xuXG4gICAgICAgIC8vIFRoaXMgc2hvdWxkbid0IHJlYWxseSBoYXBwZW4sIGJ1dCBjYXRjaCBpdCBhbnl3YXkuIFlvdSBuZXZlciBrbm93LlxuICAgICAgICBpZiAoIXN1Y2Nlc3NTdGFjaykge1xuICAgICAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoJ1N0YWNrIGRlcGxveSBmYWlsZWQgKHRoZSBzdGFjayBkaXNhcHBlYXJlZCB3aGlsZSB3ZSB3ZXJlIHJvbGxpbmcgaXQgYmFjayknKTtcbiAgICAgICAgfVxuICAgICAgICBmaW5hbFN0YWNrU3RhdGUgPSBzdWNjZXNzU3RhY2s7XG5cbiAgICAgICAgY29uc3QgZXJyb3JzID0gbW9uaXRvci5lcnJvcnMuam9pbignLCAnKTtcbiAgICAgICAgaWYgKGVycm9ycykge1xuICAgICAgICAgIHN0YWNrRXJyb3JNZXNzYWdlID0gZXJyb3JzO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgc3RhY2tFcnJvck1lc3NhZ2UgPSBzdWZmaXhXaXRoRXJyb3JzKGZvcm1hdEVycm9yTWVzc2FnZShlKSwgbW9uaXRvci5lcnJvcnMpO1xuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgYXdhaXQgbW9uaXRvci5zdG9wKCk7XG4gICAgICB9XG5cbiAgICAgIGlmIChmaW5hbFN0YWNrU3RhdGUuc3RhY2tTdGF0dXMuaXNSb2xsYmFja1N1Y2Nlc3MgfHwgIXN0YWNrRXJyb3JNZXNzYWdlKSB7XG4gICAgICAgIHJldHVybiB7IHN0YWNrQXJuLCBzdWNjZXNzOiB0cnVlIH07XG4gICAgICB9XG5cbiAgICAgIC8vIEVpdGhlciB3ZSBuZWVkIHRvIGlnbm9yZSBzb21lIHJlc291cmNlcyB0byBjb250aW51ZSB0aGUgcm9sbGJhY2ssIG9yIHNvbWV0aGluZyB3ZW50IHdyb25nXG4gICAgICBpZiAoZmluYWxTdGFja1N0YXRlLnN0YWNrU3RhdHVzLnJvbGxiYWNrQ2hvaWNlID09PSBSb2xsYmFja0Nob2ljZS5DT05USU5VRV9VUERBVEVfUk9MTEJBQ0sgJiYgb3B0aW9ucy5vcnBoYW5GYWlsZWRSZXNvdXJjZXMpIHtcbiAgICAgICAgLy8gRG8gYW5vdGhlciBsb29wLWRlLWxvb3BcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoXG4gICAgICAgIGAke3N0YWNrRXJyb3JNZXNzYWdlfSAoZml4IHByb2JsZW0gYW5kIHJldHJ5LCBvciBvcnBoYW4gdGhlc2UgcmVzb3VyY2VzIHVzaW5nIC0tb3JwaGFuIG9yIC0tZm9yY2UpYCxcbiAgICAgICk7XG4gICAgfVxuICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoXG4gICAgICBcIlJvbGxiYWNrIGRpZCBub3QgZmluaXNoIGFmdGVyIGEgbGFyZ2UgbnVtYmVyIG9mIGl0ZXJhdGlvbnM7IHN0b3BwaW5nIGJlY2F1c2UgaXQgbG9va3MgbGlrZSB3ZSdyZSBub3QgbWFraW5nIHByb2dyZXNzIGFueW1vcmUuIFlvdSBjYW4gcmV0cnkgaWYgcm9sbGJhY2sgd2FzIHByb2dyZXNzaW5nIGFzIGV4cGVjdGVkLlwiLFxuICAgICk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgZGVzdHJveVN0YWNrKG9wdGlvbnM6IERlc3Ryb3lTdGFja09wdGlvbnMpIHtcbiAgICBjb25zdCBlbnYgPSBhd2FpdCB0aGlzLmVudnMuYWNjZXNzU3RhY2tGb3JNdXRhYmxlU3RhY2tPcGVyYXRpb25zKG9wdGlvbnMuc3RhY2spO1xuICAgIGNvbnN0IGV4ZWN1dGlvblJvbGVBcm4gPSBhd2FpdCBlbnYucmVwbGFjZVBsYWNlaG9sZGVycyhvcHRpb25zLnJvbGVBcm4gPz8gb3B0aW9ucy5zdGFjay5jbG91ZEZvcm1hdGlvbkV4ZWN1dGlvblJvbGVBcm4pO1xuXG4gICAgcmV0dXJuIGRlc3Ryb3lTdGFjayh7XG4gICAgICBzZGs6IGVudi5zZGssXG4gICAgICByb2xlQXJuOiBleGVjdXRpb25Sb2xlQXJuLFxuICAgICAgc3RhY2s6IG9wdGlvbnMuc3RhY2ssXG4gICAgICBkZXBsb3lOYW1lOiBvcHRpb25zLmRlcGxveU5hbWUsXG4gICAgfSwgdGhpcy5pb0hlbHBlcik7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc3RhY2tFeGlzdHMob3B0aW9uczogU3RhY2tFeGlzdHNPcHRpb25zKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbGV0IGVudjtcbiAgICBpZiAob3B0aW9ucy50cnlMb29rdXBSb2xlKSB7XG4gICAgICBlbnYgPSBhd2FpdCB0aGlzLmVudnMuYWNjZXNzU3RhY2tGb3JMb29rdXBCZXN0RWZmb3J0KG9wdGlvbnMuc3RhY2spO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbnYgPSBhd2FpdCB0aGlzLmVudnMuYWNjZXNzU3RhY2tGb3JSZWFkT25seVN0YWNrT3BlcmF0aW9ucyhvcHRpb25zLnN0YWNrKTtcbiAgICB9XG4gICAgY29uc3Qgc3RhY2sgPSBhd2FpdCBDbG91ZEZvcm1hdGlvblN0YWNrLmxvb2t1cChlbnYuc2RrLmNsb3VkRm9ybWF0aW9uKCksIG9wdGlvbnMuZGVwbG95TmFtZSA/PyBvcHRpb25zLnN0YWNrLnN0YWNrTmFtZSk7XG4gICAgcmV0dXJuIHN0YWNrLmV4aXN0cztcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZCBhIHNpbmdsZSBhc3NldCBmcm9tIGFuIGFzc2V0IG1hbmlmZXN0XG4gICAqXG4gICAqIElmIGFuIGFzc2VydCBtYW5pZmVzdCBhcnRpZmFjdCBpcyBnaXZlbiwgdGhlIGJvb3RzdHJhcCBzdGFjayB2ZXJzaW9uXG4gICAqIHdpbGwgYmUgdmFsaWRhdGVkIGFjY29yZGluZyB0byB0aGUgY29uc3RyYWludHMgaW4gdGhhdCBtYW5pZmVzdCBhcnRpZmFjdC5cbiAgICogSWYgdGhhdCBpcyBub3QgbmVjZXNzYXJ5LCBgJ25vLXZlcnNpb24tdmFsaWRhdGlvbidgIGNhbiBiZSBwYXNzZWQuXG4gICAqL1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxlblxuICBwdWJsaWMgYXN5bmMgYnVpbGRTaW5nbGVBc3NldChcbiAgICBhc3NldEFydGlmYWN0OiBjeGFwaS5Bc3NldE1hbmlmZXN0QXJ0aWZhY3QgfCAnbm8tdmVyc2lvbi12YWxpZGF0aW9uJyxcbiAgICBhc3NldE1hbmlmZXN0OiBjZGtfYXNzZXRzLkFzc2V0TWFuaWZlc3QsXG4gICAgYXNzZXQ6IGNka19hc3NldHMuSU1hbmlmZXN0RW50cnksXG4gICAgb3B0aW9uczogQnVpbGRTdGFja0Fzc2V0c09wdGlvbnMsXG4gICkge1xuICAgIGlmIChhc3NldEFydGlmYWN0ICE9PSAnbm8tdmVyc2lvbi12YWxpZGF0aW9uJykge1xuICAgICAgY29uc3QgZW52ID0gYXdhaXQgdGhpcy5lbnZzLmFjY2Vzc1N0YWNrRm9yUmVhZE9ubHlTdGFja09wZXJhdGlvbnMob3B0aW9ucy5zdGFjayk7XG4gICAgICBhd2FpdCB0aGlzLnZhbGlkYXRlQm9vdHN0cmFwU3RhY2tWZXJzaW9uKFxuICAgICAgICBvcHRpb25zLnN0YWNrLnN0YWNrTmFtZSxcbiAgICAgICAgYXNzZXRBcnRpZmFjdC5yZXF1aXJlc0Jvb3RzdHJhcFN0YWNrVmVyc2lvbixcbiAgICAgICAgYXNzZXRBcnRpZmFjdC5ib290c3RyYXBTdGFja1ZlcnNpb25Tc21QYXJhbWV0ZXIsXG4gICAgICAgIGVudi5yZXNvdXJjZXMpO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkRW52aXJvbm1lbnQgPSBhd2FpdCB0aGlzLmVudnMucmVzb2x2ZVN0YWNrRW52aXJvbm1lbnQob3B0aW9ucy5zdGFjayk7XG5cbiAgICBjb25zdCBwdWJsaXNoZXIgPSB0aGlzLmNhY2hlZFB1Ymxpc2hlcihhc3NldE1hbmlmZXN0LCByZXNvbHZlZEVudmlyb25tZW50LCBvcHRpb25zLnN0YWNrTmFtZSk7XG4gICAgYXdhaXQgcHVibGlzaGVyLmJ1aWxkRW50cnkoYXNzZXQpO1xuICAgIGlmIChwdWJsaXNoZXIuaGFzRmFpbHVyZXMpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYEZhaWxlZCB0byBidWlsZCBhc3NldCAke2Fzc2V0LmRpc3BsYXlOYW1lKGZhbHNlKX1gKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVibGlzaCBhIHNpbmdsZSBhc3NldCBmcm9tIGFuIGFzc2V0IG1hbmlmZXN0XG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcHVibGlzaFNpbmdsZUFzc2V0KFxuICAgIGFzc2V0TWFuaWZlc3Q6IGNka19hc3NldHMuQXNzZXRNYW5pZmVzdCxcbiAgICBhc3NldDogY2RrX2Fzc2V0cy5JTWFuaWZlc3RFbnRyeSxcbiAgICBvcHRpb25zOiBQdWJsaXNoU3RhY2tBc3NldHNPcHRpb25zLFxuICApIHtcbiAgICBjb25zdCBzdGFja0VudiA9IGF3YWl0IHRoaXMuZW52cy5yZXNvbHZlU3RhY2tFbnZpcm9ubWVudChvcHRpb25zLnN0YWNrKTtcblxuICAgIC8vIE5vIG5lZWQgdG8gdmFsaWRhdGUgYW55bW9yZSwgd2UgYWxyZWFkeSBkaWQgdGhhdCBkdXJpbmcgYnVpbGRcbiAgICBjb25zdCBwdWJsaXNoZXIgPSB0aGlzLmNhY2hlZFB1Ymxpc2hlcihhc3NldE1hbmlmZXN0LCBzdGFja0Vudiwgb3B0aW9ucy5zdGFja05hbWUpO1xuICAgIGF3YWl0IHB1Ymxpc2hlci5wdWJsaXNoRW50cnkoYXNzZXQsIHtcbiAgICAgIGFsbG93Q3Jvc3NBY2NvdW50OiBhd2FpdCB0aGlzLmFsbG93Q3Jvc3NBY2NvdW50QXNzZXRQdWJsaXNoaW5nRm9yRW52KG9wdGlvbnMuc3RhY2spLFxuICAgICAgZm9yY2U6IG9wdGlvbnMuZm9yY2VQdWJsaXNoLFxuICAgIH0pO1xuICAgIGlmIChwdWJsaXNoZXIuaGFzRmFpbHVyZXMpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYEZhaWxlZCB0byBwdWJsaXNoIGFzc2V0ICR7YXNzZXQuZGlzcGxheU5hbWUodHJ1ZSl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhbGxvd0Nyb3NzQWNjb3VudEFzc2V0UHVibGlzaGluZ0ZvckVudihzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKHRoaXMuX2FsbG93Q3Jvc3NBY2NvdW50QXNzZXRQdWJsaXNoaW5nID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGVudiA9IGF3YWl0IHRoaXMuZW52cy5hY2Nlc3NTdGFja0ZvclJlYWRPbmx5U3RhY2tPcGVyYXRpb25zKHN0YWNrKTtcbiAgICAgIHRoaXMuX2FsbG93Q3Jvc3NBY2NvdW50QXNzZXRQdWJsaXNoaW5nID0gYXdhaXQgZGV0ZXJtaW5lQWxsb3dDcm9zc0FjY291bnRBc3NldFB1Ymxpc2hpbmcoZW52LnNkaywgdGhpcy5pb0hlbHBlciwgdGhpcy5wcm9wcy50b29sa2l0U3RhY2tOYW1lKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2FsbG93Q3Jvc3NBY2NvdW50QXNzZXRQdWJsaXNoaW5nO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiB3aGV0aGVyIGEgc2luZ2xlIGFzc2V0IGhhcyBiZWVuIHB1Ymxpc2hlZCBhbHJlYWR5XG4gICAqL1xuICBwdWJsaWMgYXN5bmMgaXNTaW5nbGVBc3NldFB1Ymxpc2hlZChcbiAgICBhc3NldE1hbmlmZXN0OiBjZGtfYXNzZXRzLkFzc2V0TWFuaWZlc3QsXG4gICAgYXNzZXQ6IGNka19hc3NldHMuSU1hbmlmZXN0RW50cnksXG4gICAgb3B0aW9uczogUHVibGlzaFN0YWNrQXNzZXRzT3B0aW9ucyxcbiAgKSB7XG4gICAgY29uc3Qgc3RhY2tFbnYgPSBhd2FpdCB0aGlzLmVudnMucmVzb2x2ZVN0YWNrRW52aXJvbm1lbnQob3B0aW9ucy5zdGFjayk7XG4gICAgY29uc3QgcHVibGlzaGVyID0gdGhpcy5jYWNoZWRQdWJsaXNoZXIoYXNzZXRNYW5pZmVzdCwgc3RhY2tFbnYsIG9wdGlvbnMuc3RhY2tOYW1lKTtcbiAgICByZXR1cm4gcHVibGlzaGVyLmlzRW50cnlQdWJsaXNoZWQoYXNzZXQpO1xuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlIHRoYXQgdGhlIGJvb3RzdHJhcCBzdGFjayBoYXMgdGhlIHJpZ2h0IHZlcnNpb24gZm9yIHRoaXMgc3RhY2tcbiAgICpcbiAgICogQ2FsbCBpbnRvIGVudlJlc291cmNlcy52YWxpZGF0ZVZlcnNpb24sIGJ1dCBwcmVwZW5kIHRoZSBzdGFjayBuYW1lIGluIGNhc2Ugb2YgZmFpbHVyZS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdmFsaWRhdGVCb290c3RyYXBTdGFja1ZlcnNpb24oXG4gICAgc3RhY2tOYW1lOiBzdHJpbmcsXG4gICAgcmVxdWlyZXNCb290c3RyYXBTdGFja1ZlcnNpb246IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBib290c3RyYXBTdGFja1ZlcnNpb25Tc21QYXJhbWV0ZXI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICBlbnZSZXNvdXJjZXM6IEVudmlyb25tZW50UmVzb3VyY2VzLFxuICApIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZW52UmVzb3VyY2VzLnZhbGlkYXRlVmVyc2lvbihyZXF1aXJlc0Jvb3RzdHJhcFN0YWNrVmVyc2lvbiwgYm9vdHN0cmFwU3RhY2tWZXJzaW9uU3NtUGFyYW1ldGVyKTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYCR7c3RhY2tOYW1lfTogJHtmb3JtYXRFcnJvck1lc3NhZ2UoZSl9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBjYWNoZWRQdWJsaXNoZXIoYXNzZXRNYW5pZmVzdDogY2RrX2Fzc2V0cy5Bc3NldE1hbmlmZXN0LCBlbnY6IGN4YXBpLkVudmlyb25tZW50LCBzdGFja05hbWU/OiBzdHJpbmcpIHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucHVibGlzaGVyQ2FjaGUuZ2V0KGFzc2V0TWFuaWZlc3QpO1xuICAgIGlmIChleGlzdGluZykge1xuICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgIH1cbiAgICBjb25zdCBwcmVmaXggPSBzdGFja05hbWUgPyBgJHtjaGFsay5ib2xkKHN0YWNrTmFtZSl9OiBgIDogJyc7XG4gICAgY29uc3QgcHVibGlzaGVyID0gbmV3IGNka19hc3NldHMuQXNzZXRQdWJsaXNoaW5nKGFzc2V0TWFuaWZlc3QsIHtcbiAgICAgIC8vIFRoZSBBc3NldFB1Ymxpc2hpbmcgY2xhc3MgdGFrZXMgY2FyZSBvZiByb2xlIGFzc3VtaW5nIGV0Yywgc28gaXQncyBva2F5IHRvXG4gICAgICAvLyBnaXZlIGl0IGEgZGlyZWN0IGBTZGtQcm92aWRlcmAuXG4gICAgICBhd3M6IG5ldyBQdWJsaXNoaW5nQXdzKHRoaXMuYXNzZXRTZGtQcm92aWRlciwgZW52KSxcbiAgICAgIHByb2dyZXNzTGlzdGVuZXI6IG5ldyBQYXJhbGxlbFNhZmVBc3NldFByb2dyZXNzKHByZWZpeCwgdGhpcy5pb0hlbHBlciksXG4gICAgfSk7XG4gICAgdGhpcy5wdWJsaXNoZXJDYWNoZS5zZXQoYXNzZXRNYW5pZmVzdCwgcHVibGlzaGVyKTtcbiAgICByZXR1cm4gcHVibGlzaGVyO1xuICB9XG59XG5cbi8qKlxuICogQXNzZXQgcHJvZ3Jlc3MgdGhhdCBkb2Vzbid0IGRvIGFueXRoaW5nIHdpdGggcGVyY2VudGFnZXMgKGN1cnJlbnRseSlcbiAqL1xuY2xhc3MgUGFyYWxsZWxTYWZlQXNzZXRQcm9ncmVzcyBleHRlbmRzIEJhc2VQdWJsaXNoUHJvZ3Jlc3NMaXN0ZW5lciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJlZml4OiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IocHJlZml4OiBzdHJpbmcsIGlvSGVscGVyOiBJb0hlbHBlcikge1xuICAgIHN1cGVyKGlvSGVscGVyKTtcbiAgICB0aGlzLnByZWZpeCA9IHByZWZpeDtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRNZXNzYWdlKHR5cGU6IGNka19hc3NldHMuRXZlbnRUeXBlLCBldmVudDogY2RrX2Fzc2V0cy5JUHVibGlzaFByb2dyZXNzKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5wcmVmaXh9JHt0eXBlfTogJHtldmVudC5tZXNzYWdlfWA7XG4gIH1cbn1cblxuZnVuY3Rpb24gc3VmZml4V2l0aEVycm9ycyhtc2c6IHN0cmluZywgZXJyb3JzPzogc3RyaW5nW10pIHtcbiAgcmV0dXJuIGVycm9ycyAmJiBlcnJvcnMubGVuZ3RoID4gMCA/IGAke21zZ306ICR7ZXJyb3JzLmpvaW4oJywgJyl9YCA6IG1zZztcbn1cbiJdfQ==