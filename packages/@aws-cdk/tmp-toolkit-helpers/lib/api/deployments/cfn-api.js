"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParameterValues = exports.TemplateParameters = void 0;
exports.waitForChangeSet = waitForChangeSet;
exports.createDiffChangeSet = createDiffChangeSet;
exports.uploadStackTemplateAssets = uploadStackTemplateAssets;
exports.createChangeSet = createChangeSet;
exports.changeSetHasNoChanges = changeSetHasNoChanges;
exports.waitForStackDelete = waitForStackDelete;
exports.waitForStackDeploy = waitForStackDeploy;
exports.stabilizeStack = stabilizeStack;
exports.detectStackDrift = detectStackDrift;
const util_1 = require("util");
const cxapi = require("@aws-cdk/cx-api");
const cx_api_1 = require("@aws-cdk/cx-api");
const client_cloudformation_1 = require("@aws-sdk/client-cloudformation");
const cdk_assets_1 = require("cdk-assets");
const asset_manifest_builder_1 = require("./asset-manifest-builder");
const cloudformation_1 = require("../cloudformation");
const private_1 = require("../io/private");
const toolkit_error_1 = require("../toolkit-error");
/**
 * Describe a changeset in CloudFormation, regardless of its current state.
 *
 * @param cfn           a CloudFormation client
 * @param stackName     the name of the Stack the ChangeSet belongs to
 * @param changeSetName the name of the ChangeSet
 * @param fetchAll      if true, fetches all pages of the change set description.
 *
 * @returns       CloudFormation information about the ChangeSet
 */
async function describeChangeSet(cfn, stackName, changeSetName, { fetchAll }) {
    const response = await cfn.describeChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
    });
    // If fetchAll is true, traverse all pages from the change set description.
    while (fetchAll && response.NextToken != null) {
        const nextPage = await cfn.describeChangeSet({
            StackName: stackName,
            ChangeSetName: response.ChangeSetId ?? changeSetName,
            NextToken: response.NextToken,
        });
        // Consolidate the changes
        if (nextPage.Changes != null) {
            response.Changes = response.Changes != null ? response.Changes.concat(nextPage.Changes) : nextPage.Changes;
        }
        // Forward the new NextToken
        response.NextToken = nextPage.NextToken;
    }
    return response;
}
/**
 * Waits for a function to return non-+undefined+ before returning.
 *
 * @param valueProvider a function that will return a value that is not +undefined+ once the wait should be over
 * @param timeout     the time to wait between two calls to +valueProvider+
 *
 * @returns       the value that was returned by +valueProvider+
 */
async function waitFor(valueProvider, timeout = 5000) {
    while (true) {
        const result = await valueProvider();
        if (result === null) {
            return undefined;
        }
        else if (result !== undefined) {
            return result;
        }
        await new Promise((cb) => setTimeout(cb, timeout));
    }
}
/**
 * Waits for a ChangeSet to be available for triggering a StackUpdate.
 *
 * Will return a changeset that is either ready to be executed or has no changes.
 * Will throw in other cases.
 *
 * @param cfn           a CloudFormation client
 * @param stackName     the name of the Stack that the ChangeSet belongs to
 * @param changeSetName the name of the ChangeSet
 * @param fetchAll      if true, fetches all pages of the ChangeSet before returning.
 *
 * @returns       the CloudFormation description of the ChangeSet
 */
async function waitForChangeSet(cfn, ioHelper, stackName, changeSetName, { fetchAll }) {
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Waiting for changeset %s on stack %s to finish creating...', changeSetName, stackName)));
    const ret = await waitFor(async () => {
        const description = await describeChangeSet(cfn, stackName, changeSetName, {
            fetchAll,
        });
        // The following doesn't use a switch because tsc will not allow fall-through, UNLESS it is allows
        // EVERYWHERE that uses this library directly or indirectly, which is undesirable.
        if (description.Status === 'CREATE_PENDING' || description.Status === 'CREATE_IN_PROGRESS') {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Changeset %s on stack %s is still creating', changeSetName, stackName)));
            return undefined;
        }
        if (description.Status === client_cloudformation_1.ChangeSetStatus.CREATE_COMPLETE || changeSetHasNoChanges(description)) {
            return description;
        }
        // eslint-disable-next-line max-len
        throw new toolkit_error_1.ToolkitError(`Failed to create ChangeSet ${changeSetName} on ${stackName}: ${description.Status || 'NO_STATUS'}, ${description.StatusReason || 'no reason provided'}`);
    });
    if (!ret) {
        throw new toolkit_error_1.ToolkitError('Change set took too long to be created; aborting');
    }
    return ret;
}
/**
 * Create a changeset for a diff operation
 */
async function createDiffChangeSet(ioHelper, options) {
    // `options.stack` has been modified to include any nested stack templates directly inline with its own template, under a special `NestedTemplate` property.
    // Thus the parent template's Resources section contains the nested template's CDK metadata check, which uses Fn::Equals.
    // This causes CreateChangeSet to fail with `Template Error: Fn::Equals cannot be partially collapsed`.
    for (const resource of Object.values(options.stack.template.Resources ?? {})) {
        if (resource.Type === 'AWS::CloudFormation::Stack') {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg('This stack contains one or more nested stacks, falling back to template-only diff...'));
            return undefined;
        }
    }
    return uploadBodyParameterAndCreateChangeSet(ioHelper, options);
}
/**
 * Returns all file entries from an AssetManifestArtifact that look like templates.
 *
 * This is used in the `uploadBodyParameterAndCreateChangeSet` function to find
 * all template asset files to build and publish.
 *
 * Returns a tuple of [AssetManifest, FileManifestEntry[]]
 */
function templatesFromAssetManifestArtifact(artifact) {
    const assets = [];
    const fileName = artifact.file;
    const assetManifest = cdk_assets_1.AssetManifest.fromFile(fileName);
    assetManifest.entries.forEach((entry) => {
        if (entry.type === 'file') {
            const source = entry.source;
            if (source.path && source.path.endsWith('.template.json')) {
                assets.push(entry);
            }
        }
    });
    return [assetManifest, assets];
}
async function uploadBodyParameterAndCreateChangeSet(ioHelper, options) {
    try {
        await uploadStackTemplateAssets(options.stack, options.deployments);
        const env = await options.deployments.envs.accessStackForMutableStackOperations(options.stack);
        const bodyParameter = await (0, cloudformation_1.makeBodyParameter)(ioHelper, options.stack, env.resolvedEnvironment, new asset_manifest_builder_1.AssetManifestBuilder(), env.resources);
        const cfn = env.sdk.cloudFormation();
        const exists = (await cloudformation_1.CloudFormationStack.lookup(cfn, options.stack.stackName, false)).exists;
        const executionRoleArn = await env.replacePlaceholders(options.stack.cloudFormationExecutionRoleArn);
        await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg('Hold on while we create a read-only change set to get a diff with accurate replacement information (use --no-change-set to use a less accurate but faster template-only diff)\n'));
        return await createChangeSet(ioHelper, {
            cfn,
            changeSetName: 'cdk-diff-change-set',
            stack: options.stack,
            exists,
            uuid: options.uuid,
            willExecute: options.willExecute,
            bodyParameter,
            parameters: options.parameters,
            resourcesToImport: options.resourcesToImport,
            role: executionRoleArn,
        });
    }
    catch (e) {
        // This function is currently only used by diff so these messages are diff-specific
        if (!options.failOnError) {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(String(e)));
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg('Could not create a change set, will base the diff on template differences (run again with -v to see the reason)\n'));
            return undefined;
        }
        throw new toolkit_error_1.ToolkitError('Could not create a change set and failOnError is set. (run again with failOnError off to base the diff on template differences)\n', e);
    }
}
/**
 * Uploads the assets that look like templates for this CloudFormation stack
 *
 * This is necessary for any CloudFormation call that needs the template, it may need
 * to be uploaded to an S3 bucket first. We have to follow the instructions in the
 * asset manifest, because technically that is the only place that knows about
 * bucket and assumed roles and such.
 */
async function uploadStackTemplateAssets(stack, deployments) {
    for (const artifact of stack.dependencies) {
        // Skip artifact if it is not an Asset Manifest Artifact
        if (!cxapi.AssetManifestArtifact.isAssetManifestArtifact(artifact)) {
            continue;
        }
        const [assetManifest, file_entries] = templatesFromAssetManifestArtifact(artifact);
        for (const entry of file_entries) {
            await deployments.buildSingleAsset(artifact, assetManifest, entry, {
                stack,
            });
            await deployments.publishSingleAsset(assetManifest, entry, {
                stack,
            });
        }
    }
}
async function createChangeSet(ioHelper, options) {
    await cleanupOldChangeset(options.cfn, ioHelper, options.changeSetName, options.stack.stackName);
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Attempting to create ChangeSet with name ${options.changeSetName} for stack ${options.stack.stackName}`));
    const templateParams = TemplateParameters.fromTemplate(options.stack.template);
    const stackParams = templateParams.supplyAll(options.parameters);
    const changeSet = await options.cfn.createChangeSet({
        StackName: options.stack.stackName,
        ChangeSetName: options.changeSetName,
        ChangeSetType: options.resourcesToImport ? 'IMPORT' : options.exists ? 'UPDATE' : 'CREATE',
        Description: `CDK Changeset for diff ${options.uuid}`,
        ClientToken: `diff${options.uuid}`,
        TemplateURL: options.bodyParameter.TemplateURL,
        TemplateBody: options.bodyParameter.TemplateBody,
        Parameters: stackParams.apiParameters,
        ResourcesToImport: options.resourcesToImport,
        RoleARN: options.role,
        Tags: toCfnTags(options.stack.tags),
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
    });
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Initiated creation of changeset: %s; waiting for it to finish creating...', changeSet.Id)));
    // Fetching all pages if we'll execute, so we can have the correct change count when monitoring.
    const createdChangeSet = await waitForChangeSet(options.cfn, ioHelper, options.stack.stackName, options.changeSetName, {
        fetchAll: options.willExecute,
    });
    await cleanupOldChangeset(options.cfn, ioHelper, options.changeSetName, options.stack.stackName);
    return createdChangeSet;
}
function toCfnTags(tags) {
    return Object.entries(tags).map(([k, v]) => ({
        Key: k,
        Value: v,
    }));
}
async function cleanupOldChangeset(cfn, ioHelper, changeSetName, stackName) {
    // Delete any existing change sets generated by CDK since change set names must be unique.
    // The delete request is successful as long as the stack exists (even if the change set does not exist).
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg(`Removing existing change set with name ${changeSetName} if it exists`));
    await cfn.deleteChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
    });
}
/**
 * Return true if the given change set has no changes
 *
 * This must be determined from the status, not the 'Changes' array on the
 * object; the latter can be empty because no resources were changed, but if
 * there are changes to Outputs, the change set can still be executed.
 */
function changeSetHasNoChanges(description) {
    const noChangeErrorPrefixes = [
        // Error message for a regular template
        "The submitted information didn't contain changes.",
        // Error message when a Transform is involved (see #10650)
        'No updates are to be performed.',
    ];
    return (description.Status === 'FAILED' && noChangeErrorPrefixes.some((p) => (description.StatusReason ?? '').startsWith(p)));
}
/**
 * Waits for a CloudFormation stack to stabilize in a complete/available state
 * after a delete operation is issued.
 *
 * Fails if the stack is in a FAILED state. Will not fail if the stack was
 * already deleted.
 *
 * @param cfn        a CloudFormation client
 * @param stackName      the name of the stack to wait for after a delete
 *
 * @returns     the CloudFormation description of the stabilized stack after the delete attempt
 */
async function waitForStackDelete(cfn, ioHelper, stackName) {
    const stack = await stabilizeStack(cfn, ioHelper, stackName);
    if (!stack) {
        return undefined;
    }
    const status = stack.stackStatus;
    if (status.isFailure) {
        throw new toolkit_error_1.ToolkitError(`The stack named ${stackName} is in a failed state. You may need to delete it from the AWS console : ${status}`);
    }
    else if (status.isDeleted) {
        return undefined;
    }
    return stack;
}
/**
 * Waits for a CloudFormation stack to stabilize in a complete/available state
 * after an update/create operation is issued.
 *
 * Fails if the stack is in a FAILED state, ROLLBACK state, or DELETED state.
 *
 * @param cfn        a CloudFormation client
 * @param stackName      the name of the stack to wait for after an update
 *
 * @returns     the CloudFormation description of the stabilized stack after the update attempt
 */
async function waitForStackDeploy(cfn, ioHelper, stackName) {
    const stack = await stabilizeStack(cfn, ioHelper, stackName);
    if (!stack) {
        return undefined;
    }
    const status = stack.stackStatus;
    if (status.isCreationFailure) {
        throw new toolkit_error_1.ToolkitError(`The stack named ${stackName} failed creation, it may need to be manually deleted from the AWS console: ${status}`);
    }
    else if (!status.isDeploySuccess) {
        throw new toolkit_error_1.ToolkitError(`The stack named ${stackName} failed to deploy: ${status}`);
    }
    return stack;
}
/**
 * Wait for a stack to become stable (no longer _IN_PROGRESS), returning it
 */
async function stabilizeStack(cfn, ioHelper, stackName) {
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Waiting for stack %s to finish creating or updating...', stackName)));
    return waitFor(async () => {
        const stack = await cloudformation_1.CloudFormationStack.lookup(cfn, stackName);
        if (!stack.exists) {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Stack %s does not exist', stackName)));
            return null;
        }
        const status = stack.stackStatus;
        if (status.isInProgress) {
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Stack %s has an ongoing operation in progress and is not stable (%s)', stackName, status)));
            return undefined;
        }
        else if (status.isReviewInProgress) {
            // This may happen if a stack creation operation is interrupted before the ChangeSet execution starts. Recovering
            // from this would requiring manual intervention (deleting or executing the pending ChangeSet), and failing to do
            // so will result in an endless wait here (the ChangeSet wont delete or execute itself). Instead of blocking
            // "forever" we proceed as if the stack was existing and stable. If there is a concurrent operation that just
            // hasn't finished proceeding just yet, either this operation or the concurrent one may fail due to the other one
            // having made progress. Which is fine. I guess.
            await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Stack %s is in REVIEW_IN_PROGRESS state. Considering this is a stable status (%s)', stackName, status)));
        }
        return stack;
    });
}
/**
 * Detect drift for a CloudFormation stack and wait for the detection to complete
 *
 * @param cfn        a CloudFormation client
 * @param ioHelper   helper for IO operations
 * @param stackName  the name of the stack to check for drift
 *
 * @returns     the CloudFormation description of the drift detection results
 */
async function detectStackDrift(cfn, ioHelper, stackName) {
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Starting drift detection for stack %s...', stackName)));
    // Start drift detection
    const driftDetection = await cfn.detectStackDrift({
        StackName: stackName,
    });
    // Wait for drift detection to complete
    const driftStatus = await waitForDriftDetection(cfn, ioHelper, driftDetection.StackDriftDetectionId);
    if (!driftStatus) {
        throw new toolkit_error_1.ToolkitError('Drift detection took too long to complete. Aborting');
    }
    if (driftStatus?.DetectionStatus === 'DETECTION_FAILED') {
        throw new toolkit_error_1.ToolkitError(`Failed to detect drift for stack ${stackName}: ${driftStatus.DetectionStatusReason || 'No reason provided'}`);
    }
    // Get the drift results
    return cfn.describeStackResourceDrifts({
        StackName: stackName,
    });
}
/**
 * Wait for a drift detection operation to complete
 */
async function waitForDriftDetection(cfn, ioHelper, driftDetectionId) {
    await ioHelper.notify(private_1.IO.DEFAULT_TOOLKIT_DEBUG.msg((0, util_1.format)('Waiting for drift detection %s to complete...', driftDetectionId)));
    const maxDelay = 30_000; // 30 seconds max delay
    let baseDelay = 1_000; // Start with 1 second
    let attempts = 0;
    while (true) {
        const response = await cfn.describeStackDriftDetectionStatus({
            StackDriftDetectionId: driftDetectionId,
        });
        if (response.DetectionStatus === 'DETECTION_COMPLETE') {
            return response;
        }
        if (response.DetectionStatus === 'DETECTION_FAILED') {
            throw new toolkit_error_1.ToolkitError(`Drift detection failed: ${response.DetectionStatusReason}`);
        }
        if (attempts++ > 30) {
            throw new toolkit_error_1.ToolkitError('Drift detection timed out after 30 attempts');
        }
        // Calculate backoff with jitter
        const jitter = Math.random() * 1000;
        const delay = Math.min(baseDelay + jitter, maxDelay);
        await new Promise(resolve => setTimeout(resolve, delay));
        baseDelay *= 2;
        attempts++;
    }
}
/**
 * The set of (formal) parameters that have been declared in a template
 */
class TemplateParameters {
    params;
    static fromTemplate(template) {
        return new TemplateParameters(template.Parameters || {});
    }
    constructor(params) {
        this.params = params;
    }
    /**
     * Calculate stack parameters to pass from the given desired parameter values
     *
     * Will throw if parameters without a Default value or a Previous value are not
     * supplied.
     */
    supplyAll(updates) {
        return new ParameterValues(this.params, updates);
    }
    /**
     * From the template, the given desired values and the current values, calculate the changes to the stack parameters
     *
     * Will take into account parameters already set on the template (will emit
     * 'UsePreviousValue: true' for those unless the value is changed), and will
     * throw if parameters without a Default value or a Previous value are not
     * supplied.
     */
    updateExisting(updates, previousValues) {
        return new ParameterValues(this.params, updates, previousValues);
    }
}
exports.TemplateParameters = TemplateParameters;
/**
 * The set of parameters we're going to pass to a Stack
 */
class ParameterValues {
    formalParams;
    values = {};
    apiParameters = [];
    constructor(formalParams, updates, previousValues = {}) {
        this.formalParams = formalParams;
        const missingRequired = new Array();
        for (const [key, formalParam] of Object.entries(this.formalParams)) {
            // Check updates first, then use the previous value (if available), then use
            // the default (if available).
            //
            // If we don't find a parameter value using any of these methods, then that's an error.
            const updatedValue = updates[key];
            if (updatedValue !== undefined) {
                this.values[key] = updatedValue;
                this.apiParameters.push({
                    ParameterKey: key,
                    ParameterValue: updates[key],
                });
                continue;
            }
            if (key in previousValues) {
                this.values[key] = previousValues[key];
                this.apiParameters.push({ ParameterKey: key, UsePreviousValue: true });
                continue;
            }
            if (formalParam.Default !== undefined) {
                this.values[key] = formalParam.Default;
                continue;
            }
            // Oh no
            missingRequired.push(key);
        }
        if (missingRequired.length > 0) {
            throw new toolkit_error_1.ToolkitError(`The following CloudFormation Parameters are missing a value: ${missingRequired.join(', ')}`);
        }
        // Just append all supplied overrides that aren't really expected (this
        // will fail CFN but maybe people made typos that they want to be notified
        // of)
        const unknownParam = ([key, _]) => this.formalParams[key] === undefined;
        const hasValue = ([_, value]) => !!value;
        for (const [key, value] of Object.entries(updates).filter(unknownParam).filter(hasValue)) {
            this.values[key] = value;
            this.apiParameters.push({ ParameterKey: key, ParameterValue: value });
        }
    }
    /**
     * Whether this set of parameter updates will change the actual stack values
     */
    hasChanges(currentValues) {
        // If any of the parameters are SSM parameters, deploying must always happen
        // because we can't predict what the values will be. We will allow some
        // parameters to opt out of this check by having a magic string in their description.
        if (Object.values(this.formalParams).some((p) => p.Type.startsWith('AWS::SSM::Parameter::') && !p.Description?.includes(cx_api_1.SSMPARAM_NO_INVALIDATE))) {
            return 'ssm';
        }
        // Otherwise we're dirty if:
        // - any of the existing values are removed, or changed
        if (Object.entries(currentValues).some(([key, value]) => !(key in this.values) || value !== this.values[key])) {
            return true;
        }
        // - any of the values we're setting are new
        if (Object.keys(this.values).some((key) => !(key in currentValues))) {
            return true;
        }
        return false;
    }
}
exports.ParameterValues = ParameterValues;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2ZuLWFwaS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvZGVwbG95bWVudHMvY2ZuLWFwaS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFzR0EsNENBa0NDO0FBbUNELGtEQWdCQztBQXNGRCw4REFpQkM7QUFFRCwwQ0FrQ0M7QUErQkQsc0RBV0M7QUFjRCxnREFtQkM7QUFhRCxnREFxQkM7QUFLRCx3Q0E0QkM7QUFXRCw0Q0E2QkM7QUE1ZkQsK0JBQThCO0FBQzlCLHlDQUF5QztBQUN6Qyw0Q0FBeUQ7QUFTekQsMEVBRXdDO0FBRXhDLDJDQUEyQztBQUMzQyxxRUFBZ0U7QUFJaEUsc0RBQTJFO0FBQzNFLDJDQUFrRDtBQUVsRCxvREFBZ0Q7QUFFaEQ7Ozs7Ozs7OztHQVNHO0FBQ0gsS0FBSyxVQUFVLGlCQUFpQixDQUM5QixHQUEwQixFQUMxQixTQUFpQixFQUNqQixhQUFxQixFQUNyQixFQUFFLFFBQVEsRUFBeUI7SUFFbkMsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLENBQUMsaUJBQWlCLENBQUM7UUFDM0MsU0FBUyxFQUFFLFNBQVM7UUFDcEIsYUFBYSxFQUFFLGFBQWE7S0FDN0IsQ0FBQyxDQUFDO0lBRUgsMkVBQTJFO0lBQzNFLE9BQU8sUUFBUSxJQUFJLFFBQVEsQ0FBQyxTQUFTLElBQUksSUFBSSxFQUFFLENBQUM7UUFDOUMsTUFBTSxRQUFRLEdBQUcsTUFBTSxHQUFHLENBQUMsaUJBQWlCLENBQUM7WUFDM0MsU0FBUyxFQUFFLFNBQVM7WUFDcEIsYUFBYSxFQUFFLFFBQVEsQ0FBQyxXQUFXLElBQUksYUFBYTtZQUNwRCxTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVM7U0FDOUIsQ0FBQyxDQUFDO1FBRUgsMEJBQTBCO1FBQzFCLElBQUksUUFBUSxDQUFDLE9BQU8sSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUM3QixRQUFRLENBQUMsT0FBTyxHQUFHLFFBQVEsQ0FBQyxPQUFPLElBQUksSUFBSSxDQUFD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dGlsJztcbmltcG9ydCAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgeyBTU01QQVJBTV9OT19JTlZBTElEQVRFIH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB0eXBlIHtcbiAgRGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0LFxuICBEZXNjcmliZVN0YWNrRHJpZnREZXRlY3Rpb25TdGF0dXNDb21tYW5kT3V0cHV0LFxuICBEZXNjcmliZVN0YWNrUmVzb3VyY2VEcmlmdHNDb21tYW5kT3V0cHV0LFxuICBQYXJhbWV0ZXIsXG4gIFJlc291cmNlVG9JbXBvcnQsXG4gIFRhZyxcbn0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uJztcbmltcG9ydCB7XG4gIENoYW5nZVNldFN0YXR1cyxcbn0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uJztcbmltcG9ydCB0eXBlIHsgRmlsZU1hbmlmZXN0RW50cnkgfSBmcm9tICdjZGstYXNzZXRzJztcbmltcG9ydCB7IEFzc2V0TWFuaWZlc3QgfSBmcm9tICdjZGstYXNzZXRzJztcbmltcG9ydCB7IEFzc2V0TWFuaWZlc3RCdWlsZGVyIH0gZnJvbSAnLi9hc3NldC1tYW5pZmVzdC1idWlsZGVyJztcbmltcG9ydCB0eXBlIHsgRGVwbG95bWVudHMgfSBmcm9tICcuL2RlcGxveW1lbnRzJztcbmltcG9ydCB0eXBlIHsgSUNsb3VkRm9ybWF0aW9uQ2xpZW50LCBTZGtQcm92aWRlciB9IGZyb20gJy4uL2F3cy1hdXRoJztcbmltcG9ydCB0eXBlIHsgVGVtcGxhdGUsIFRlbXBsYXRlQm9keVBhcmFtZXRlciwgVGVtcGxhdGVQYXJhbWV0ZXIgfSBmcm9tICcuLi9jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgeyBDbG91ZEZvcm1hdGlvblN0YWNrLCBtYWtlQm9keVBhcmFtZXRlciB9IGZyb20gJy4uL2Nsb3VkZm9ybWF0aW9uJztcbmltcG9ydCB7IElPLCB0eXBlIElvSGVscGVyIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgdHlwZSB7IFJlc291cmNlc1RvSW1wb3J0IH0gZnJvbSAnLi4vcmVzb3VyY2UtaW1wb3J0JztcbmltcG9ydCB7IFRvb2xraXRFcnJvciB9IGZyb20gJy4uL3Rvb2xraXQtZXJyb3InO1xuXG4vKipcbiAqIERlc2NyaWJlIGEgY2hhbmdlc2V0IGluIENsb3VkRm9ybWF0aW9uLCByZWdhcmRsZXNzIG9mIGl0cyBjdXJyZW50IHN0YXRlLlxuICpcbiAqIEBwYXJhbSBjZm4gICAgICAgICAgIGEgQ2xvdWRGb3JtYXRpb24gY2xpZW50XG4gKiBAcGFyYW0gc3RhY2tOYW1lICAgICB0aGUgbmFtZSBvZiB0aGUgU3RhY2sgdGhlIENoYW5nZVNldCBiZWxvbmdzIHRvXG4gKiBAcGFyYW0gY2hhbmdlU2V0TmFtZSB0aGUgbmFtZSBvZiB0aGUgQ2hhbmdlU2V0XG4gKiBAcGFyYW0gZmV0Y2hBbGwgICAgICBpZiB0cnVlLCBmZXRjaGVzIGFsbCBwYWdlcyBvZiB0aGUgY2hhbmdlIHNldCBkZXNjcmlwdGlvbi5cbiAqXG4gKiBAcmV0dXJucyAgICAgICBDbG91ZEZvcm1hdGlvbiBpbmZvcm1hdGlvbiBhYm91dCB0aGUgQ2hhbmdlU2V0XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGRlc2NyaWJlQ2hhbmdlU2V0KFxuICBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgc3RhY2tOYW1lOiBzdHJpbmcsXG4gIGNoYW5nZVNldE5hbWU6IHN0cmluZyxcbiAgeyBmZXRjaEFsbCB9OiB7IGZldGNoQWxsOiBib29sZWFuIH0sXG4pOiBQcm9taXNlPERlc2NyaWJlQ2hhbmdlU2V0Q29tbWFuZE91dHB1dD4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNmbi5kZXNjcmliZUNoYW5nZVNldCh7XG4gICAgU3RhY2tOYW1lOiBzdGFja05hbWUsXG4gICAgQ2hhbmdlU2V0TmFtZTogY2hhbmdlU2V0TmFtZSxcbiAgfSk7XG5cbiAgLy8gSWYgZmV0Y2hBbGwgaXMgdHJ1ZSwgdHJhdmVyc2UgYWxsIHBhZ2VzIGZyb20gdGhlIGNoYW5nZSBzZXQgZGVzY3JpcHRpb24uXG4gIHdoaWxlIChmZXRjaEFsbCAmJiByZXNwb25zZS5OZXh0VG9rZW4gIT0gbnVsbCkge1xuICAgIGNvbnN0IG5leHRQYWdlID0gYXdhaXQgY2ZuLmRlc2NyaWJlQ2hhbmdlU2V0KHtcbiAgICAgIFN0YWNrTmFtZTogc3RhY2tOYW1lLFxuICAgICAgQ2hhbmdlU2V0TmFtZTogcmVzcG9uc2UuQ2hhbmdlU2V0SWQgPz8gY2hhbmdlU2V0TmFtZSxcbiAgICAgIE5leHRUb2tlbjogcmVzcG9uc2UuTmV4dFRva2VuLFxuICAgIH0pO1xuXG4gICAgLy8gQ29uc29saWRhdGUgdGhlIGNoYW5nZXNcbiAgICBpZiAobmV4dFBhZ2UuQ2hhbmdlcyAhPSBudWxsKSB7XG4gICAgICByZXNwb25zZS5DaGFuZ2VzID0gcmVzcG9uc2UuQ2hhbmdlcyAhPSBudWxsID8gcmVzcG9uc2UuQ2hhbmdlcy5jb25jYXQobmV4dFBhZ2UuQ2hhbmdlcykgOiBuZXh0UGFnZS5DaGFuZ2VzO1xuICAgIH1cblxuICAgIC8vIEZvcndhcmQgdGhlIG5ldyBOZXh0VG9rZW5cbiAgICByZXNwb25zZS5OZXh0VG9rZW4gPSBuZXh0UGFnZS5OZXh0VG9rZW47XG4gIH1cblxuICByZXR1cm4gcmVzcG9uc2U7XG59XG5cbi8qKlxuICogV2FpdHMgZm9yIGEgZnVuY3Rpb24gdG8gcmV0dXJuIG5vbi0rdW5kZWZpbmVkKyBiZWZvcmUgcmV0dXJuaW5nLlxuICpcbiAqIEBwYXJhbSB2YWx1ZVByb3ZpZGVyIGEgZnVuY3Rpb24gdGhhdCB3aWxsIHJldHVybiBhIHZhbHVlIHRoYXQgaXMgbm90ICt1bmRlZmluZWQrIG9uY2UgdGhlIHdhaXQgc2hvdWxkIGJlIG92ZXJcbiAqIEBwYXJhbSB0aW1lb3V0ICAgICB0aGUgdGltZSB0byB3YWl0IGJldHdlZW4gdHdvIGNhbGxzIHRvICt2YWx1ZVByb3ZpZGVyK1xuICpcbiAqIEByZXR1cm5zICAgICAgIHRoZSB2YWx1ZSB0aGF0IHdhcyByZXR1cm5lZCBieSArdmFsdWVQcm92aWRlcitcbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvcjxUPihcbiAgdmFsdWVQcm92aWRlcjogKCkgPT4gUHJvbWlzZTxUIHwgbnVsbCB8IHVuZGVmaW5lZD4sXG4gIHRpbWVvdXQ6IG51bWJlciA9IDUwMDAsXG4pOiBQcm9taXNlPFQgfCB1bmRlZmluZWQ+IHtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2YWx1ZVByb3ZpZGVyKCk7XG4gICAgaWYgKHJlc3VsdCA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9IGVsc2UgaWYgKHJlc3VsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgoY2IpID0+IHNldFRpbWVvdXQoY2IsIHRpbWVvdXQpKTtcbiAgfVxufVxuXG4vKipcbiAqIFdhaXRzIGZvciBhIENoYW5nZVNldCB0byBiZSBhdmFpbGFibGUgZm9yIHRyaWdnZXJpbmcgYSBTdGFja1VwZGF0ZS5cbiAqXG4gKiBXaWxsIHJldHVybiBhIGNoYW5nZXNldCB0aGF0IGlzIGVpdGhlciByZWFkeSB0byBiZSBleGVjdXRlZCBvciBoYXMgbm8gY2hhbmdlcy5cbiAqIFdpbGwgdGhyb3cgaW4gb3RoZXIgY2FzZXMuXG4gKlxuICogQHBhcmFtIGNmbiAgICAgICAgICAgYSBDbG91ZEZvcm1hdGlvbiBjbGllbnRcbiAqIEBwYXJhbSBzdGFja05hbWUgICAgIHRoZSBuYW1lIG9mIHRoZSBTdGFjayB0aGF0IHRoZSBDaGFuZ2VTZXQgYmVsb25ncyB0b1xuICogQHBhcmFtIGNoYW5nZVNldE5hbWUgdGhlIG5hbWUgb2YgdGhlIENoYW5nZVNldFxuICogQHBhcmFtIGZldGNoQWxsICAgICAgaWYgdHJ1ZSwgZmV0Y2hlcyBhbGwgcGFnZXMgb2YgdGhlIENoYW5nZVNldCBiZWZvcmUgcmV0dXJuaW5nLlxuICpcbiAqIEByZXR1cm5zICAgICAgIHRoZSBDbG91ZEZvcm1hdGlvbiBkZXNjcmlwdGlvbiBvZiB0aGUgQ2hhbmdlU2V0XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yQ2hhbmdlU2V0KFxuICBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgaW9IZWxwZXI6IElvSGVscGVyLFxuICBzdGFja05hbWU6IHN0cmluZyxcbiAgY2hhbmdlU2V0TmFtZTogc3RyaW5nLFxuICB7IGZldGNoQWxsIH06IHsgZmV0Y2hBbGw6IGJvb2xlYW4gfSxcbik6IFByb21pc2U8RGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0PiB7XG4gIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGZvcm1hdCgnV2FpdGluZyBmb3IgY2hhbmdlc2V0ICVzIG9uIHN0YWNrICVzIHRvIGZpbmlzaCBjcmVhdGluZy4uLicsIGNoYW5nZVNldE5hbWUsIHN0YWNrTmFtZSkpKTtcbiAgY29uc3QgcmV0ID0gYXdhaXQgd2FpdEZvcihhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgZGVzY3JpcHRpb24gPSBhd2FpdCBkZXNjcmliZUNoYW5nZVNldChjZm4sIHN0YWNrTmFtZSwgY2hhbmdlU2V0TmFtZSwge1xuICAgICAgZmV0Y2hBbGwsXG4gICAgfSk7XG4gICAgLy8gVGhlIGZvbGxvd2luZyBkb2Vzbid0IHVzZSBhIHN3aXRjaCBiZWNhdXNlIHRzYyB3aWxsIG5vdCBhbGxvdyBmYWxsLXRocm91Z2gsIFVOTEVTUyBpdCBpcyBhbGxvd3NcbiAgICAvLyBFVkVSWVdIRVJFIHRoYXQgdXNlcyB0aGlzIGxpYnJhcnkgZGlyZWN0bHkgb3IgaW5kaXJlY3RseSwgd2hpY2ggaXMgdW5kZXNpcmFibGUuXG4gICAgaWYgKGRlc2NyaXB0aW9uLlN0YXR1cyA9PT0gJ0NSRUFURV9QRU5ESU5HJyB8fCBkZXNjcmlwdGlvbi5TdGF0dXMgPT09ICdDUkVBVEVfSU5fUFJPR1JFU1MnKSB7XG4gICAgICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhmb3JtYXQoJ0NoYW5nZXNldCAlcyBvbiBzdGFjayAlcyBpcyBzdGlsbCBjcmVhdGluZycsIGNoYW5nZVNldE5hbWUsIHN0YWNrTmFtZSkpKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgaWYgKGRlc2NyaXB0aW9uLlN0YXR1cyA9PT0gQ2hhbmdlU2V0U3RhdHVzLkNSRUFURV9DT01QTEVURSB8fCBjaGFuZ2VTZXRIYXNOb0NoYW5nZXMoZGVzY3JpcHRpb24pKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRpb247XG4gICAgfVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG1heC1sZW5cbiAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKFxuICAgICAgYEZhaWxlZCB0byBjcmVhdGUgQ2hhbmdlU2V0ICR7Y2hhbmdlU2V0TmFtZX0gb24gJHtzdGFja05hbWV9OiAke2Rlc2NyaXB0aW9uLlN0YXR1cyB8fCAnTk9fU1RBVFVTJ30sICR7ZGVzY3JpcHRpb24uU3RhdHVzUmVhc29uIHx8ICdubyByZWFzb24gcHJvdmlkZWQnfWAsXG4gICAgKTtcbiAgfSk7XG5cbiAgaWYgKCFyZXQpIHtcbiAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKCdDaGFuZ2Ugc2V0IHRvb2sgdG9vIGxvbmcgdG8gYmUgY3JlYXRlZDsgYWJvcnRpbmcnKTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59XG5cbmV4cG9ydCB0eXBlIFByZXBhcmVDaGFuZ2VTZXRPcHRpb25zID0ge1xuICBzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0O1xuICBkZXBsb3ltZW50czogRGVwbG95bWVudHM7XG4gIHV1aWQ6IHN0cmluZztcbiAgd2lsbEV4ZWN1dGU6IGJvb2xlYW47XG4gIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcjtcbiAgcGFyYW1ldGVyczogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIHwgdW5kZWZpbmVkIH07XG4gIHJlc291cmNlc1RvSW1wb3J0PzogUmVzb3VyY2VzVG9JbXBvcnQ7XG4gIC8qKlxuICAgKiBEZWZhdWx0IGJlaGF2aW9yIGlzIHRvIGxvZyBBV1MgQ2xvdWRGb3JtYXRpb24gZXJyb3JzIGFuZCBtb3ZlIG9uLiBTZXQgdGhpcyBwcm9wZXJ0eSB0byB0cnVlIHRvIGluc3RlYWRcbiAgICogZmFpbCBvbiBlcnJvcnMgcmVjZWl2ZWQgYnkgQVdTIENsb3VkRm9ybWF0aW9uLlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgZmFpbE9uRXJyb3I/OiBib29sZWFuO1xufVxuXG5leHBvcnQgdHlwZSBDcmVhdGVDaGFuZ2VTZXRPcHRpb25zID0ge1xuICBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudDtcbiAgY2hhbmdlU2V0TmFtZTogc3RyaW5nO1xuICB3aWxsRXhlY3V0ZTogYm9vbGVhbjtcbiAgZXhpc3RzOiBib29sZWFuO1xuICB1dWlkOiBzdHJpbmc7XG4gIHN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3Q7XG4gIGJvZHlQYXJhbWV0ZXI6IFRlbXBsYXRlQm9keVBhcmFtZXRlcjtcbiAgcGFyYW1ldGVyczogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIHwgdW5kZWZpbmVkIH07XG4gIHJlc291cmNlc1RvSW1wb3J0PzogUmVzb3VyY2VUb0ltcG9ydFtdO1xuICByb2xlPzogc3RyaW5nO1xufTtcblxuLyoqXG4gKiBDcmVhdGUgYSBjaGFuZ2VzZXQgZm9yIGEgZGlmZiBvcGVyYXRpb25cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZURpZmZDaGFuZ2VTZXQoXG4gIGlvSGVscGVyOiBJb0hlbHBlcixcbiAgb3B0aW9uczogUHJlcGFyZUNoYW5nZVNldE9wdGlvbnMsXG4pOiBQcm9taXNlPERlc2NyaWJlQ2hhbmdlU2V0Q29tbWFuZE91dHB1dCB8IHVuZGVmaW5lZD4ge1xuICAvLyBgb3B0aW9ucy5zdGFja2AgaGFzIGJlZW4gbW9kaWZpZWQgdG8gaW5jbHVkZSBhbnkgbmVzdGVkIHN0YWNrIHRlbXBsYXRlcyBkaXJlY3RseSBpbmxpbmUgd2l0aCBpdHMgb3duIHRlbXBsYXRlLCB1bmRlciBhIHNwZWNpYWwgYE5lc3RlZFRlbXBsYXRlYCBwcm9wZXJ0eS5cbiAgLy8gVGh1cyB0aGUgcGFyZW50IHRlbXBsYXRlJ3MgUmVzb3VyY2VzIHNlY3Rpb24gY29udGFpbnMgdGhlIG5lc3RlZCB0ZW1wbGF0ZSdzIENESyBtZXRhZGF0YSBjaGVjaywgd2hpY2ggdXNlcyBGbjo6RXF1YWxzLlxuICAvLyBUaGlzIGNhdXNlcyBDcmVhdGVDaGFuZ2VTZXQgdG8gZmFpbCB3aXRoIGBUZW1wbGF0ZSBFcnJvcjogRm46OkVxdWFscyBjYW5ub3QgYmUgcGFydGlhbGx5IGNvbGxhcHNlZGAuXG4gIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgT2JqZWN0LnZhbHVlcyhvcHRpb25zLnN0YWNrLnRlbXBsYXRlLlJlc291cmNlcyA/PyB7fSkpIHtcbiAgICBpZiAoKHJlc291cmNlIGFzIGFueSkuVHlwZSA9PT0gJ0FXUzo6Q2xvdWRGb3JtYXRpb246OlN0YWNrJykge1xuICAgICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coJ1RoaXMgc3RhY2sgY29udGFpbnMgb25lIG9yIG1vcmUgbmVzdGVkIHN0YWNrcywgZmFsbGluZyBiYWNrIHRvIHRlbXBsYXRlLW9ubHkgZGlmZi4uLicpKTtcblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdXBsb2FkQm9keVBhcmFtZXRlckFuZENyZWF0ZUNoYW5nZVNldChpb0hlbHBlciwgb3B0aW9ucyk7XG59XG5cbi8qKlxuICogUmV0dXJucyBhbGwgZmlsZSBlbnRyaWVzIGZyb20gYW4gQXNzZXRNYW5pZmVzdEFydGlmYWN0IHRoYXQgbG9vayBsaWtlIHRlbXBsYXRlcy5cbiAqXG4gKiBUaGlzIGlzIHVzZWQgaW4gdGhlIGB1cGxvYWRCb2R5UGFyYW1ldGVyQW5kQ3JlYXRlQ2hhbmdlU2V0YCBmdW5jdGlvbiB0byBmaW5kXG4gKiBhbGwgdGVtcGxhdGUgYXNzZXQgZmlsZXMgdG8gYnVpbGQgYW5kIHB1Ymxpc2guXG4gKlxuICogUmV0dXJucyBhIHR1cGxlIG9mIFtBc3NldE1hbmlmZXN0LCBGaWxlTWFuaWZlc3RFbnRyeVtdXVxuICovXG5mdW5jdGlvbiB0ZW1wbGF0ZXNGcm9tQXNzZXRNYW5pZmVzdEFydGlmYWN0KFxuICBhcnRpZmFjdDogY3hhcGkuQXNzZXRNYW5pZmVzdEFydGlmYWN0LFxuKTogW0Fzc2V0TWFuaWZlc3QsIEZpbGVNYW5pZmVzdEVudHJ5W11dIHtcbiAgY29uc3QgYXNzZXRzOiBGaWxlTWFuaWZlc3RFbnRyeVtdID0gW107XG4gIGNvbnN0IGZpbGVOYW1lID0gYXJ0aWZhY3QuZmlsZTtcbiAgY29uc3QgYXNzZXRNYW5pZmVzdCA9IEFzc2V0TWFuaWZlc3QuZnJvbUZpbGUoZmlsZU5hbWUpO1xuXG4gIGFzc2V0TWFuaWZlc3QuZW50cmllcy5mb3JFYWNoKChlbnRyeSkgPT4ge1xuICAgIGlmIChlbnRyeS50eXBlID09PSAnZmlsZScpIHtcbiAgICAgIGNvbnN0IHNvdXJjZSA9IChlbnRyeSBhcyBGaWxlTWFuaWZlc3RFbnRyeSkuc291cmNlO1xuICAgICAgaWYgKHNvdXJjZS5wYXRoICYmIHNvdXJjZS5wYXRoLmVuZHNXaXRoKCcudGVtcGxhdGUuanNvbicpKSB7XG4gICAgICAgIGFzc2V0cy5wdXNoKGVudHJ5IGFzIEZpbGVNYW5pZmVzdEVudHJ5KTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICByZXR1cm4gW2Fzc2V0TWFuaWZlc3QsIGFzc2V0c107XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHVwbG9hZEJvZHlQYXJhbWV0ZXJBbmRDcmVhdGVDaGFuZ2VTZXQoXG4gIGlvSGVscGVyOiBJb0hlbHBlcixcbiAgb3B0aW9uczogUHJlcGFyZUNoYW5nZVNldE9wdGlvbnMsXG4pOiBQcm9taXNlPERlc2NyaWJlQ2hhbmdlU2V0Q29tbWFuZE91dHB1dCB8IHVuZGVmaW5lZD4ge1xuICB0cnkge1xuICAgIGF3YWl0IHVwbG9hZFN0YWNrVGVtcGxhdGVBc3NldHMob3B0aW9ucy5zdGFjaywgb3B0aW9ucy5kZXBsb3ltZW50cyk7XG4gICAgY29uc3QgZW52ID0gYXdhaXQgb3B0aW9ucy5kZXBsb3ltZW50cy5lbnZzLmFjY2Vzc1N0YWNrRm9yTXV0YWJsZVN0YWNrT3BlcmF0aW9ucyhvcHRpb25zLnN0YWNrKTtcblxuICAgIGNvbnN0IGJvZHlQYXJhbWV0ZXIgPSBhd2FpdCBtYWtlQm9keVBhcmFtZXRlcihcbiAgICAgIGlvSGVscGVyLFxuICAgICAgb3B0aW9ucy5zdGFjayxcbiAgICAgIGVudi5yZXNvbHZlZEVudmlyb25tZW50LFxuICAgICAgbmV3IEFzc2V0TWFuaWZlc3RCdWlsZGVyKCksXG4gICAgICBlbnYucmVzb3VyY2VzLFxuICAgICk7XG4gICAgY29uc3QgY2ZuID0gZW52LnNkay5jbG91ZEZvcm1hdGlvbigpO1xuICAgIGNvbnN0IGV4aXN0cyA9IChhd2FpdCBDbG91ZEZvcm1hdGlvblN0YWNrLmxvb2t1cChjZm4sIG9wdGlvbnMuc3RhY2suc3RhY2tOYW1lLCBmYWxzZSkpLmV4aXN0cztcblxuICAgIGNvbnN0IGV4ZWN1dGlvblJvbGVBcm4gPSBhd2FpdCBlbnYucmVwbGFjZVBsYWNlaG9sZGVycyhvcHRpb25zLnN0YWNrLmNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUm9sZUFybik7XG4gICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9JTkZPLm1zZyhcbiAgICAgICdIb2xkIG9uIHdoaWxlIHdlIGNyZWF0ZSBhIHJlYWQtb25seSBjaGFuZ2Ugc2V0IHRvIGdldCBhIGRpZmYgd2l0aCBhY2N1cmF0ZSByZXBsYWNlbWVudCBpbmZvcm1hdGlvbiAodXNlIC0tbm8tY2hhbmdlLXNldCB0byB1c2UgYSBsZXNzIGFjY3VyYXRlIGJ1dCBmYXN0ZXIgdGVtcGxhdGUtb25seSBkaWZmKVxcbicsXG4gICAgKSk7XG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlQ2hhbmdlU2V0KGlvSGVscGVyLCB7XG4gICAgICBjZm4sXG4gICAgICBjaGFuZ2VTZXROYW1lOiAnY2RrLWRpZmYtY2hhbmdlLXNldCcsXG4gICAgICBzdGFjazogb3B0aW9ucy5zdGFjayxcbiAgICAgIGV4aXN0cyxcbiAgICAgIHV1aWQ6IG9wdGlvbnMudXVpZCxcbiAgICAgIHdpbGxFeGVjdXRlOiBvcHRpb25zLndpbGxFeGVjdXRlLFxuICAgICAgYm9keVBhcmFtZXRlcixcbiAgICAgIHBhcmFtZXRlcnM6IG9wdGlvbnMucGFyYW1ldGVycyxcbiAgICAgIHJlc291cmNlc1RvSW1wb3J0OiBvcHRpb25zLnJlc291cmNlc1RvSW1wb3J0LFxuICAgICAgcm9sZTogZXhlY3V0aW9uUm9sZUFybixcbiAgICB9KTtcbiAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgLy8gVGhpcyBmdW5jdGlvbiBpcyBjdXJyZW50bHkgb25seSB1c2VkIGJ5IGRpZmYgc28gdGhlc2UgbWVzc2FnZXMgYXJlIGRpZmYtc3BlY2lmaWNcbiAgICBpZiAoIW9wdGlvbnMuZmFpbE9uRXJyb3IpIHtcbiAgICAgIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKFN0cmluZyhlKSkpO1xuICAgICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9JTkZPLm1zZyhcbiAgICAgICAgJ0NvdWxkIG5vdCBjcmVhdGUgYSBjaGFuZ2Ugc2V0LCB3aWxsIGJhc2UgdGhlIGRpZmYgb24gdGVtcGxhdGUgZGlmZmVyZW5jZXMgKHJ1biBhZ2FpbiB3aXRoIC12IHRvIHNlZSB0aGUgcmVhc29uKVxcbicsXG4gICAgICApKTtcblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKCdDb3VsZCBub3QgY3JlYXRlIGEgY2hhbmdlIHNldCBhbmQgZmFpbE9uRXJyb3IgaXMgc2V0LiAocnVuIGFnYWluIHdpdGggZmFpbE9uRXJyb3Igb2ZmIHRvIGJhc2UgdGhlIGRpZmYgb24gdGVtcGxhdGUgZGlmZmVyZW5jZXMpXFxuJywgZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBVcGxvYWRzIHRoZSBhc3NldHMgdGhhdCBsb29rIGxpa2UgdGVtcGxhdGVzIGZvciB0aGlzIENsb3VkRm9ybWF0aW9uIHN0YWNrXG4gKlxuICogVGhpcyBpcyBuZWNlc3NhcnkgZm9yIGFueSBDbG91ZEZvcm1hdGlvbiBjYWxsIHRoYXQgbmVlZHMgdGhlIHRlbXBsYXRlLCBpdCBtYXkgbmVlZFxuICogdG8gYmUgdXBsb2FkZWQgdG8gYW4gUzMgYnVja2V0IGZpcnN0LiBXZSBoYXZlIHRvIGZvbGxvdyB0aGUgaW5zdHJ1Y3Rpb25zIGluIHRoZVxuICogYXNzZXQgbWFuaWZlc3QsIGJlY2F1c2UgdGVjaG5pY2FsbHkgdGhhdCBpcyB0aGUgb25seSBwbGFjZSB0aGF0IGtub3dzIGFib3V0XG4gKiBidWNrZXQgYW5kIGFzc3VtZWQgcm9sZXMgYW5kIHN1Y2guXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGxvYWRTdGFja1RlbXBsYXRlQXNzZXRzKHN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QsIGRlcGxveW1lbnRzOiBEZXBsb3ltZW50cykge1xuICBmb3IgKGNvbnN0IGFydGlmYWN0IG9mIHN0YWNrLmRlcGVuZGVuY2llcykge1xuICAgIC8vIFNraXAgYXJ0aWZhY3QgaWYgaXQgaXMgbm90IGFuIEFzc2V0IE1hbmlmZXN0IEFydGlmYWN0XG4gICAgaWYgKCFjeGFwaS5Bc3NldE1hbmlmZXN0QXJ0aWZhY3QuaXNBc3NldE1hbmlmZXN0QXJ0aWZhY3QoYXJ0aWZhY3QpKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBbYXNzZXRNYW5pZmVzdCwgZmlsZV9lbnRyaWVzXSA9IHRlbXBsYXRlc0Zyb21Bc3NldE1hbmlmZXN0QXJ0aWZhY3QoYXJ0aWZhY3QpO1xuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZmlsZV9lbnRyaWVzKSB7XG4gICAgICBhd2FpdCBkZXBsb3ltZW50cy5idWlsZFNpbmdsZUFzc2V0KGFydGlmYWN0LCBhc3NldE1hbmlmZXN0LCBlbnRyeSwge1xuICAgICAgICBzdGFjayxcbiAgICAgIH0pO1xuICAgICAgYXdhaXQgZGVwbG95bWVudHMucHVibGlzaFNpbmdsZUFzc2V0KGFzc2V0TWFuaWZlc3QsIGVudHJ5LCB7XG4gICAgICAgIHN0YWNrLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVDaGFuZ2VTZXQoXG4gIGlvSGVscGVyOiBJb0hlbHBlcixcbiAgb3B0aW9uczogQ3JlYXRlQ2hhbmdlU2V0T3B0aW9ucyxcbik6IFByb21pc2U8RGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0PiB7XG4gIGF3YWl0IGNsZWFudXBPbGRDaGFuZ2VzZXQob3B0aW9ucy5jZm4sIGlvSGVscGVyLCBvcHRpb25zLmNoYW5nZVNldE5hbWUsIG9wdGlvbnMuc3RhY2suc3RhY2tOYW1lKTtcblxuICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhgQXR0ZW1wdGluZyB0byBjcmVhdGUgQ2hhbmdlU2V0IHdpdGggbmFtZSAke29wdGlvbnMuY2hhbmdlU2V0TmFtZX0gZm9yIHN0YWNrICR7b3B0aW9ucy5zdGFjay5zdGFja05hbWV9YCkpO1xuXG4gIGNvbnN0IHRlbXBsYXRlUGFyYW1zID0gVGVtcGxhdGVQYXJhbWV0ZXJzLmZyb21UZW1wbGF0ZShvcHRpb25zLnN0YWNrLnRlbXBsYXRlKTtcbiAgY29uc3Qgc3RhY2tQYXJhbXMgPSB0ZW1wbGF0ZVBhcmFtcy5zdXBwbHlBbGwob3B0aW9ucy5wYXJhbWV0ZXJzKTtcblxuICBjb25zdCBjaGFuZ2VTZXQgPSBhd2FpdCBvcHRpb25zLmNmbi5jcmVhdGVDaGFuZ2VTZXQoe1xuICAgIFN0YWNrTmFtZTogb3B0aW9ucy5zdGFjay5zdGFja05hbWUsXG4gICAgQ2hhbmdlU2V0TmFtZTogb3B0aW9ucy5jaGFuZ2VTZXROYW1lLFxuICAgIENoYW5nZVNldFR5cGU6IG9wdGlvbnMucmVzb3VyY2VzVG9JbXBvcnQgPyAnSU1QT1JUJyA6IG9wdGlvbnMuZXhpc3RzID8gJ1VQREFURScgOiAnQ1JFQVRFJyxcbiAgICBEZXNjcmlwdGlvbjogYENESyBDaGFuZ2VzZXQgZm9yIGRpZmYgJHtvcHRpb25zLnV1aWR9YCxcbiAgICBDbGllbnRUb2tlbjogYGRpZmYke29wdGlvbnMudXVpZH1gLFxuICAgIFRlbXBsYXRlVVJMOiBvcHRpb25zLmJvZHlQYXJhbWV0ZXIuVGVtcGxhdGVVUkwsXG4gICAgVGVtcGxhdGVCb2R5OiBvcHRpb25zLmJvZHlQYXJhbWV0ZXIuVGVtcGxhdGVCb2R5LFxuICAgIFBhcmFtZXRlcnM6IHN0YWNrUGFyYW1zLmFwaVBhcmFtZXRlcnMsXG4gICAgUmVzb3VyY2VzVG9JbXBvcnQ6IG9wdGlvbnMucmVzb3VyY2VzVG9JbXBvcnQsXG4gICAgUm9sZUFSTjogb3B0aW9ucy5yb2xlLFxuICAgIFRhZ3M6IHRvQ2ZuVGFncyhvcHRpb25zLnN0YWNrLnRhZ3MpLFxuICAgIENhcGFiaWxpdGllczogWydDQVBBQklMSVRZX0lBTScsICdDQVBBQklMSVRZX05BTUVEX0lBTScsICdDQVBBQklMSVRZX0FVVE9fRVhQQU5EJ10sXG4gIH0pO1xuXG4gIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGZvcm1hdCgnSW5pdGlhdGVkIGNyZWF0aW9uIG9mIGNoYW5nZXNldDogJXM7IHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCBjcmVhdGluZy4uLicsIGNoYW5nZVNldC5JZCkpKTtcbiAgLy8gRmV0Y2hpbmcgYWxsIHBhZ2VzIGlmIHdlJ2xsIGV4ZWN1dGUsIHNvIHdlIGNhbiBoYXZlIHRoZSBjb3JyZWN0IGNoYW5nZSBjb3VudCB3aGVuIG1vbml0b3JpbmcuXG4gIGNvbnN0IGNyZWF0ZWRDaGFuZ2VTZXQgPSBhd2FpdCB3YWl0Rm9yQ2hhbmdlU2V0KG9wdGlvbnMuY2ZuLCBpb0hlbHBlciwgb3B0aW9ucy5zdGFjay5zdGFja05hbWUsIG9wdGlvbnMuY2hhbmdlU2V0TmFtZSwge1xuICAgIGZldGNoQWxsOiBvcHRpb25zLndpbGxFeGVjdXRlLFxuICB9KTtcbiAgYXdhaXQgY2xlYW51cE9sZENoYW5nZXNldChvcHRpb25zLmNmbiwgaW9IZWxwZXIsIG9wdGlvbnMuY2hhbmdlU2V0TmFtZSwgb3B0aW9ucy5zdGFjay5zdGFja05hbWUpO1xuXG4gIHJldHVybiBjcmVhdGVkQ2hhbmdlU2V0O1xufVxuXG5mdW5jdGlvbiB0b0NmblRhZ3ModGFnczogeyBbaWQ6IHN0cmluZ106IHN0cmluZyB9KTogVGFnW10ge1xuICByZXR1cm4gT2JqZWN0LmVudHJpZXModGFncykubWFwKChbaywgdl0pID0+ICh7XG4gICAgS2V5OiBrLFxuICAgIFZhbHVlOiB2LFxuICB9KSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNsZWFudXBPbGRDaGFuZ2VzZXQoXG4gIGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50LFxuICBpb0hlbHBlcjogSW9IZWxwZXIsXG4gIGNoYW5nZVNldE5hbWU6IHN0cmluZyxcbiAgc3RhY2tOYW1lOiBzdHJpbmcsXG4pIHtcbiAgLy8gRGVsZXRlIGFueSBleGlzdGluZyBjaGFuZ2Ugc2V0cyBnZW5lcmF0ZWQgYnkgQ0RLIHNpbmNlIGNoYW5nZSBzZXQgbmFtZXMgbXVzdCBiZSB1bmlxdWUuXG4gIC8vIFRoZSBkZWxldGUgcmVxdWVzdCBpcyBzdWNjZXNzZnVsIGFzIGxvbmcgYXMgdGhlIHN0YWNrIGV4aXN0cyAoZXZlbiBpZiB0aGUgY2hhbmdlIHNldCBkb2VzIG5vdCBleGlzdCkuXG4gIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGBSZW1vdmluZyBleGlzdGluZyBjaGFuZ2Ugc2V0IHdpdGggbmFtZSAke2NoYW5nZVNldE5hbWV9IGlmIGl0IGV4aXN0c2ApKTtcbiAgYXdhaXQgY2ZuLmRlbGV0ZUNoYW5nZVNldCh7XG4gICAgU3RhY2tOYW1lOiBzdGFja05hbWUsXG4gICAgQ2hhbmdlU2V0TmFtZTogY2hhbmdlU2V0TmFtZSxcbiAgfSk7XG59XG5cbi8qKlxuICogUmV0dXJuIHRydWUgaWYgdGhlIGdpdmVuIGNoYW5nZSBzZXQgaGFzIG5vIGNoYW5nZXNcbiAqXG4gKiBUaGlzIG11c3QgYmUgZGV0ZXJtaW5lZCBmcm9tIHRoZSBzdGF0dXMsIG5vdCB0aGUgJ0NoYW5nZXMnIGFycmF5IG9uIHRoZVxuICogb2JqZWN0OyB0aGUgbGF0dGVyIGNhbiBiZSBlbXB0eSBiZWNhdXNlIG5vIHJlc291cmNlcyB3ZXJlIGNoYW5nZWQsIGJ1dCBpZlxuICogdGhlcmUgYXJlIGNoYW5nZXMgdG8gT3V0cHV0cywgdGhlIGNoYW5nZSBzZXQgY2FuIHN0aWxsIGJlIGV4ZWN1dGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2hhbmdlU2V0SGFzTm9DaGFuZ2VzKGRlc2NyaXB0aW9uOiBEZXNjcmliZUNoYW5nZVNldENvbW1hbmRPdXRwdXQpIHtcbiAgY29uc3Qgbm9DaGFuZ2VFcnJvclByZWZpeGVzID0gW1xuICAgIC8vIEVycm9yIG1lc3NhZ2UgZm9yIGEgcmVndWxhciB0ZW1wbGF0ZVxuICAgIFwiVGhlIHN1Ym1pdHRlZCBpbmZvcm1hdGlvbiBkaWRuJ3QgY29udGFpbiBjaGFuZ2VzLlwiLFxuICAgIC8vIEVycm9yIG1lc3NhZ2Ugd2hlbiBhIFRyYW5zZm9ybSBpcyBpbnZvbHZlZCAoc2VlICMxMDY1MClcbiAgICAnTm8gdXBkYXRlcyBhcmUgdG8gYmUgcGVyZm9ybWVkLicsXG4gIF07XG5cbiAgcmV0dXJuIChcbiAgICBkZXNjcmlwdGlvbi5TdGF0dXMgPT09ICdGQUlMRUQnICYmIG5vQ2hhbmdlRXJyb3JQcmVmaXhlcy5zb21lKChwKSA9PiAoZGVzY3JpcHRpb24uU3RhdHVzUmVhc29uID8/ICcnKS5zdGFydHNXaXRoKHApKVxuICApO1xufVxuXG4vKipcbiAqIFdhaXRzIGZvciBhIENsb3VkRm9ybWF0aW9uIHN0YWNrIHRvIHN0YWJpbGl6ZSBpbiBhIGNvbXBsZXRlL2F2YWlsYWJsZSBzdGF0ZVxuICogYWZ0ZXIgYSBkZWxldGUgb3BlcmF0aW9uIGlzIGlzc3VlZC5cbiAqXG4gKiBGYWlscyBpZiB0aGUgc3RhY2sgaXMgaW4gYSBGQUlMRUQgc3RhdGUuIFdpbGwgbm90IGZhaWwgaWYgdGhlIHN0YWNrIHdhc1xuICogYWxyZWFkeSBkZWxldGVkLlxuICpcbiAqIEBwYXJhbSBjZm4gICAgICAgIGEgQ2xvdWRGb3JtYXRpb24gY2xpZW50XG4gKiBAcGFyYW0gc3RhY2tOYW1lICAgICAgdGhlIG5hbWUgb2YgdGhlIHN0YWNrIHRvIHdhaXQgZm9yIGFmdGVyIGEgZGVsZXRlXG4gKlxuICogQHJldHVybnMgICAgIHRoZSBDbG91ZEZvcm1hdGlvbiBkZXNjcmlwdGlvbiBvZiB0aGUgc3RhYmlsaXplZCBzdGFjayBhZnRlciB0aGUgZGVsZXRlIGF0dGVtcHRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JTdGFja0RlbGV0ZShcbiAgY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQsXG4gIGlvSGVscGVyOiBJb0hlbHBlcixcbiAgc3RhY2tOYW1lOiBzdHJpbmcsXG4pOiBQcm9taXNlPENsb3VkRm9ybWF0aW9uU3RhY2sgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3Qgc3RhY2sgPSBhd2FpdCBzdGFiaWxpemVTdGFjayhjZm4sIGlvSGVscGVyLCBzdGFja05hbWUpO1xuICBpZiAoIXN0YWNrKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IHN0YXR1cyA9IHN0YWNrLnN0YWNrU3RhdHVzO1xuICBpZiAoc3RhdHVzLmlzRmFpbHVyZSkge1xuICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoXG4gICAgICBgVGhlIHN0YWNrIG5hbWVkICR7c3RhY2tOYW1lfSBpcyBpbiBhIGZhaWxlZCBzdGF0ZS4gWW91IG1heSBuZWVkIHRvIGRlbGV0ZSBpdCBmcm9tIHRoZSBBV1MgY29uc29sZSA6ICR7c3RhdHVzfWAsXG4gICAgKTtcbiAgfSBlbHNlIGlmIChzdGF0dXMuaXNEZWxldGVkKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gc3RhY2s7XG59XG5cbi8qKlxuICogV2FpdHMgZm9yIGEgQ2xvdWRGb3JtYXRpb24gc3RhY2sgdG8gc3RhYmlsaXplIGluIGEgY29tcGxldGUvYXZhaWxhYmxlIHN0YXRlXG4gKiBhZnRlciBhbiB1cGRhdGUvY3JlYXRlIG9wZXJhdGlvbiBpcyBpc3N1ZWQuXG4gKlxuICogRmFpbHMgaWYgdGhlIHN0YWNrIGlzIGluIGEgRkFJTEVEIHN0YXRlLCBST0xMQkFDSyBzdGF0ZSwgb3IgREVMRVRFRCBzdGF0ZS5cbiAqXG4gKiBAcGFyYW0gY2ZuICAgICAgICBhIENsb3VkRm9ybWF0aW9uIGNsaWVudFxuICogQHBhcmFtIHN0YWNrTmFtZSAgICAgIHRoZSBuYW1lIG9mIHRoZSBzdGFjayB0byB3YWl0IGZvciBhZnRlciBhbiB1cGRhdGVcbiAqXG4gKiBAcmV0dXJucyAgICAgdGhlIENsb3VkRm9ybWF0aW9uIGRlc2NyaXB0aW9uIG9mIHRoZSBzdGFiaWxpemVkIHN0YWNrIGFmdGVyIHRoZSB1cGRhdGUgYXR0ZW1wdFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2FpdEZvclN0YWNrRGVwbG95KFxuICBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgaW9IZWxwZXI6IElvSGVscGVyLFxuICBzdGFja05hbWU6IHN0cmluZyxcbik6IFByb21pc2U8Q2xvdWRGb3JtYXRpb25TdGFjayB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCBzdGFjayA9IGF3YWl0IHN0YWJpbGl6ZVN0YWNrKGNmbiwgaW9IZWxwZXIsIHN0YWNrTmFtZSk7XG4gIGlmICghc3RhY2spIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgY29uc3Qgc3RhdHVzID0gc3RhY2suc3RhY2tTdGF0dXM7XG5cbiAgaWYgKHN0YXR1cy5pc0NyZWF0aW9uRmFpbHVyZSkge1xuICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoXG4gICAgICBgVGhlIHN0YWNrIG5hbWVkICR7c3RhY2tOYW1lfSBmYWlsZWQgY3JlYXRpb24sIGl0IG1heSBuZWVkIHRvIGJlIG1hbnVhbGx5IGRlbGV0ZWQgZnJvbSB0aGUgQVdTIGNvbnNvbGU6ICR7c3RhdHVzfWAsXG4gICAgKTtcbiAgfSBlbHNlIGlmICghc3RhdHVzLmlzRGVwbG95U3VjY2Vzcykge1xuICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoYFRoZSBzdGFjayBuYW1lZCAke3N0YWNrTmFtZX0gZmFpbGVkIHRvIGRlcGxveTogJHtzdGF0dXN9YCk7XG4gIH1cblxuICByZXR1cm4gc3RhY2s7XG59XG5cbi8qKlxuICogV2FpdCBmb3IgYSBzdGFjayB0byBiZWNvbWUgc3RhYmxlIChubyBsb25nZXIgX0lOX1BST0dSRVNTKSwgcmV0dXJuaW5nIGl0XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzdGFiaWxpemVTdGFjayhcbiAgY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQsXG4gIGlvSGVscGVyOiBJb0hlbHBlcixcbiAgc3RhY2tOYW1lOiBzdHJpbmcsXG4pIHtcbiAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coZm9ybWF0KCdXYWl0aW5nIGZvciBzdGFjayAlcyB0byBmaW5pc2ggY3JlYXRpbmcgb3IgdXBkYXRpbmcuLi4nLCBzdGFja05hbWUpKSk7XG4gIHJldHVybiB3YWl0Rm9yKGFzeW5jICgpID0+IHtcbiAgICBjb25zdCBzdGFjayA9IGF3YWl0IENsb3VkRm9ybWF0aW9uU3RhY2subG9va3VwKGNmbiwgc3RhY2tOYW1lKTtcbiAgICBpZiAoIXN0YWNrLmV4aXN0cykge1xuICAgICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coZm9ybWF0KCdTdGFjayAlcyBkb2VzIG5vdCBleGlzdCcsIHN0YWNrTmFtZSkpKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCBzdGF0dXMgPSBzdGFjay5zdGFja1N0YXR1cztcbiAgICBpZiAoc3RhdHVzLmlzSW5Qcm9ncmVzcykge1xuICAgICAgYXdhaXQgaW9IZWxwZXIubm90aWZ5KElPLkRFRkFVTFRfVE9PTEtJVF9ERUJVRy5tc2coZm9ybWF0KCdTdGFjayAlcyBoYXMgYW4gb25nb2luZyBvcGVyYXRpb24gaW4gcHJvZ3Jlc3MgYW5kIGlzIG5vdCBzdGFibGUgKCVzKScsIHN0YWNrTmFtZSwgc3RhdHVzKSkpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9IGVsc2UgaWYgKHN0YXR1cy5pc1Jldmlld0luUHJvZ3Jlc3MpIHtcbiAgICAgIC8vIFRoaXMgbWF5IGhhcHBlbiBpZiBhIHN0YWNrIGNyZWF0aW9uIG9wZXJhdGlvbiBpcyBpbnRlcnJ1cHRlZCBiZWZvcmUgdGhlIENoYW5nZVNldCBleGVjdXRpb24gc3RhcnRzLiBSZWNvdmVyaW5nXG4gICAgICAvLyBmcm9tIHRoaXMgd291bGQgcmVxdWlyaW5nIG1hbnVhbCBpbnRlcnZlbnRpb24gKGRlbGV0aW5nIG9yIGV4ZWN1dGluZyB0aGUgcGVuZGluZyBDaGFuZ2VTZXQpLCBhbmQgZmFpbGluZyB0byBkb1xuICAgICAgLy8gc28gd2lsbCByZXN1bHQgaW4gYW4gZW5kbGVzcyB3YWl0IGhlcmUgKHRoZSBDaGFuZ2VTZXQgd29udCBkZWxldGUgb3IgZXhlY3V0ZSBpdHNlbGYpLiBJbnN0ZWFkIG9mIGJsb2NraW5nXG4gICAgICAvLyBcImZvcmV2ZXJcIiB3ZSBwcm9jZWVkIGFzIGlmIHRoZSBzdGFjayB3YXMgZXhpc3RpbmcgYW5kIHN0YWJsZS4gSWYgdGhlcmUgaXMgYSBjb25jdXJyZW50IG9wZXJhdGlvbiB0aGF0IGp1c3RcbiAgICAgIC8vIGhhc24ndCBmaW5pc2hlZCBwcm9jZWVkaW5nIGp1c3QgeWV0LCBlaXRoZXIgdGhpcyBvcGVyYXRpb24gb3IgdGhlIGNvbmN1cnJlbnQgb25lIG1heSBmYWlsIGR1ZSB0byB0aGUgb3RoZXIgb25lXG4gICAgICAvLyBoYXZpbmcgbWFkZSBwcm9ncmVzcy4gV2hpY2ggaXMgZmluZS4gSSBndWVzcy5cbiAgICAgIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGZvcm1hdCgnU3RhY2sgJXMgaXMgaW4gUkVWSUVXX0lOX1BST0dSRVNTIHN0YXRlLiBDb25zaWRlcmluZyB0aGlzIGlzIGEgc3RhYmxlIHN0YXR1cyAoJXMpJywgc3RhY2tOYW1lLCBzdGF0dXMpKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHN0YWNrO1xuICB9KTtcbn1cblxuLyoqXG4gKiBEZXRlY3QgZHJpZnQgZm9yIGEgQ2xvdWRGb3JtYXRpb24gc3RhY2sgYW5kIHdhaXQgZm9yIHRoZSBkZXRlY3Rpb24gdG8gY29tcGxldGVcbiAqXG4gKiBAcGFyYW0gY2ZuICAgICAgICBhIENsb3VkRm9ybWF0aW9uIGNsaWVudFxuICogQHBhcmFtIGlvSGVscGVyICAgaGVscGVyIGZvciBJTyBvcGVyYXRpb25zXG4gKiBAcGFyYW0gc3RhY2tOYW1lICB0aGUgbmFtZSBvZiB0aGUgc3RhY2sgdG8gY2hlY2sgZm9yIGRyaWZ0XG4gKlxuICogQHJldHVybnMgICAgIHRoZSBDbG91ZEZvcm1hdGlvbiBkZXNjcmlwdGlvbiBvZiB0aGUgZHJpZnQgZGV0ZWN0aW9uIHJlc3VsdHNcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRldGVjdFN0YWNrRHJpZnQoXG4gIGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50LFxuICBpb0hlbHBlcjogSW9IZWxwZXIsXG4gIHN0YWNrTmFtZTogc3RyaW5nLFxuKTogUHJvbWlzZTxEZXNjcmliZVN0YWNrUmVzb3VyY2VEcmlmdHNDb21tYW5kT3V0cHV0PiB7XG4gIGF3YWl0IGlvSGVscGVyLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfREVCVUcubXNnKGZvcm1hdCgnU3RhcnRpbmcgZHJpZnQgZGV0ZWN0aW9uIGZvciBzdGFjayAlcy4uLicsIHN0YWNrTmFtZSkpKTtcblxuICAvLyBTdGFydCBkcmlmdCBkZXRlY3Rpb25cbiAgY29uc3QgZHJpZnREZXRlY3Rpb24gPSBhd2FpdCBjZm4uZGV0ZWN0U3RhY2tEcmlmdCh7XG4gICAgU3RhY2tOYW1lOiBzdGFja05hbWUsXG4gIH0pO1xuXG4gIC8vIFdhaXQgZm9yIGRyaWZ0IGRldGVjdGlvbiB0byBjb21wbGV0ZVxuICBjb25zdCBkcmlmdFN0YXR1cyA9IGF3YWl0IHdhaXRGb3JEcmlmdERldGVjdGlvbihjZm4sIGlvSGVscGVyLCBkcmlmdERldGVjdGlvbi5TdGFja0RyaWZ0RGV0ZWN0aW9uSWQhKTtcblxuICBpZiAoIWRyaWZ0U3RhdHVzKSB7XG4gICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcignRHJpZnQgZGV0ZWN0aW9uIHRvb2sgdG9vIGxvbmcgdG8gY29tcGxldGUuIEFib3J0aW5nJyk7XG4gIH1cblxuICBpZiAoZHJpZnRTdGF0dXM/LkRldGVjdGlvblN0YXR1cyA9PT0gJ0RFVEVDVElPTl9GQUlMRUQnKSB7XG4gICAgdGhyb3cgbmV3IFRvb2xraXRFcnJvcihcbiAgICAgIGBGYWlsZWQgdG8gZGV0ZWN0IGRyaWZ0IGZvciBzdGFjayAke3N0YWNrTmFtZX06ICR7ZHJpZnRTdGF0dXMuRGV0ZWN0aW9uU3RhdHVzUmVhc29uIHx8ICdObyByZWFzb24gcHJvdmlkZWQnfWAsXG4gICAgKTtcbiAgfVxuXG4gIC8vIEdldCB0aGUgZHJpZnQgcmVzdWx0c1xuICByZXR1cm4gY2ZuLmRlc2NyaWJlU3RhY2tSZXNvdXJjZURyaWZ0cyh7XG4gICAgU3RhY2tOYW1lOiBzdGFja05hbWUsXG4gIH0pO1xufVxuXG4vKipcbiAqIFdhaXQgZm9yIGEgZHJpZnQgZGV0ZWN0aW9uIG9wZXJhdGlvbiB0byBjb21wbGV0ZVxuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yRHJpZnREZXRlY3Rpb24oXG4gIGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50LFxuICBpb0hlbHBlcjogSW9IZWxwZXIsXG4gIGRyaWZ0RGV0ZWN0aW9uSWQ6IHN0cmluZyxcbik6IFByb21pc2U8RGVzY3JpYmVTdGFja0RyaWZ0RGV0ZWN0aW9uU3RhdHVzQ29tbWFuZE91dHB1dCB8IHVuZGVmaW5lZD4ge1xuICBhd2FpdCBpb0hlbHBlci5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0RFQlVHLm1zZyhmb3JtYXQoJ1dhaXRpbmcgZm9yIGRyaWZ0IGRldGVjdGlvbiAlcyB0byBjb21wbGV0ZS4uLicsIGRyaWZ0RGV0ZWN0aW9uSWQpKSk7XG5cbiAgY29uc3QgbWF4RGVsYXkgPSAzMF8wMDA7IC8vIDMwIHNlY29uZHMgbWF4IGRlbGF5XG4gIGxldCBiYXNlRGVsYXkgPSAxXzAwMDsgLy8gU3RhcnQgd2l0aCAxIHNlY29uZFxuICBsZXQgYXR0ZW1wdHMgPSAwO1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjZm4uZGVzY3JpYmVTdGFja0RyaWZ0RGV0ZWN0aW9uU3RhdHVzKHtcbiAgICAgIFN0YWNrRHJpZnREZXRlY3Rpb25JZDogZHJpZnREZXRlY3Rpb25JZCxcbiAgICB9KTtcblxuICAgIGlmIChyZXNwb25zZS5EZXRlY3Rpb25TdGF0dXMgPT09ICdERVRFQ1RJT05fQ09NUExFVEUnKSB7XG4gICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfVxuXG4gICAgaWYgKHJlc3BvbnNlLkRldGVjdGlvblN0YXR1cyA9PT0gJ0RFVEVDVElPTl9GQUlMRUQnKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBEcmlmdCBkZXRlY3Rpb24gZmFpbGVkOiAke3Jlc3BvbnNlLkRldGVjdGlvblN0YXR1c1JlYXNvbn1gKTtcbiAgICB9XG5cbiAgICBpZiAoYXR0ZW1wdHMrKyA+IDMwKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKCdEcmlmdCBkZXRlY3Rpb24gdGltZWQgb3V0IGFmdGVyIDMwIGF0dGVtcHRzJyk7XG4gICAgfVxuXG4gICAgLy8gQ2FsY3VsYXRlIGJhY2tvZmYgd2l0aCBqaXR0ZXJcbiAgICBjb25zdCBqaXR0ZXIgPSBNYXRoLnJhbmRvbSgpICogMTAwMDtcbiAgICBjb25zdCBkZWxheSA9IE1hdGgubWluKGJhc2VEZWxheSArIGppdHRlciwgbWF4RGVsYXkpO1xuICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCBkZWxheSkpO1xuICAgIGJhc2VEZWxheSAqPSAyO1xuICAgIGF0dGVtcHRzKys7XG4gIH1cbn1cblxuLyoqXG4gKiBUaGUgc2V0IG9mIChmb3JtYWwpIHBhcmFtZXRlcnMgdGhhdCBoYXZlIGJlZW4gZGVjbGFyZWQgaW4gYSB0ZW1wbGF0ZVxuICovXG5leHBvcnQgY2xhc3MgVGVtcGxhdGVQYXJhbWV0ZXJzIHtcbiAgcHVibGljIHN0YXRpYyBmcm9tVGVtcGxhdGUodGVtcGxhdGU6IFRlbXBsYXRlKSB7XG4gICAgcmV0dXJuIG5ldyBUZW1wbGF0ZVBhcmFtZXRlcnModGVtcGxhdGUuUGFyYW1ldGVycyB8fCB7fSk7XG4gIH1cblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHBhcmFtczogUmVjb3JkPHN0cmluZywgVGVtcGxhdGVQYXJhbWV0ZXI+KSB7XG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlIHN0YWNrIHBhcmFtZXRlcnMgdG8gcGFzcyBmcm9tIHRoZSBnaXZlbiBkZXNpcmVkIHBhcmFtZXRlciB2YWx1ZXNcbiAgICpcbiAgICogV2lsbCB0aHJvdyBpZiBwYXJhbWV0ZXJzIHdpdGhvdXQgYSBEZWZhdWx0IHZhbHVlIG9yIGEgUHJldmlvdXMgdmFsdWUgYXJlIG5vdFxuICAgKiBzdXBwbGllZC5cbiAgICovXG4gIHB1YmxpYyBzdXBwbHlBbGwodXBkYXRlczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPik6IFBhcmFtZXRlclZhbHVlcyB7XG4gICAgcmV0dXJuIG5ldyBQYXJhbWV0ZXJWYWx1ZXModGhpcy5wYXJhbXMsIHVwZGF0ZXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEZyb20gdGhlIHRlbXBsYXRlLCB0aGUgZ2l2ZW4gZGVzaXJlZCB2YWx1ZXMgYW5kIHRoZSBjdXJyZW50IHZhbHVlcywgY2FsY3VsYXRlIHRoZSBjaGFuZ2VzIHRvIHRoZSBzdGFjayBwYXJhbWV0ZXJzXG4gICAqXG4gICAqIFdpbGwgdGFrZSBpbnRvIGFjY291bnQgcGFyYW1ldGVycyBhbHJlYWR5IHNldCBvbiB0aGUgdGVtcGxhdGUgKHdpbGwgZW1pdFxuICAgKiAnVXNlUHJldmlvdXNWYWx1ZTogdHJ1ZScgZm9yIHRob3NlIHVubGVzcyB0aGUgdmFsdWUgaXMgY2hhbmdlZCksIGFuZCB3aWxsXG4gICAqIHRocm93IGlmIHBhcmFtZXRlcnMgd2l0aG91dCBhIERlZmF1bHQgdmFsdWUgb3IgYSBQcmV2aW91cyB2YWx1ZSBhcmUgbm90XG4gICAqIHN1cHBsaWVkLlxuICAgKi9cbiAgcHVibGljIHVwZGF0ZUV4aXN0aW5nKFxuICAgIHVwZGF0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4sXG4gICAgcHJldmlvdXNWYWx1ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICk6IFBhcmFtZXRlclZhbHVlcyB7XG4gICAgcmV0dXJuIG5ldyBQYXJhbWV0ZXJWYWx1ZXModGhpcy5wYXJhbXMsIHVwZGF0ZXMsIHByZXZpb3VzVmFsdWVzKTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBzZXQgb2YgcGFyYW1ldGVycyB3ZSdyZSBnb2luZyB0byBwYXNzIHRvIGEgU3RhY2tcbiAqL1xuZXhwb3J0IGNsYXNzIFBhcmFtZXRlclZhbHVlcyB7XG4gIHB1YmxpYyByZWFkb25seSB2YWx1ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgcHVibGljIHJlYWRvbmx5IGFwaVBhcmFtZXRlcnM6IFBhcmFtZXRlcltdID0gW107XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBmb3JtYWxQYXJhbXM6IFJlY29yZDxzdHJpbmcsIFRlbXBsYXRlUGFyYW1ldGVyPixcbiAgICB1cGRhdGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+LFxuICAgIHByZXZpb3VzVmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge30sXG4gICkge1xuICAgIGNvbnN0IG1pc3NpbmdSZXF1aXJlZCA9IG5ldyBBcnJheTxzdHJpbmc+KCk7XG5cbiAgICBmb3IgKGNvbnN0IFtrZXksIGZvcm1hbFBhcmFtXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmZvcm1hbFBhcmFtcykpIHtcbiAgICAgIC8vIENoZWNrIHVwZGF0ZXMgZmlyc3QsIHRoZW4gdXNlIHRoZSBwcmV2aW91cyB2YWx1ZSAoaWYgYXZhaWxhYmxlKSwgdGhlbiB1c2VcbiAgICAgIC8vIHRoZSBkZWZhdWx0IChpZiBhdmFpbGFibGUpLlxuICAgICAgLy9cbiAgICAgIC8vIElmIHdlIGRvbid0IGZpbmQgYSBwYXJhbWV0ZXIgdmFsdWUgdXNpbmcgYW55IG9mIHRoZXNlIG1ldGhvZHMsIHRoZW4gdGhhdCdzIGFuIGVycm9yLlxuICAgICAgY29uc3QgdXBkYXRlZFZhbHVlID0gdXBkYXRlc1trZXldO1xuICAgICAgaWYgKHVwZGF0ZWRWYWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMudmFsdWVzW2tleV0gPSB1cGRhdGVkVmFsdWU7XG4gICAgICAgIHRoaXMuYXBpUGFyYW1ldGVycy5wdXNoKHtcbiAgICAgICAgICBQYXJhbWV0ZXJLZXk6IGtleSxcbiAgICAgICAgICBQYXJhbWV0ZXJWYWx1ZTogdXBkYXRlc1trZXldLFxuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChrZXkgaW4gcHJldmlvdXNWYWx1ZXMpIHtcbiAgICAgICAgdGhpcy52YWx1ZXNba2V5XSA9IHByZXZpb3VzVmFsdWVzW2tleV07XG4gICAgICAgIHRoaXMuYXBpUGFyYW1ldGVycy5wdXNoKHsgUGFyYW1ldGVyS2V5OiBrZXksIFVzZVByZXZpb3VzVmFsdWU6IHRydWUgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoZm9ybWFsUGFyYW0uRGVmYXVsdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMudmFsdWVzW2tleV0gPSBmb3JtYWxQYXJhbS5EZWZhdWx0O1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gT2ggbm9cbiAgICAgIG1pc3NpbmdSZXF1aXJlZC5wdXNoKGtleSk7XG4gICAgfVxuXG4gICAgaWYgKG1pc3NpbmdSZXF1aXJlZC5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgVG9vbGtpdEVycm9yKGBUaGUgZm9sbG93aW5nIENsb3VkRm9ybWF0aW9uIFBhcmFtZXRlcnMgYXJlIG1pc3NpbmcgYSB2YWx1ZTogJHttaXNzaW5nUmVxdWlyZWQuam9pbignLCAnKX1gKTtcbiAgICB9XG5cbiAgICAvLyBKdXN0IGFwcGVuZCBhbGwgc3VwcGxpZWQgb3ZlcnJpZGVzIHRoYXQgYXJlbid0IHJlYWxseSBleHBlY3RlZCAodGhpc1xuICAgIC8vIHdpbGwgZmFpbCBDRk4gYnV0IG1heWJlIHBlb3BsZSBtYWRlIHR5cG9zIHRoYXQgdGhleSB3YW50IHRvIGJlIG5vdGlmaWVkXG4gICAgLy8gb2YpXG4gICAgY29uc3QgdW5rbm93blBhcmFtID0gKFtrZXksIF9dOiBbc3RyaW5nLCBhbnldKSA9PiB0aGlzLmZvcm1hbFBhcmFtc1trZXldID09PSB1bmRlZmluZWQ7XG4gICAgY29uc3QgaGFzVmFsdWUgPSAoW18sIHZhbHVlXTogW3N0cmluZywgYW55XSkgPT4gISF2YWx1ZTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh1cGRhdGVzKS5maWx0ZXIodW5rbm93blBhcmFtKS5maWx0ZXIoaGFzVmFsdWUpKSB7XG4gICAgICB0aGlzLnZhbHVlc1trZXldID0gdmFsdWUhO1xuICAgICAgdGhpcy5hcGlQYXJhbWV0ZXJzLnB1c2goeyBQYXJhbWV0ZXJLZXk6IGtleSwgUGFyYW1ldGVyVmFsdWU6IHZhbHVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoaXMgc2V0IG9mIHBhcmFtZXRlciB1cGRhdGVzIHdpbGwgY2hhbmdlIHRoZSBhY3R1YWwgc3RhY2sgdmFsdWVzXG4gICAqL1xuICBwdWJsaWMgaGFzQ2hhbmdlcyhjdXJyZW50VmFsdWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogUGFyYW1ldGVyQ2hhbmdlcyB7XG4gICAgLy8gSWYgYW55IG9mIHRoZSBwYXJhbWV0ZXJzIGFyZSBTU00gcGFyYW1ldGVycywgZGVwbG95aW5nIG11c3QgYWx3YXlzIGhhcHBlblxuICAgIC8vIGJlY2F1c2Ugd2UgY2FuJ3QgcHJlZGljdCB3aGF0IHRoZSB2YWx1ZXMgd2lsbCBiZS4gV2Ugd2lsbCBhbGxvdyBzb21lXG4gICAgLy8gcGFyYW1ldGVycyB0byBvcHQgb3V0IG9mIHRoaXMgY2hlY2sgYnkgaGF2aW5nIGEgbWFnaWMgc3RyaW5nIGluIHRoZWlyIGRlc2NyaXB0aW9uLlxuICAgIGlmIChcbiAgICAgIE9iamVjdC52YWx1ZXModGhpcy5mb3JtYWxQYXJhbXMpLnNvbWUoXG4gICAgICAgIChwKSA9PiBwLlR5cGUuc3RhcnRzV2l0aCgnQVdTOjpTU006OlBhcmFtZXRlcjo6JykgJiYgIXAuRGVzY3JpcHRpb24/LmluY2x1ZGVzKFNTTVBBUkFNX05PX0lOVkFMSURBVEUpLFxuICAgICAgKVxuICAgICkge1xuICAgICAgcmV0dXJuICdzc20nO1xuICAgIH1cblxuICAgIC8vIE90aGVyd2lzZSB3ZSdyZSBkaXJ0eSBpZjpcbiAgICAvLyAtIGFueSBvZiB0aGUgZXhpc3RpbmcgdmFsdWVzIGFyZSByZW1vdmVkLCBvciBjaGFuZ2VkXG4gICAgaWYgKE9iamVjdC5lbnRyaWVzKGN1cnJlbnRWYWx1ZXMpLnNvbWUoKFtrZXksIHZhbHVlXSkgPT4gIShrZXkgaW4gdGhpcy52YWx1ZXMpIHx8IHZhbHVlICE9PSB0aGlzLnZhbHVlc1trZXldKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gLSBhbnkgb2YgdGhlIHZhbHVlcyB3ZSdyZSBzZXR0aW5nIGFyZSBuZXdcbiAgICBpZiAoT2JqZWN0LmtleXModGhpcy52YWx1ZXMpLnNvbWUoKGtleSkgPT4gIShrZXkgaW4gY3VycmVudFZhbHVlcykpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IHR5cGUgUGFyYW1ldGVyQ2hhbmdlcyA9IGJvb2xlYW4gfCAnc3NtJztcbiJdfQ==