"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryHotswapDeployment = tryHotswapDeployment;
const util_1 = require("util");
const cfn_diff = require("@aws-cdk/cloudformation-diff");
const chalk = require("chalk");
const payloads_1 = require("../../payloads");
const util_2 = require("../../util");
const cloudformation_1 = require("../cloudformation");
const appsync_mapping_templates_1 = require("./appsync-mapping-templates");
const code_build_projects_1 = require("./code-build-projects");
const common_1 = require("./common");
const ecs_services_1 = require("./ecs-services");
const lambda_functions_1 = require("./lambda-functions");
const s3_bucket_deployments_1 = require("./s3-bucket-deployments");
const stepfunctions_state_machines_1 = require("./stepfunctions-state-machines");
const private_1 = require("../io/private");
const plugin_1 = require("../plugin");
const toolkit_error_1 = require("../toolkit-error");
// Must use a require() otherwise esbuild complains about calling a namespace
// eslint-disable-next-line @typescript-eslint/no-require-imports,@typescript-eslint/consistent-type-imports
const pLimit = require('p-limit');
const RESOURCE_DETECTORS = {
    // Lambda
    'AWS::Lambda::Function': lambda_functions_1.isHotswappableLambdaFunctionChange,
    'AWS::Lambda::Version': lambda_functions_1.isHotswappableLambdaFunctionChange,
    'AWS::Lambda::Alias': lambda_functions_1.isHotswappableLambdaFunctionChange,
    // AppSync
    'AWS::AppSync::Resolver': appsync_mapping_templates_1.isHotswappableAppSyncChange,
    'AWS::AppSync::FunctionConfiguration': appsync_mapping_templates_1.isHotswappableAppSyncChange,
    'AWS::AppSync::GraphQLSchema': appsync_mapping_templates_1.isHotswappableAppSyncChange,
    'AWS::AppSync::ApiKey': appsync_mapping_templates_1.isHotswappableAppSyncChange,
    'AWS::ECS::TaskDefinition': ecs_services_1.isHotswappableEcsServiceChange,
    'AWS::CodeBuild::Project': code_build_projects_1.isHotswappableCodeBuildProjectChange,
    'AWS::StepFunctions::StateMachine': stepfunctions_state_machines_1.isHotswappableStateMachineChange,
    'Custom::CDKBucketDeployment': s3_bucket_deployments_1.isHotswappableS3BucketDeploymentChange,
    'AWS::IAM::Policy': async (logicalId, change, evaluateCfnTemplate) => {
        // If the policy is for a S3BucketDeploymentChange, we can ignore the change
        if (await (0, s3_bucket_deployments_1.skipChangeForS3DeployCustomResourcePolicy)(logicalId, change, evaluateCfnTemplate)) {
            return [];
        }
        return [(0, common_1.nonHotswappableResource)(change)];
    },
    'AWS::CDK::Metadata': async () => [],
};
/**
 * Perform a hotswap deployment, short-circuiting CloudFormation if possible.
 * If it's not possible to short-circuit the deployment
 * (because the CDK Stack contains changes that cannot be deployed without CloudFormation),
 * returns `undefined`.
 */
async function tryHotswapDeployment(sdkProvider, ioHelper, assetParams, cloudFormationStack, stackArtifact, hotswapMode, hotswapPropertyOverrides) {
    const hotswapSpan = await ioHelper.span(private_1.SPAN.HOTSWAP).begin({
        stack: stackArtifact,
        mode: hotswapMode,
    });
    const result = await hotswapDeployment(sdkProvider, hotswapSpan, assetParams, stackArtifact, hotswapMode, hotswapPropertyOverrides);
    await hotswapSpan.end(result);
    if (result?.hotswapped === true) {
        return {
            type: 'did-deploy-stack',
            noOp: result.hotswappableChanges.length === 0,
            stackArn: cloudFormationStack.stackId,
            outputs: cloudFormationStack.outputs,
        };
    }
    return undefined;
}
/**
 * Perform a hotswap deployment, short-circuiting CloudFormation if possible.
 * Returns information about the attempted hotswap deployment
 */
async function hotswapDeployment(sdkProvider, ioSpan, assetParams, stack, hotswapMode, hotswapPropertyOverrides) {
    // resolve the environment, so we can substitute things like AWS::Region in CFN expressions
    const resolvedEnv = await sdkProvider.resolveEnvironment(stack.environment);
    // create a new SDK using the CLI credentials, because the default one will not work for new-style synthesis -
    // it assumes the bootstrap deploy Role, which doesn't have permissions to update Lambda functions
    const sdk = (await sdkProvider.forEnvironment(resolvedEnv, plugin_1.Mode.ForWriting)).sdk;
    const currentTemplate = await (0, cloudformation_1.loadCurrentTemplateWithNestedStacks)(stack, sdk);
    const evaluateCfnTemplate = new cloudformation_1.EvaluateCloudFormationTemplate({
        stackArtifact: stack,
        parameters: assetParams,
        account: resolvedEnv.account,
        region: resolvedEnv.region,
        partition: (await sdk.currentAccount()).partition,
        sdk,
        nestedStacks: currentTemplate.nestedStacks,
    });
    const stackChanges = cfn_diff.fullDiff(currentTemplate.deployedRootTemplate, stack.template);
    const { hotswappable, nonHotswappable } = await classifyResourceChanges(stackChanges, evaluateCfnTemplate, sdk, currentTemplate.nestedStacks, hotswapPropertyOverrides);
    await logRejectedChanges(ioSpan, nonHotswappable, hotswapMode);
    const hotswappableChanges = hotswappable.map(o => o.change);
    const nonHotswappableChanges = nonHotswappable.map(n => n.change);
    await ioSpan.notify(private_1.IO.CDK_TOOLKIT_I5401.msg('Hotswap plan created', {
        stack,
        mode: hotswapMode,
        hotswappableChanges,
        nonHotswappableChanges,
    }));
    // preserve classic hotswap behavior
    if (hotswapMode === 'fall-back') {
        if (nonHotswappableChanges.length > 0) {
            return {
                stack,
                mode: hotswapMode,
                hotswapped: false,
                hotswappableChanges,
                nonHotswappableChanges,
            };
        }
    }
    // apply the short-circuitable changes
    await applyAllHotswapOperations(sdk, ioSpan, hotswappable);
    return {
        stack,
        mode: hotswapMode,
        hotswapped: true,
        hotswappableChanges,
        nonHotswappableChanges,
    };
}
/**
 * Classifies all changes to all resources as either hotswappable or not.
 * Metadata changes are excluded from the list of (non)hotswappable resources.
 */
async function classifyResourceChanges(stackChanges, evaluateCfnTemplate, sdk, nestedStackNames, hotswapPropertyOverrides) {
    const resourceDifferences = getStackResourceDifferences(stackChanges);
    const promises = [];
    const hotswappableResources = new Array();
    const nonHotswappableResources = new Array();
    for (const logicalId of Object.keys(stackChanges.outputs.changes)) {
        nonHotswappableResources.push({
            hotswappable: false,
            change: {
                reason: payloads_1.NonHotswappableReason.OUTPUT,
                description: 'output was changed',
                subject: {
                    type: 'Output',
                    logicalId,
                    metadata: evaluateCfnTemplate.metadataFor(logicalId),
                },
            },
        });
    }
    // gather the results of the detector functions
    for (const [logicalId, change] of Object.entries(resourceDifferences)) {
        if (change.newValue?.Type === 'AWS::CloudFormation::Stack' && change.oldValue?.Type === 'AWS::CloudFormation::Stack') {
            const nestedHotswappableResources = await findNestedHotswappableChanges(logicalId, change, nestedStackNames, evaluateCfnTemplate, sdk, hotswapPropertyOverrides);
            hotswappableResources.push(...nestedHotswappableResources.hotswappable);
            nonHotswappableResources.push(...nestedHotswappableResources.nonHotswappable);
            continue;
        }
        const hotswappableChangeCandidate = isCandidateForHotswapping(logicalId, change, evaluateCfnTemplate);
        // we don't need to run this through the detector functions, we can already judge this
        if ('hotswappable' in hotswappableChangeCandidate) {
            if (!hotswappableChangeCandidate.hotswappable) {
                nonHotswappableResources.push(hotswappableChangeCandidate);
            }
            continue;
        }
        const resourceType = hotswappableChangeCandidate.newValue.Type;
        if (resourceType in RESOURCE_DETECTORS) {
            // run detector functions lazily to prevent unhandled promise rejections
            promises.push(() => RESOURCE_DETECTORS[resourceType](logicalId, hotswappableChangeCandidate, evaluateCfnTemplate, hotswapPropertyOverrides));
        }
        else {
            nonHotswappableResources.push((0, common_1.nonHotswappableResource)(hotswappableChangeCandidate));
        }
    }
    // resolve all detector results
    const changesDetectionResults = [];
    for (const detectorResultPromises of promises) {
        // Constant set of promises per resource
        // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
        const hotswapDetectionResults = await Promise.all(await detectorResultPromises());
        changesDetectionResults.push(hotswapDetectionResults);
    }
    for (const resourceDetectionResults of changesDetectionResults) {
        for (const propertyResult of resourceDetectionResults) {
            propertyResult.hotswappable
                ? hotswappableResources.push(propertyResult)
                : nonHotswappableResources.push(propertyResult);
        }
    }
    return {
        hotswappable: hotswappableResources,
        nonHotswappable: nonHotswappableResources,
    };
}
/**
 * Returns all changes to resources in the given Stack.
 *
 * @param stackChanges the collection of all changes to a given Stack
 */
function getStackResourceDifferences(stackChanges) {
    // we need to collapse logical ID rename changes into one change,
    // as they are represented in stackChanges as a pair of two changes: one addition and one removal
    const allResourceChanges = stackChanges.resources.changes;
    const allRemovalChanges = filterDict(allResourceChanges, (resChange) => resChange.isRemoval);
    const allNonRemovalChanges = filterDict(allResourceChanges, (resChange) => !resChange.isRemoval);
    for (const [logId, nonRemovalChange] of Object.entries(allNonRemovalChanges)) {
        if (nonRemovalChange.isAddition) {
            const addChange = nonRemovalChange;
            // search for an identical removal change
            const identicalRemovalChange = Object.entries(allRemovalChanges).find(([_, remChange]) => {
                return changesAreForSameResource(remChange, addChange);
            });
            // if we found one, then this means this is a rename change
            if (identicalRemovalChange) {
                const [removedLogId, removedResourceChange] = identicalRemovalChange;
                allNonRemovalChanges[logId] = makeRenameDifference(removedResourceChange, addChange);
                // delete the removal change that forms the rename pair
                delete allRemovalChanges[removedLogId];
            }
        }
    }
    // the final result are all of the remaining removal changes,
    // plus all of the non-removal changes
    // (we saved the rename changes in that object already)
    return {
        ...allRemovalChanges,
        ...allNonRemovalChanges,
    };
}
/** Filters an object with string keys based on whether the callback returns 'true' for the given value in the object. */
function filterDict(dict, func) {
    return Object.entries(dict).reduce((acc, [key, t]) => {
        if (func(t)) {
            acc[key] = t;
        }
        return acc;
    }, {});
}
/** Finds any hotswappable changes in all nested stacks. */
async function findNestedHotswappableChanges(logicalId, change, nestedStackTemplates, evaluateCfnTemplate, sdk, hotswapPropertyOverrides) {
    const nestedStack = nestedStackTemplates[logicalId];
    if (!nestedStack.physicalName) {
        return {
            hotswappable: [],
            nonHotswappable: [
                {
                    hotswappable: false,
                    change: {
                        reason: payloads_1.NonHotswappableReason.NESTED_STACK_CREATION,
                        description: 'newly created nested stacks cannot be hotswapped',
                        subject: {
                            type: 'Resource',
                            logicalId,
                            resourceType: 'AWS::CloudFormation::Stack',
                            metadata: evaluateCfnTemplate.metadataFor(logicalId),
                        },
                    },
                },
            ],
        };
    }
    const evaluateNestedCfnTemplate = await evaluateCfnTemplate.createNestedEvaluateCloudFormationTemplate(nestedStack.physicalName, nestedStack.generatedTemplate, change.newValue?.Properties?.Parameters);
    const nestedDiff = cfn_diff.fullDiff(nestedStackTemplates[logicalId].deployedTemplate, nestedStackTemplates[logicalId].generatedTemplate);
    return classifyResourceChanges(nestedDiff, evaluateNestedCfnTemplate, sdk, nestedStackTemplates[logicalId].nestedStackTemplates, hotswapPropertyOverrides);
}
/** Returns 'true' if a pair of changes is for the same resource. */
function changesAreForSameResource(oldChange, newChange) {
    return (oldChange.oldResourceType === newChange.newResourceType &&
        // this isn't great, but I don't want to bring in something like underscore just for this comparison
        JSON.stringify(oldChange.oldProperties) === JSON.stringify(newChange.newProperties));
}
function makeRenameDifference(remChange, addChange) {
    return new cfn_diff.ResourceDifference(
    // we have to fill in the old value, because otherwise this will be classified as a non-hotswappable change
    remChange.oldValue, addChange.newValue, {
        resourceType: {
            oldType: remChange.oldResourceType,
            newType: addChange.newResourceType,
        },
        propertyDiffs: addChange.propertyDiffs,
        otherDiffs: addChange.otherDiffs,
    });
}
/**
 * Returns a `HotswappableChangeCandidate` if the change is hotswappable
 * Returns an empty `HotswappableChange` if the change is to CDK::Metadata
 * Returns a `NonHotswappableChange` if the change is not hotswappable
 */
function isCandidateForHotswapping(logicalId, change, evaluateCfnTemplate) {
    // a resource has been removed OR a resource has been added; we can't short-circuit that change
    if (!change.oldValue) {
        return {
            hotswappable: false,
            change: {
                reason: payloads_1.NonHotswappableReason.RESOURCE_CREATION,
                description: `resource '${logicalId}' was created by this deployment`,
                subject: {
                    type: 'Resource',
                    logicalId,
                    resourceType: change.newValue.Type,
                    metadata: evaluateCfnTemplate.metadataFor(logicalId),
                },
            },
        };
    }
    else if (!change.newValue) {
        return {
            hotswappable: false,
            logicalId,
            change: {
                reason: payloads_1.NonHotswappableReason.RESOURCE_DELETION,
                description: `resource '${logicalId}' was destroyed by this deployment`,
                subject: {
                    type: 'Resource',
                    logicalId,
                    resourceType: change.oldValue.Type,
                    metadata: evaluateCfnTemplate.metadataFor(logicalId),
                },
            },
        };
    }
    // a resource has had its type changed
    if (change.newValue.Type !== change.oldValue.Type) {
        return {
            hotswappable: false,
            change: {
                reason: payloads_1.NonHotswappableReason.RESOURCE_TYPE_CHANGED,
                description: `resource '${logicalId}' had its type changed from '${change.oldValue?.Type}' to '${change.newValue?.Type}'`,
                subject: {
                    type: 'Resource',
                    logicalId,
                    resourceType: change.newValue.Type,
                    metadata: evaluateCfnTemplate.metadataFor(logicalId),
                },
            },
        };
    }
    return {
        logicalId,
        oldValue: change.oldValue,
        newValue: change.newValue,
        propertyUpdates: change.propertyUpdates,
        metadata: evaluateCfnTemplate.metadataFor(logicalId),
    };
}
async function applyAllHotswapOperations(sdk, ioSpan, hotswappableChanges) {
    if (hotswappableChanges.length === 0) {
        return Promise.resolve([]);
    }
    await ioSpan.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg(`\n${common_1.ICON} hotswapping resources:`));
    const limit = pLimit(10);
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    return Promise.all(hotswappableChanges.map(hotswapOperation => limit(() => {
        return applyHotswapOperation(sdk, ioSpan, hotswapOperation);
    })));
}
async function applyHotswapOperation(sdk, ioSpan, hotswapOperation) {
    // note the type of service that was successfully hotswapped in the User-Agent
    const customUserAgent = `cdk-hotswap/success-${hotswapOperation.service}`;
    sdk.appendCustomUserAgent(customUserAgent);
    const resourceText = (r) => r.description ?? `${r.resourceType} '${r.physicalName ?? r.logicalId}'`;
    await ioSpan.notify(private_1.IO.CDK_TOOLKIT_I5402.msg(hotswapOperation.change.resources.map(r => (0, util_1.format)(`   ${common_1.ICON} %s`, chalk.bold(resourceText(r)))).join('\n'), hotswapOperation.change));
    // if the SDK call fails, an error will be thrown by the SDK
    // and will prevent the green 'hotswapped!' text from being displayed
    try {
        await hotswapOperation.apply(sdk);
    }
    catch (e) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
            const result = JSON.parse((0, util_2.formatErrorMessage)(e));
            const error = new toolkit_error_1.ToolkitError(formatWaiterErrorResult(result));
            error.name = e.name;
            throw error;
        }
        throw e;
    }
    await ioSpan.notify(private_1.IO.CDK_TOOLKIT_I5403.msg(hotswapOperation.change.resources.map(r => (0, util_1.format)(`   ${common_1.ICON} %s %s`, chalk.bold(resourceText(r)), chalk.green('hotswapped!'))).join('\n'), hotswapOperation.change));
    sdk.removeCustomUserAgent(customUserAgent);
}
function formatWaiterErrorResult(result) {
    const main = [
        `Resource is not in the expected state due to waiter status: ${result.state}`,
        result.reason ? `${result.reason}.` : '',
    ].join('. ');
    if (result.observedResponses != null) {
        const observedResponses = Object
            .entries(result.observedResponses)
            .map(([msg, count]) => `  - ${msg} (${count})`)
            .join('\n');
        return `${main} Observed responses:\n${observedResponses}`;
    }
    return main;
}
async function logRejectedChanges(ioSpan, rejectedChanges, hotswapMode) {
    if (rejectedChanges.length === 0) {
        return;
    }
    /**
     * EKS Services can have a task definition that doesn't refer to the task definition being updated.
     * We have to log this as a non-hotswappable change to the task definition, but when we do,
     * we wind up hotswapping the task definition and logging it as a non-hotswappable change.
     *
     * This logic prevents us from logging that change as non-hotswappable when we hotswap it.
     */
    if (hotswapMode === 'hotswap-only') {
        rejectedChanges = rejectedChanges.filter((change) => change.hotswapOnlyVisible === true);
        if (rejectedChanges.length === 0) {
            return;
        }
    }
    const messages = ['']; // start with empty line
    if (hotswapMode === 'hotswap-only') {
        messages.push((0, util_1.format)('%s %s', chalk.red('⚠️'), chalk.red('The following non-hotswappable changes were found. To reconcile these using CloudFormation, specify --hotswap-fallback')));
    }
    else {
        messages.push((0, util_1.format)('%s %s', chalk.red('⚠️'), chalk.red('The following non-hotswappable changes were found:')));
    }
    for (const { change } of rejectedChanges) {
        messages.push('    ' + nonHotswappableChangeMessage(change));
    }
    messages.push(''); // newline
    await ioSpan.notify(private_1.IO.DEFAULT_TOOLKIT_INFO.msg(messages.join('\n')));
}
/**
 * Formats a NonHotswappableChange
 */
function nonHotswappableChangeMessage(change) {
    const subject = change.subject;
    const reason = change.description ?? change.reason;
    switch (subject.type) {
        case 'Output':
            return (0, util_1.format)('output: %s, reason: %s', chalk.bold(subject.logicalId), chalk.red(reason));
        case 'Resource':
            return nonHotswappableResourceMessage(subject, reason);
    }
}
/**
 * Formats a non-hotswappable resource subject
 */
function nonHotswappableResourceMessage(subject, reason) {
    if (subject.rejectedProperties?.length) {
        return (0, util_1.format)('resource: %s, type: %s, rejected changes: %s, reason: %s', chalk.bold(subject.logicalId), chalk.bold(subject.resourceType), chalk.bold(subject.rejectedProperties), chalk.red(reason));
    }
    return (0, util_1.format)('resource: %s, type: %s, reason: %s', chalk.bold(subject.logicalId), chalk.bold(subject.resourceType), chalk.red(reason));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaG90c3dhcC1kZXBsb3ltZW50cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvaG90c3dhcC9ob3Rzd2FwLWRlcGxveW1lbnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBdUZBLG9EQW1DQztBQTFIRCwrQkFBOEI7QUFDOUIseURBQXlEO0FBR3pELCtCQUErQjtBQUUvQiw2Q0FBdUQ7QUFDdkQscUNBQWdEO0FBR2hELHNEQUF3RztBQUN4RywyRUFBMEU7QUFDMUUsK0RBQTZFO0FBTzdFLHFDQUdrQjtBQUNsQixpREFBZ0U7QUFDaEUseURBQXdFO0FBQ3hFLG1FQUdpQztBQUNqQyxpRkFBa0Y7QUFFbEYsMkNBQXlDO0FBRXpDLHNDQUFpQztBQUNqQyxvREFBZ0Q7QUFFaEQsNkVBQTZFO0FBQzdFLDRHQUE0RztBQUM1RyxNQUFNLE1BQU0sR0FBNkIsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0FBVzVELE1BQU0sa0JBQWtCLEdBQXVDO0lBQzdELFNBQVM7SUFDVCx1QkFBdUIsRUFBRSxxREFBa0M7SUFDM0Qsc0JBQXNCLEVBQUUscURBQWtDO0lBQzFELG9CQUFvQixFQUFFLHFEQUFrQztJQUV4RCxVQUFVO0lBQ1Ysd0JBQXdCLEVBQUUsdURBQTJCO0lBQ3JELHFDQUFxQyxFQUFFLHVEQUEyQjtJQUNsRSw2QkFBNkIsRUFBRSx1REFBMkI7SUFDMUQsc0JBQXNCLEVBQUUsdURBQTJCO0lBRW5ELDBCQUEwQixFQUFFLDZDQUE4QjtJQUMxRCx5QkFBeUIsRUFBRSwwREFBb0M7SUFDL0Qsa0NBQWtDLEVBQUUsK0RBQWdDO0lBQ3BFLDZCQUE2QixFQUFFLDhEQUFzQztJQUNyRSxrQkFBa0IsRUFBRSxLQUFLLEVBQ3ZCLFNBQWlCLEVBQ2pCLE1BQXNCLEVBQ3RCLG1CQUFtRCxFQUN6QixFQUFFO1FBQzVCLDRFQUE0RTtRQUM1RSxJQUFJLE1BQU0sSUFBQSxpRUFBeUMsRUFBQyxTQUFTLEVBQUUsTUFBTSxFQUFFLG1C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O1FBQ0osS0FBSyxVQUFVO1lBQ2IsT0FBTyw4QkFBOEIsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDM0QsQ0FBQztBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsOEJBQThCLENBQUMsT0FBd0IsRUFBRSxNQUFjO0lBQzlFLElBQUksT0FBTyxDQUFDLGtCQUFrQixFQUFFLE1BQU0sRUFBRSxDQUFDO1FBQ3ZDLE9BQU8sSUFBQSxhQUFNLEVBQ1gsMERBQTBELEVBQzFELEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxFQUM3QixLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsRUFDaEMsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsRUFDdEMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FDbEIsQ0FBQztJQUNKLENBQUM7SUFFRCxPQUFPLElBQUEsYUFBTSxFQUNYLG9DQUFvQyxFQUNwQyxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsRUFDN0IsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEVBQ2hDLEtBQUssQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQ2xCLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZm9ybWF0IH0gZnJvbSAndXRpbCc7XG5pbXBvcnQgKiBhcyBjZm5fZGlmZiBmcm9tICdAYXdzLWNkay9jbG91ZGZvcm1hdGlvbi1kaWZmJztcbmltcG9ydCB0eXBlICogYXMgY3hhcGkgZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB0eXBlIHsgV2FpdGVyUmVzdWx0IH0gZnJvbSAnQHNtaXRoeS91dGlsLXdhaXRlcic7XG5pbXBvcnQgKiBhcyBjaGFsayBmcm9tICdjaGFsayc7XG5pbXBvcnQgdHlwZSB7IEFmZmVjdGVkUmVzb3VyY2UsIEhvdHN3YXBSZXN1bHQsIFJlc291cmNlU3ViamVjdCwgUmVzb3VyY2VDaGFuZ2UsIE5vbkhvdHN3YXBwYWJsZUNoYW5nZSB9IGZyb20gJy4uLy4uL3BheWxvYWRzJztcbmltcG9ydCB7IE5vbkhvdHN3YXBwYWJsZVJlYXNvbiB9IGZyb20gJy4uLy4uL3BheWxvYWRzJztcbmltcG9ydCB7IGZvcm1hdEVycm9yTWVzc2FnZSB9IGZyb20gJy4uLy4uL3V0aWwnO1xuaW1wb3J0IHR5cGUgeyBTREssIFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHR5cGUgeyBDbG91ZEZvcm1hdGlvblN0YWNrLCBOZXN0ZWRTdGFja1RlbXBsYXRlcyB9IGZyb20gJy4uL2Nsb3VkZm9ybWF0aW9uJztcbmltcG9ydCB7IGxvYWRDdXJyZW50VGVtcGxhdGVXaXRoTmVzdGVkU3RhY2tzLCBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUgfSBmcm9tICcuLi9jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgeyBpc0hvdHN3YXBwYWJsZUFwcFN5bmNDaGFuZ2UgfSBmcm9tICcuL2FwcHN5bmMtbWFwcGluZy10ZW1wbGF0ZXMnO1xuaW1wb3J0IHsgaXNIb3Rzd2FwcGFibGVDb2RlQnVpbGRQcm9qZWN0Q2hhbmdlIH0gZnJvbSAnLi9jb2RlLWJ1aWxkLXByb2plY3RzJztcbmltcG9ydCB0eXBlIHtcbiAgSG90c3dhcENoYW5nZSxcbiAgSG90c3dhcE9wZXJhdGlvbixcbiAgUmVqZWN0ZWRDaGFuZ2UsXG4gIEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHtcbiAgSUNPTixcbiAgbm9uSG90c3dhcHBhYmxlUmVzb3VyY2UsXG59IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IGlzSG90c3dhcHBhYmxlRWNzU2VydmljZUNoYW5nZSB9IGZyb20gJy4vZWNzLXNlcnZpY2VzJztcbmltcG9ydCB7IGlzSG90c3dhcHBhYmxlTGFtYmRhRnVuY3Rpb25DaGFuZ2UgfSBmcm9tICcuL2xhbWJkYS1mdW5jdGlvbnMnO1xuaW1wb3J0IHtcbiAgc2tpcENoYW5nZUZvclMzRGVwbG95Q3VzdG9tUmVzb3VyY2VQb2xpY3ksXG4gIGlzSG90c3dhcHBhYmxlUzNCdWNrZXREZXBsb3ltZW50Q2hhbmdlLFxufSBmcm9tICcuL3MzLWJ1Y2tldC1kZXBsb3ltZW50cyc7XG5pbXBvcnQgeyBpc0hvdHN3YXBwYWJsZVN0YXRlTWFjaGluZUNoYW5nZSB9IGZyb20gJy4vc3RlcGZ1bmN0aW9ucy1zdGF0ZS1tYWNoaW5lcyc7XG5pbXBvcnQgdHlwZSB7IFN1Y2Nlc3NmdWxEZXBsb3lTdGFja1Jlc3VsdCB9IGZyb20gJy4uL2RlcGxveW1lbnRzJztcbmltcG9ydCB7IElPLCBTUEFOIH0gZnJvbSAnLi4vaW8vcHJpdmF0ZSc7XG5pbXBvcnQgdHlwZSB7IElNZXNzYWdlU3BhbiwgSW9IZWxwZXIgfSBmcm9tICcuLi9pby9wcml2YXRlJztcbmltcG9ydCB7IE1vZGUgfSBmcm9tICcuLi9wbHVnaW4nO1xuaW1wb3J0IHsgVG9vbGtpdEVycm9yIH0gZnJvbSAnLi4vdG9vbGtpdC1lcnJvcic7XG5cbi8vIE11c3QgdXNlIGEgcmVxdWlyZSgpIG90aGVyd2lzZSBlc2J1aWxkIGNvbXBsYWlucyBhYm91dCBjYWxsaW5nIGEgbmFtZXNwYWNlXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLXJlcXVpcmUtaW1wb3J0cyxAdHlwZXNjcmlwdC1lc2xpbnQvY29uc2lzdGVudC10eXBlLWltcG9ydHNcbmNvbnN0IHBMaW1pdDogdHlwZW9mIGltcG9ydCgncC1saW1pdCcpID0gcmVxdWlyZSgncC1saW1pdCcpO1xuXG50eXBlIEhvdHN3YXBEZXRlY3RvciA9IChcbiAgbG9naWNhbElkOiBzdHJpbmcsXG4gIGNoYW5nZTogUmVzb3VyY2VDaGFuZ2UsXG4gIGV2YWx1YXRlQ2ZuVGVtcGxhdGU6IEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZSxcbiAgaG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzOiBIb3Rzd2FwUHJvcGVydHlPdmVycmlkZXMsXG4pID0+IFByb21pc2U8SG90c3dhcENoYW5nZVtdPjtcblxudHlwZSBIb3Rzd2FwTW9kZSA9ICdob3Rzd2FwLW9ubHknIHwgJ2ZhbGwtYmFjayc7XG5cbmNvbnN0IFJFU09VUkNFX0RFVEVDVE9SUzogeyBba2V5OiBzdHJpbmddOiBIb3Rzd2FwRGV0ZWN0b3IgfSA9IHtcbiAgLy8gTGFtYmRhXG4gICdBV1M6OkxhbWJkYTo6RnVuY3Rpb24nOiBpc0hvdHN3YXBwYWJsZUxhbWJkYUZ1bmN0aW9uQ2hhbmdlLFxuICAnQVdTOjpMYW1iZGE6OlZlcnNpb24nOiBpc0hvdHN3YXBwYWJsZUxhbWJkYUZ1bmN0aW9uQ2hhbmdlLFxuICAnQVdTOjpMYW1iZGE6OkFsaWFzJzogaXNIb3Rzd2FwcGFibGVMYW1iZGFGdW5jdGlvbkNoYW5nZSxcblxuICAvLyBBcHBTeW5jXG4gICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJzogaXNIb3Rzd2FwcGFibGVBcHBTeW5jQ2hhbmdlLFxuICAnQVdTOjpBcHBTeW5jOjpGdW5jdGlvbkNvbmZpZ3VyYXRpb24nOiBpc0hvdHN3YXBwYWJsZUFwcFN5bmNDaGFuZ2UsXG4gICdBV1M6OkFwcFN5bmM6OkdyYXBoUUxTY2hlbWEnOiBpc0hvdHN3YXBwYWJsZUFwcFN5bmNDaGFuZ2UsXG4gICdBV1M6OkFwcFN5bmM6OkFwaUtleSc6IGlzSG90c3dhcHBhYmxlQXBwU3luY0NoYW5nZSxcblxuICAnQVdTOjpFQ1M6OlRhc2tEZWZpbml0aW9uJzogaXNIb3Rzd2FwcGFibGVFY3NTZXJ2aWNlQ2hhbmdlLFxuICAnQVdTOjpDb2RlQnVpbGQ6OlByb2plY3QnOiBpc0hvdHN3YXBwYWJsZUNvZGVCdWlsZFByb2plY3RDaGFuZ2UsXG4gICdBV1M6OlN0ZXBGdW5jdGlvbnM6OlN0YXRlTWFjaGluZSc6IGlzSG90c3dhcHBhYmxlU3RhdGVNYWNoaW5lQ2hhbmdlLFxuICAnQ3VzdG9tOjpDREtCdWNrZXREZXBsb3ltZW50JzogaXNIb3Rzd2FwcGFibGVTM0J1Y2tldERlcGxveW1lbnRDaGFuZ2UsXG4gICdBV1M6OklBTTo6UG9saWN5JzogYXN5bmMgKFxuICAgIGxvZ2ljYWxJZDogc3RyaW5nLFxuICAgIGNoYW5nZTogUmVzb3VyY2VDaGFuZ2UsXG4gICAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuICApOiBQcm9taXNlPEhvdHN3YXBDaGFuZ2VbXT4gPT4ge1xuICAgIC8vIElmIHRoZSBwb2xpY3kgaXMgZm9yIGEgUzNCdWNrZXREZXBsb3ltZW50Q2hhbmdlLCB3ZSBjYW4gaWdub3JlIHRoZSBjaGFuZ2VcbiAgICBpZiAoYXdhaXQgc2tpcENoYW5nZUZvclMzRGVwbG95Q3VzdG9tUmVzb3VyY2VQb2xpY3kobG9naWNhbElkLCBjaGFuZ2UsIGV2YWx1YXRlQ2ZuVGVtcGxhdGUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgcmV0dXJuIFtub25Ib3Rzd2FwcGFibGVSZXNvdXJjZShjaGFuZ2UpXTtcbiAgfSxcblxuICAnQVdTOjpDREs6Ok1ldGFkYXRhJzogYXN5bmMgKCkgPT4gW10sXG59O1xuXG4vKipcbiAqIFBlcmZvcm0gYSBob3Rzd2FwIGRlcGxveW1lbnQsIHNob3J0LWNpcmN1aXRpbmcgQ2xvdWRGb3JtYXRpb24gaWYgcG9zc2libGUuXG4gKiBJZiBpdCdzIG5vdCBwb3NzaWJsZSB0byBzaG9ydC1jaXJjdWl0IHRoZSBkZXBsb3ltZW50XG4gKiAoYmVjYXVzZSB0aGUgQ0RLIFN0YWNrIGNvbnRhaW5zIGNoYW5nZXMgdGhhdCBjYW5ub3QgYmUgZGVwbG95ZWQgd2l0aG91dCBDbG91ZEZvcm1hdGlvbiksXG4gKiByZXR1cm5zIGB1bmRlZmluZWRgLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdHJ5SG90c3dhcERlcGxveW1lbnQoXG4gIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbiAgaW9IZWxwZXI6IElvSGVscGVyLFxuICBhc3NldFBhcmFtczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSxcbiAgY2xvdWRGb3JtYXRpb25TdGFjazogQ2xvdWRGb3JtYXRpb25TdGFjayxcbiAgc3RhY2tBcnRpZmFjdDogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LFxuICBob3Rzd2FwTW9kZTogSG90c3dhcE1vZGUsXG4gIGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlczogSG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzLFxuKTogUHJvbWlzZTxTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgaG90c3dhcFNwYW4gPSBhd2FpdCBpb0hlbHBlci5zcGFuKFNQQU4uSE9UU1dBUCkuYmVnaW4oe1xuICAgIHN0YWNrOiBzdGFja0FydGlmYWN0LFxuICAgIG1vZGU6IGhvdHN3YXBNb2RlLFxuICB9KTtcblxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBob3Rzd2FwRGVwbG95bWVudChcbiAgICBzZGtQcm92aWRlcixcbiAgICBob3Rzd2FwU3BhbixcbiAgICBhc3NldFBhcmFtcyxcbiAgICBzdGFja0FydGlmYWN0LFxuICAgIGhvdHN3YXBNb2RlLFxuICAgIGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyxcbiAgKTtcblxuICBhd2FpdCBob3Rzd2FwU3Bhbi5lbmQocmVzdWx0KTtcblxuICBpZiAocmVzdWx0Py5ob3Rzd2FwcGVkID09PSB0cnVlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6ICdkaWQtZGVwbG95LXN0YWNrJyxcbiAgICAgIG5vT3A6IHJlc3VsdC5ob3Rzd2FwcGFibGVDaGFuZ2VzLmxlbmd0aCA9PT0gMCxcbiAgICAgIHN0YWNrQXJuOiBjbG91ZEZvcm1hdGlvblN0YWNrLnN0YWNrSWQsXG4gICAgICBvdXRwdXRzOiBjbG91ZEZvcm1hdGlvblN0YWNrLm91dHB1dHMsXG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogUGVyZm9ybSBhIGhvdHN3YXAgZGVwbG95bWVudCwgc2hvcnQtY2lyY3VpdGluZyBDbG91ZEZvcm1hdGlvbiBpZiBwb3NzaWJsZS5cbiAqIFJldHVybnMgaW5mb3JtYXRpb24gYWJvdXQgdGhlIGF0dGVtcHRlZCBob3Rzd2FwIGRlcGxveW1lbnRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gaG90c3dhcERlcGxveW1lbnQoXG4gIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbiAgaW9TcGFuOiBJTWVzc2FnZVNwYW48YW55PixcbiAgYXNzZXRQYXJhbXM6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0sXG4gIHN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QsXG4gIGhvdHN3YXBNb2RlOiBIb3Rzd2FwTW9kZSxcbiAgaG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzOiBIb3Rzd2FwUHJvcGVydHlPdmVycmlkZXMsXG4pOiBQcm9taXNlPE9taXQ8SG90c3dhcFJlc3VsdCwgJ2R1cmF0aW9uJz4+IHtcbiAgLy8gcmVzb2x2ZSB0aGUgZW52aXJvbm1lbnQsIHNvIHdlIGNhbiBzdWJzdGl0dXRlIHRoaW5ncyBsaWtlIEFXUzo6UmVnaW9uIGluIENGTiBleHByZXNzaW9uc1xuICBjb25zdCByZXNvbHZlZEVudiA9IGF3YWl0IHNka1Byb3ZpZGVyLnJlc29sdmVFbnZpcm9ubWVudChzdGFjay5lbnZpcm9ubWVudCk7XG4gIC8vIGNyZWF0ZSBhIG5ldyBTREsgdXNpbmcgdGhlIENMSSBjcmVkZW50aWFscywgYmVjYXVzZSB0aGUgZGVmYXVsdCBvbmUgd2lsbCBub3Qgd29yayBmb3IgbmV3LXN0eWxlIHN5bnRoZXNpcyAtXG4gIC8vIGl0IGFzc3VtZXMgdGhlIGJvb3RzdHJhcCBkZXBsb3kgUm9sZSwgd2hpY2ggZG9lc24ndCBoYXZlIHBlcm1pc3Npb25zIHRvIHVwZGF0ZSBMYW1iZGEgZnVuY3Rpb25zXG4gIGNvbnN0IHNkayA9IChhd2FpdCBzZGtQcm92aWRlci5mb3JFbnZpcm9ubWVudChyZXNvbHZlZEVudiwgTW9kZS5Gb3JXcml0aW5nKSkuc2RrO1xuXG4gIGNvbnN0IGN1cnJlbnRUZW1wbGF0ZSA9IGF3YWl0IGxvYWRDdXJyZW50VGVtcGxhdGVXaXRoTmVzdGVkU3RhY2tzKHN0YWNrLCBzZGspO1xuXG4gIGNvbnN0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUgPSBuZXcgRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlKHtcbiAgICBzdGFja0FydGlmYWN0OiBzdGFjayxcbiAgICBwYXJhbWV0ZXJzOiBhc3NldFBhcmFtcyxcbiAgICBhY2NvdW50OiByZXNvbHZlZEVudi5hY2NvdW50LFxuICAgIHJlZ2lvbjogcmVzb2x2ZWRFbnYucmVnaW9uLFxuICAgIHBhcnRpdGlvbjogKGF3YWl0IHNkay5jdXJyZW50QWNjb3VudCgpKS5wYXJ0aXRpb24sXG4gICAgc2RrLFxuICAgIG5lc3RlZFN0YWNrczogY3VycmVudFRlbXBsYXRlLm5lc3RlZFN0YWNrcyxcbiAgfSk7XG5cbiAgY29uc3Qgc3RhY2tDaGFuZ2VzID0gY2ZuX2RpZmYuZnVsbERpZmYoY3VycmVudFRlbXBsYXRlLmRlcGxveWVkUm9vdFRlbXBsYXRlLCBzdGFjay50ZW1wbGF0ZSk7XG4gIGNvbnN0IHsgaG90c3dhcHBhYmxlLCBub25Ib3Rzd2FwcGFibGUgfSA9IGF3YWl0IGNsYXNzaWZ5UmVzb3VyY2VDaGFuZ2VzKFxuICAgIHN0YWNrQ2hhbmdlcyxcbiAgICBldmFsdWF0ZUNmblRlbXBsYXRlLFxuICAgIHNkayxcbiAgICBjdXJyZW50VGVtcGxhdGUubmVzdGVkU3RhY2tzLCBob3Rzd2FwUHJvcGVydHlPdmVycmlkZXMsXG4gICk7XG5cbiAgYXdhaXQgbG9nUmVqZWN0ZWRDaGFuZ2VzKGlvU3Bhbiwgbm9uSG90c3dhcHBhYmxlLCBob3Rzd2FwTW9kZSk7XG5cbiAgY29uc3QgaG90c3dhcHBhYmxlQ2hhbmdlcyA9IGhvdHN3YXBwYWJsZS5tYXAobyA9PiBvLmNoYW5nZSk7XG4gIGNvbnN0IG5vbkhvdHN3YXBwYWJsZUNoYW5nZXMgPSBub25Ib3Rzd2FwcGFibGUubWFwKG4gPT4gbi5jaGFuZ2UpO1xuXG4gIGF3YWl0IGlvU3Bhbi5ub3RpZnkoSU8uQ0RLX1RPT0xLSVRfSTU0MDEubXNnKCdIb3Rzd2FwIHBsYW4gY3JlYXRlZCcsIHtcbiAgICBzdGFjayxcbiAgICBtb2RlOiBob3Rzd2FwTW9kZSxcbiAgICBob3Rzd2FwcGFibGVDaGFuZ2VzLFxuICAgIG5vbkhvdHN3YXBwYWJsZUNoYW5nZXMsXG4gIH0pKTtcblxuICAvLyBwcmVzZXJ2ZSBjbGFzc2ljIGhvdHN3YXAgYmVoYXZpb3JcbiAgaWYgKGhvdHN3YXBNb2RlID09PSAnZmFsbC1iYWNrJykge1xuICAgIGlmIChub25Ib3Rzd2FwcGFibGVDaGFuZ2VzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YWNrLFxuICAgICAgICBtb2RlOiBob3Rzd2FwTW9kZSxcbiAgICAgICAgaG90c3dhcHBlZDogZmFsc2UsXG4gICAgICAgIGhvdHN3YXBwYWJsZUNoYW5nZXMsXG4gICAgICAgIG5vbkhvdHN3YXBwYWJsZUNoYW5nZXMsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIGFwcGx5IHRoZSBzaG9ydC1jaXJjdWl0YWJsZSBjaGFuZ2VzXG4gIGF3YWl0IGFwcGx5QWxsSG90c3dhcE9wZXJhdGlvbnMoc2RrLCBpb1NwYW4sIGhvdHN3YXBwYWJsZSk7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGFjayxcbiAgICBtb2RlOiBob3Rzd2FwTW9kZSxcbiAgICBob3Rzd2FwcGVkOiB0cnVlLFxuICAgIGhvdHN3YXBwYWJsZUNoYW5nZXMsXG4gICAgbm9uSG90c3dhcHBhYmxlQ2hhbmdlcyxcbiAgfTtcbn1cblxuaW50ZXJmYWNlIENsYXNzaWZpZWRDaGFuZ2VzIHtcbiAgaG90c3dhcHBhYmxlOiBIb3Rzd2FwT3BlcmF0aW9uW107XG4gIG5vbkhvdHN3YXBwYWJsZTogUmVqZWN0ZWRDaGFuZ2VbXTtcbn1cblxuLyoqXG4gKiBDbGFzc2lmaWVzIGFsbCBjaGFuZ2VzIHRvIGFsbCByZXNvdXJjZXMgYXMgZWl0aGVyIGhvdHN3YXBwYWJsZSBvciBub3QuXG4gKiBNZXRhZGF0YSBjaGFuZ2VzIGFyZSBleGNsdWRlZCBmcm9tIHRoZSBsaXN0IG9mIChub24paG90c3dhcHBhYmxlIHJlc291cmNlcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY2xhc3NpZnlSZXNvdXJjZUNoYW5nZXMoXG4gIHN0YWNrQ2hhbmdlczogY2ZuX2RpZmYuVGVtcGxhdGVEaWZmLFxuICBldmFsdWF0ZUNmblRlbXBsYXRlOiBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUsXG4gIHNkazogU0RLLFxuICBuZXN0ZWRTdGFja05hbWVzOiB7IFtuZXN0ZWRTdGFja05hbWU6IHN0cmluZ106IE5lc3RlZFN0YWNrVGVtcGxhdGVzIH0sXG4gIGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlczogSG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzLFxuKTogUHJvbWlzZTxDbGFzc2lmaWVkQ2hhbmdlcz4ge1xuICBjb25zdCByZXNvdXJjZURpZmZlcmVuY2VzID0gZ2V0U3RhY2tSZXNvdXJjZURpZmZlcmVuY2VzKHN0YWNrQ2hhbmdlcyk7XG5cbiAgY29uc3QgcHJvbWlzZXM6IEFycmF5PCgpID0+IFByb21pc2U8SG90c3dhcENoYW5nZVtdPj4gPSBbXTtcbiAgY29uc3QgaG90c3dhcHBhYmxlUmVzb3VyY2VzID0gbmV3IEFycmF5PEhvdHN3YXBPcGVyYXRpb24+KCk7XG4gIGNvbnN0IG5vbkhvdHN3YXBwYWJsZVJlc291cmNlcyA9IG5ldyBBcnJheTxSZWplY3RlZENoYW5nZT4oKTtcbiAgZm9yIChjb25zdCBsb2dpY2FsSWQgb2YgT2JqZWN0LmtleXMoc3RhY2tDaGFuZ2VzLm91dHB1dHMuY2hhbmdlcykpIHtcbiAgICBub25Ib3Rzd2FwcGFibGVSZXNvdXJjZXMucHVzaCh7XG4gICAgICBob3Rzd2FwcGFibGU6IGZhbHNlLFxuICAgICAgY2hhbmdlOiB7XG4gICAgICAgIHJlYXNvbjogTm9uSG90c3dhcHBhYmxlUmVhc29uLk9VVFBVVCxcbiAgICAgICAgZGVzY3JpcHRpb246ICdvdXRwdXQgd2FzIGNoYW5nZWQnLFxuICAgICAgICBzdWJqZWN0OiB7XG4gICAgICAgICAgdHlwZTogJ091dHB1dCcsXG4gICAgICAgICAgbG9naWNhbElkLFxuICAgICAgICAgIG1ldGFkYXRhOiBldmFsdWF0ZUNmblRlbXBsYXRlLm1ldGFkYXRhRm9yKGxvZ2ljYWxJZCksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG4gIC8vIGdhdGhlciB0aGUgcmVzdWx0cyBvZiB0aGUgZGV0ZWN0b3IgZnVuY3Rpb25zXG4gIGZvciAoY29uc3QgW2xvZ2ljYWxJZCwgY2hhbmdlXSBvZiBPYmplY3QuZW50cmllcyhyZXNvdXJjZURpZmZlcmVuY2VzKSkge1xuICAgIGlmIChjaGFuZ2UubmV3VmFsdWU/LlR5cGUgPT09ICdBV1M6OkNsb3VkRm9ybWF0aW9uOjpTdGFjaycgJiYgY2hhbmdlLm9sZFZhbHVlPy5UeXBlID09PSAnQVdTOjpDbG91ZEZvcm1hdGlvbjo6U3RhY2snKSB7XG4gICAgICBjb25zdCBuZXN0ZWRIb3Rzd2FwcGFibGVSZXNvdXJjZXMgPSBhd2FpdCBmaW5kTmVzdGVkSG90c3dhcHBhYmxlQ2hhbmdlcyhcbiAgICAgICAgbG9naWNhbElkLFxuICAgICAgICBjaGFuZ2UsXG4gICAgICAgIG5lc3RlZFN0YWNrTmFtZXMsXG4gICAgICAgIGV2YWx1YXRlQ2ZuVGVtcGxhdGUsXG4gICAgICAgIHNkayxcbiAgICAgICAgaG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzLFxuICAgICAgKTtcbiAgICAgIGhvdHN3YXBwYWJsZVJlc291cmNlcy5wdXNoKC4uLm5lc3RlZEhvdHN3YXBwYWJsZVJlc291cmNlcy5ob3Rzd2FwcGFibGUpO1xuICAgICAgbm9uSG90c3dhcHBhYmxlUmVzb3VyY2VzLnB1c2goLi4ubmVzdGVkSG90c3dhcHBhYmxlUmVzb3VyY2VzLm5vbkhvdHN3YXBwYWJsZSk7XG5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSA9IGlzQ2FuZGlkYXRlRm9ySG90c3dhcHBpbmcobG9naWNhbElkLCBjaGFuZ2UsIGV2YWx1YXRlQ2ZuVGVtcGxhdGUpO1xuICAgIC8vIHdlIGRvbid0IG5lZWQgdG8gcnVuIHRoaXMgdGhyb3VnaCB0aGUgZGV0ZWN0b3IgZnVuY3Rpb25zLCB3ZSBjYW4gYWxyZWFkeSBqdWRnZSB0aGlzXG4gICAgaWYgKCdob3Rzd2FwcGFibGUnIGluIGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSkge1xuICAgICAgaWYgKCFob3Rzd2FwcGFibGVDaGFuZ2VDYW5kaWRhdGUuaG90c3dhcHBhYmxlKSB7XG4gICAgICAgIG5vbkhvdHN3YXBwYWJsZVJlc291cmNlcy5wdXNoKGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlVHlwZTogc3RyaW5nID0gaG90c3dhcHBhYmxlQ2hhbmdlQ2FuZGlkYXRlLm5ld1ZhbHVlLlR5cGU7XG4gICAgaWYgKHJlc291cmNlVHlwZSBpbiBSRVNPVVJDRV9ERVRFQ1RPUlMpIHtcbiAgICAgIC8vIHJ1biBkZXRlY3RvciBmdW5jdGlvbnMgbGF6aWx5IHRvIHByZXZlbnQgdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uc1xuICAgICAgcHJvbWlzZXMucHVzaCgoKSA9PlxuICAgICAgICBSRVNPVVJDRV9ERVRFQ1RPUlNbcmVzb3VyY2VUeXBlXShsb2dpY2FsSWQsIGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSwgZXZhbHVhdGVDZm5UZW1wbGF0ZSwgaG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzKSxcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5vbkhvdHN3YXBwYWJsZVJlc291cmNlcy5wdXNoKG5vbkhvdHN3YXBwYWJsZVJlc291cmNlKGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSkpO1xuICAgIH1cbiAgfVxuXG4gIC8vIHJlc29sdmUgYWxsIGRldGVjdG9yIHJlc3VsdHNcbiAgY29uc3QgY2hhbmdlc0RldGVjdGlvblJlc3VsdHM6IEFycmF5PEhvdHN3YXBDaGFuZ2VbXT4gPSBbXTtcbiAgZm9yIChjb25zdCBkZXRlY3RvclJlc3VsdFByb21pc2VzIG9mIHByb21pc2VzKSB7XG4gICAgLy8gQ29uc3RhbnQgc2V0IG9mIHByb21pc2VzIHBlciByZXNvdXJjZVxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAY2RrbGFicy9wcm9taXNlYWxsLW5vLXVuYm91bmRlZC1wYXJhbGxlbGlzbVxuICAgIGNvbnN0IGhvdHN3YXBEZXRlY3Rpb25SZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoYXdhaXQgZGV0ZWN0b3JSZXN1bHRQcm9taXNlcygpKTtcbiAgICBjaGFuZ2VzRGV0ZWN0aW9uUmVzdWx0cy5wdXNoKGhvdHN3YXBEZXRlY3Rpb25SZXN1bHRzKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgcmVzb3VyY2VEZXRlY3Rpb25SZXN1bHRzIG9mIGNoYW5nZXNEZXRlY3Rpb25SZXN1bHRzKSB7XG4gICAgZm9yIChjb25zdCBwcm9wZXJ0eVJlc3VsdCBvZiByZXNvdXJjZURldGVjdGlvblJlc3VsdHMpIHtcbiAgICAgIHByb3BlcnR5UmVzdWx0LmhvdHN3YXBwYWJsZVxuICAgICAgICA/IGhvdHN3YXBwYWJsZVJlc291cmNlcy5wdXNoKHByb3BlcnR5UmVzdWx0KVxuICAgICAgICA6IG5vbkhvdHN3YXBwYWJsZVJlc291cmNlcy5wdXNoKHByb3BlcnR5UmVzdWx0KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGhvdHN3YXBwYWJsZTogaG90c3dhcHBhYmxlUmVzb3VyY2VzLFxuICAgIG5vbkhvdHN3YXBwYWJsZTogbm9uSG90c3dhcHBhYmxlUmVzb3VyY2VzLFxuICB9O1xufVxuXG4vKipcbiAqIFJldHVybnMgYWxsIGNoYW5nZXMgdG8gcmVzb3VyY2VzIGluIHRoZSBnaXZlbiBTdGFjay5cbiAqXG4gKiBAcGFyYW0gc3RhY2tDaGFuZ2VzIHRoZSBjb2xsZWN0aW9uIG9mIGFsbCBjaGFuZ2VzIHRvIGEgZ2l2ZW4gU3RhY2tcbiAqL1xuZnVuY3Rpb24gZ2V0U3RhY2tSZXNvdXJjZURpZmZlcmVuY2VzKHN0YWNrQ2hhbmdlczogY2ZuX2RpZmYuVGVtcGxhdGVEaWZmKToge1xuICBbbG9naWNhbElkOiBzdHJpbmddOiBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2U7XG59IHtcbiAgLy8gd2UgbmVlZCB0byBjb2xsYXBzZSBsb2dpY2FsIElEIHJlbmFtZSBjaGFuZ2VzIGludG8gb25lIGNoYW5nZSxcbiAgLy8gYXMgdGhleSBhcmUgcmVwcmVzZW50ZWQgaW4gc3RhY2tDaGFuZ2VzIGFzIGEgcGFpciBvZiB0d28gY2hhbmdlczogb25lIGFkZGl0aW9uIGFuZCBvbmUgcmVtb3ZhbFxuICBjb25zdCBhbGxSZXNvdXJjZUNoYW5nZXM6IHsgW2xvZ0lkOiBzdHJpbmddOiBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2UgfSA9IHN0YWNrQ2hhbmdlcy5yZXNvdXJjZXMuY2hhbmdlcztcbiAgY29uc3QgYWxsUmVtb3ZhbENoYW5nZXMgPSBmaWx0ZXJEaWN0KGFsbFJlc291cmNlQ2hhbmdlcywgKHJlc0NoYW5nZSkgPT4gcmVzQ2hhbmdlLmlzUmVtb3ZhbCk7XG4gIGNvbnN0IGFsbE5vblJlbW92YWxDaGFuZ2VzID0gZmlsdGVyRGljdChhbGxSZXNvdXJjZUNoYW5nZXMsIChyZXNDaGFuZ2UpID0+ICFyZXNDaGFuZ2UuaXNSZW1vdmFsKTtcbiAgZm9yIChjb25zdCBbbG9nSWQsIG5vblJlbW92YWxDaGFuZ2VdIG9mIE9iamVjdC5lbnRyaWVzKGFsbE5vblJlbW92YWxDaGFuZ2VzKSkge1xuICAgIGlmIChub25SZW1vdmFsQ2hhbmdlLmlzQWRkaXRpb24pIHtcbiAgICAgIGNvbnN0IGFkZENoYW5nZSA9IG5vblJlbW92YWxDaGFuZ2U7XG4gICAgICAvLyBzZWFyY2ggZm9yIGFuIGlkZW50aWNhbCByZW1vdmFsIGNoYW5nZVxuICAgICAgY29uc3QgaWRlbnRpY2FsUmVtb3ZhbENoYW5nZSA9IE9iamVjdC5lbnRyaWVzKGFsbFJlbW92YWxDaGFuZ2VzKS5maW5kKChbXywgcmVtQ2hhbmdlXSkgPT4ge1xuICAgICAgICByZXR1cm4gY2hhbmdlc0FyZUZvclNhbWVSZXNvdXJjZShyZW1DaGFuZ2UsIGFkZENoYW5nZSk7XG4gICAgICB9KTtcbiAgICAgIC8vIGlmIHdlIGZvdW5kIG9uZSwgdGhlbiB0aGlzIG1lYW5zIHRoaXMgaXMgYSByZW5hbWUgY2hhbmdlXG4gICAgICBpZiAoaWRlbnRpY2FsUmVtb3ZhbENoYW5nZSkge1xuICAgICAgICBjb25zdCBbcmVtb3ZlZExvZ0lkLCByZW1vdmVkUmVzb3VyY2VDaGFuZ2VdID0gaWRlbnRpY2FsUmVtb3ZhbENoYW5nZTtcbiAgICAgICAgYWxsTm9uUmVtb3ZhbENoYW5nZXNbbG9nSWRdID0gbWFrZVJlbmFtZURpZmZlcmVuY2UocmVtb3ZlZFJlc291cmNlQ2hhbmdlLCBhZGRDaGFuZ2UpO1xuICAgICAgICAvLyBkZWxldGUgdGhlIHJlbW92YWwgY2hhbmdlIHRoYXQgZm9ybXMgdGhlIHJlbmFtZSBwYWlyXG4gICAgICAgIGRlbGV0ZSBhbGxSZW1vdmFsQ2hhbmdlc1tyZW1vdmVkTG9nSWRdO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvLyB0aGUgZmluYWwgcmVzdWx0IGFyZSBhbGwgb2YgdGhlIHJlbWFpbmluZyByZW1vdmFsIGNoYW5nZXMsXG4gIC8vIHBsdXMgYWxsIG9mIHRoZSBub24tcmVtb3ZhbCBjaGFuZ2VzXG4gIC8vICh3ZSBzYXZlZCB0aGUgcmVuYW1lIGNoYW5nZXMgaW4gdGhhdCBvYmplY3QgYWxyZWFkeSlcbiAgcmV0dXJuIHtcbiAgICAuLi5hbGxSZW1vdmFsQ2hhbmdlcyxcbiAgICAuLi5hbGxOb25SZW1vdmFsQ2hhbmdlcyxcbiAgfTtcbn1cblxuLyoqIEZpbHRlcnMgYW4gb2JqZWN0IHdpdGggc3RyaW5nIGtleXMgYmFzZWQgb24gd2hldGhlciB0aGUgY2FsbGJhY2sgcmV0dXJucyAndHJ1ZScgZm9yIHRoZSBnaXZlbiB2YWx1ZSBpbiB0aGUgb2JqZWN0LiAqL1xuZnVuY3Rpb24gZmlsdGVyRGljdDxUPihkaWN0OiB7IFtrZXk6IHN0cmluZ106IFQgfSwgZnVuYzogKHQ6IFQpID0+IGJvb2xlYW4pOiB7IFtrZXk6IHN0cmluZ106IFQgfSB7XG4gIHJldHVybiBPYmplY3QuZW50cmllcyhkaWN0KS5yZWR1Y2UoXG4gICAgKGFjYywgW2tleSwgdF0pID0+IHtcbiAgICAgIGlmIChmdW5jKHQpKSB7XG4gICAgICAgIGFjY1trZXldID0gdDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBhY2M7XG4gICAgfSxcbiAgICB7fSBhcyB7IFtrZXk6IHN0cmluZ106IFQgfSxcbiAgKTtcbn1cblxuLyoqIEZpbmRzIGFueSBob3Rzd2FwcGFibGUgY2hhbmdlcyBpbiBhbGwgbmVzdGVkIHN0YWNrcy4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZpbmROZXN0ZWRIb3Rzd2FwcGFibGVDaGFuZ2VzKFxuICBsb2dpY2FsSWQ6IHN0cmluZyxcbiAgY2hhbmdlOiBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2UsXG4gIG5lc3RlZFN0YWNrVGVtcGxhdGVzOiB7IFtuZXN0ZWRTdGFja05hbWU6IHN0cmluZ106IE5lc3RlZFN0YWNrVGVtcGxhdGVzIH0sXG4gIGV2YWx1YXRlQ2ZuVGVtcGxhdGU6IEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZSxcbiAgc2RrOiBTREssXG4gIGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlczogSG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzLFxuKTogUHJvbWlzZTxDbGFzc2lmaWVkQ2hhbmdlcz4ge1xuICBjb25zdCBuZXN0ZWRTdGFjayA9IG5lc3RlZFN0YWNrVGVtcGxhdGVzW2xvZ2ljYWxJZF07XG4gIGlmICghbmVzdGVkU3RhY2sucGh5c2ljYWxOYW1lKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhvdHN3YXBwYWJsZTogW10sXG4gICAgICBub25Ib3Rzd2FwcGFibGU6IFtcbiAgICAgICAge1xuICAgICAgICAgIGhvdHN3YXBwYWJsZTogZmFsc2UsXG4gICAgICAgICAgY2hhbmdlOiB7XG4gICAgICAgICAgICByZWFzb246IE5vbkhvdHN3YXBwYWJsZVJlYXNvbi5ORVNURURfU1RBQ0tfQ1JFQVRJT04sXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ25ld2x5IGNyZWF0ZWQgbmVzdGVkIHN0YWNrcyBjYW5ub3QgYmUgaG90c3dhcHBlZCcsXG4gICAgICAgICAgICBzdWJqZWN0OiB7XG4gICAgICAgICAgICAgIHR5cGU6ICdSZXNvdXJjZScsXG4gICAgICAgICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiAnQVdTOjpDbG91ZEZvcm1hdGlvbjo6U3RhY2snLFxuICAgICAgICAgICAgICBtZXRhZGF0YTogZXZhbHVhdGVDZm5UZW1wbGF0ZS5tZXRhZGF0YUZvcihsb2dpY2FsSWQpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgZXZhbHVhdGVOZXN0ZWRDZm5UZW1wbGF0ZSA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuY3JlYXRlTmVzdGVkRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlKFxuICAgIG5lc3RlZFN0YWNrLnBoeXNpY2FsTmFtZSxcbiAgICBuZXN0ZWRTdGFjay5nZW5lcmF0ZWRUZW1wbGF0ZSxcbiAgICBjaGFuZ2UubmV3VmFsdWU/LlByb3BlcnRpZXM/LlBhcmFtZXRlcnMsXG4gICk7XG5cbiAgY29uc3QgbmVzdGVkRGlmZiA9IGNmbl9kaWZmLmZ1bGxEaWZmKFxuICAgIG5lc3RlZFN0YWNrVGVtcGxhdGVzW2xvZ2ljYWxJZF0uZGVwbG95ZWRUZW1wbGF0ZSxcbiAgICBuZXN0ZWRTdGFja1RlbXBsYXRlc1tsb2dpY2FsSWRdLmdlbmVyYXRlZFRlbXBsYXRlLFxuICApO1xuXG4gIHJldHVybiBjbGFzc2lmeVJlc291cmNlQ2hhbmdlcyhcbiAgICBuZXN0ZWREaWZmLFxuICAgIGV2YWx1YXRlTmVzdGVkQ2ZuVGVtcGxhdGUsXG4gICAgc2RrLFxuICAgIG5lc3RlZFN0YWNrVGVtcGxhdGVzW2xvZ2ljYWxJZF0ubmVzdGVkU3RhY2tUZW1wbGF0ZXMsXG4gICAgaG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzLFxuICApO1xufVxuXG4vKiogUmV0dXJucyAndHJ1ZScgaWYgYSBwYWlyIG9mIGNoYW5nZXMgaXMgZm9yIHRoZSBzYW1lIHJlc291cmNlLiAqL1xuZnVuY3Rpb24gY2hhbmdlc0FyZUZvclNhbWVSZXNvdXJjZShcbiAgb2xkQ2hhbmdlOiBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2UsXG4gIG5ld0NoYW5nZTogY2ZuX2RpZmYuUmVzb3VyY2VEaWZmZXJlbmNlLFxuKTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgb2xkQ2hhbmdlLm9sZFJlc291cmNlVHlwZSA9PT0gbmV3Q2hhbmdlLm5ld1Jlc291cmNlVHlwZSAmJlxuICAgIC8vIHRoaXMgaXNuJ3QgZ3JlYXQsIGJ1dCBJIGRvbid0IHdhbnQgdG8gYnJpbmcgaW4gc29tZXRoaW5nIGxpa2UgdW5kZXJzY29yZSBqdXN0IGZvciB0aGlzIGNvbXBhcmlzb25cbiAgICBKU09OLnN0cmluZ2lmeShvbGRDaGFuZ2Uub2xkUHJvcGVydGllcykgPT09IEpTT04uc3RyaW5naWZ5KG5ld0NoYW5nZS5uZXdQcm9wZXJ0aWVzKVxuICApO1xufVxuXG5mdW5jdGlvbiBtYWtlUmVuYW1lRGlmZmVyZW5jZShcbiAgcmVtQ2hhbmdlOiBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2UsXG4gIGFkZENoYW5nZTogY2ZuX2RpZmYuUmVzb3VyY2VEaWZmZXJlbmNlLFxuKTogY2ZuX2RpZmYuUmVzb3VyY2VEaWZmZXJlbmNlIHtcbiAgcmV0dXJuIG5ldyBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2UoXG4gICAgLy8gd2UgaGF2ZSB0byBmaWxsIGluIHRoZSBvbGQgdmFsdWUsIGJlY2F1c2Ugb3RoZXJ3aXNlIHRoaXMgd2lsbCBiZSBjbGFzc2lmaWVkIGFzIGEgbm9uLWhvdHN3YXBwYWJsZSBjaGFuZ2VcbiAgICByZW1DaGFuZ2Uub2xkVmFsdWUsXG4gICAgYWRkQ2hhbmdlLm5ld1ZhbHVlLFxuICAgIHtcbiAgICAgIHJlc291cmNlVHlwZToge1xuICAgICAgICBvbGRUeXBlOiByZW1DaGFuZ2Uub2xkUmVzb3VyY2VUeXBlLFxuICAgICAgICBuZXdUeXBlOiBhZGRDaGFuZ2UubmV3UmVzb3VyY2VUeXBlLFxuICAgICAgfSxcbiAgICAgIHByb3BlcnR5RGlmZnM6IChhZGRDaGFuZ2UgYXMgYW55KS5wcm9wZXJ0eURpZmZzLFxuICAgICAgb3RoZXJEaWZmczogKGFkZENoYW5nZSBhcyBhbnkpLm90aGVyRGlmZnMsXG4gICAgfSxcbiAgKTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgYEhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZWAgaWYgdGhlIGNoYW5nZSBpcyBob3Rzd2FwcGFibGVcbiAqIFJldHVybnMgYW4gZW1wdHkgYEhvdHN3YXBwYWJsZUNoYW5nZWAgaWYgdGhlIGNoYW5nZSBpcyB0byBDREs6Ok1ldGFkYXRhXG4gKiBSZXR1cm5zIGEgYE5vbkhvdHN3YXBwYWJsZUNoYW5nZWAgaWYgdGhlIGNoYW5nZSBpcyBub3QgaG90c3dhcHBhYmxlXG4gKi9cbmZ1bmN0aW9uIGlzQ2FuZGlkYXRlRm9ySG90c3dhcHBpbmcoXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IGNmbl9kaWZmLlJlc291cmNlRGlmZmVyZW5jZSxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuKTogUmVqZWN0ZWRDaGFuZ2UgfCBSZXNvdXJjZUNoYW5nZSB7XG4gIC8vIGEgcmVzb3VyY2UgaGFzIGJlZW4gcmVtb3ZlZCBPUiBhIHJlc291cmNlIGhhcyBiZWVuIGFkZGVkOyB3ZSBjYW4ndCBzaG9ydC1jaXJjdWl0IHRoYXQgY2hhbmdlXG4gIGlmICghY2hhbmdlLm9sZFZhbHVlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhvdHN3YXBwYWJsZTogZmFsc2UsXG4gICAgICBjaGFuZ2U6IHtcbiAgICAgICAgcmVhc29uOiBOb25Ib3Rzd2FwcGFibGVSZWFzb24uUkVTT1VSQ0VfQ1JFQVRJT04sXG4gICAgICAgIGRlc2NyaXB0aW9uOiBgcmVzb3VyY2UgJyR7bG9naWNhbElkfScgd2FzIGNyZWF0ZWQgYnkgdGhpcyBkZXBsb3ltZW50YCxcbiAgICAgICAgc3ViamVjdDoge1xuICAgICAgICAgIHR5cGU6ICdSZXNvdXJjZScsXG4gICAgICAgICAgbG9naWNhbElkLFxuICAgICAgICAgIHJlc291cmNlVHlwZTogY2hhbmdlLm5ld1ZhbHVlIS5UeXBlLFxuICAgICAgICAgIG1ldGFkYXRhOiBldmFsdWF0ZUNmblRlbXBsYXRlLm1ldGFkYXRhRm9yKGxvZ2ljYWxJZCksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH07XG4gIH0gZWxzZSBpZiAoIWNoYW5nZS5uZXdWYWx1ZSkge1xuICAgIHJldHVybiB7XG4gICAgICBob3Rzd2FwcGFibGU6IGZhbHNlLFxuICAgICAgbG9naWNhbElkLFxuICAgICAgY2hhbmdlOiB7XG4gICAgICAgIHJlYXNvbjogTm9uSG90c3dhcHBhYmxlUmVhc29uLlJFU09VUkNFX0RFTEVUSU9OLFxuICAgICAgICBkZXNjcmlwdGlvbjogYHJlc291cmNlICcke2xvZ2ljYWxJZH0nIHdhcyBkZXN0cm95ZWQgYnkgdGhpcyBkZXBsb3ltZW50YCxcbiAgICAgICAgc3ViamVjdDoge1xuICAgICAgICAgIHR5cGU6ICdSZXNvdXJjZScsXG4gICAgICAgICAgbG9naWNhbElkLFxuICAgICAgICAgIHJlc291cmNlVHlwZTogY2hhbmdlLm9sZFZhbHVlLlR5cGUsXG4gICAgICAgICAgbWV0YWRhdGE6IGV2YWx1YXRlQ2ZuVGVtcGxhdGUubWV0YWRhdGFGb3IobG9naWNhbElkKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIC8vIGEgcmVzb3VyY2UgaGFzIGhhZCBpdHMgdHlwZSBjaGFuZ2VkXG4gIGlmIChjaGFuZ2UubmV3VmFsdWUuVHlwZSAhPT0gY2hhbmdlLm9sZFZhbHVlLlR5cGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaG90c3dhcHBhYmxlOiBmYWxzZSxcbiAgICAgIGNoYW5nZToge1xuICAgICAgICByZWFzb246IE5vbkhvdHN3YXBwYWJsZVJlYXNvbi5SRVNPVVJDRV9UWVBFX0NIQU5HRUQsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBgcmVzb3VyY2UgJyR7bG9naWNhbElkfScgaGFkIGl0cyB0eXBlIGNoYW5nZWQgZnJvbSAnJHtjaGFuZ2Uub2xkVmFsdWU/LlR5cGV9JyB0byAnJHtjaGFuZ2UubmV3VmFsdWU/LlR5cGV9J2AsXG4gICAgICAgIHN1YmplY3Q6IHtcbiAgICAgICAgICB0eXBlOiAnUmVzb3VyY2UnLFxuICAgICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgICByZXNvdXJjZVR5cGU6IGNoYW5nZS5uZXdWYWx1ZS5UeXBlLFxuICAgICAgICAgIG1ldGFkYXRhOiBldmFsdWF0ZUNmblRlbXBsYXRlLm1ldGFkYXRhRm9yKGxvZ2ljYWxJZCksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGxvZ2ljYWxJZCxcbiAgICBvbGRWYWx1ZTogY2hhbmdlLm9sZFZhbHVlLFxuICAgIG5ld1ZhbHVlOiBjaGFuZ2UubmV3VmFsdWUsXG4gICAgcHJvcGVydHlVcGRhdGVzOiBjaGFuZ2UucHJvcGVydHlVcGRhdGVzLFxuICAgIG1ldGFkYXRhOiBldmFsdWF0ZUNmblRlbXBsYXRlLm1ldGFkYXRhRm9yKGxvZ2ljYWxJZCksXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFwcGx5QWxsSG90c3dhcE9wZXJhdGlvbnMoc2RrOiBTREssIGlvU3BhbjogSU1lc3NhZ2VTcGFuPGFueT4sIGhvdHN3YXBwYWJsZUNoYW5nZXM6IEhvdHN3YXBPcGVyYXRpb25bXSk6IFByb21pc2U8dm9pZFtdPiB7XG4gIGlmIChob3Rzd2FwcGFibGVDaGFuZ2VzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoW10pO1xuICB9XG5cbiAgYXdhaXQgaW9TcGFuLm5vdGlmeShJTy5ERUZBVUxUX1RPT0xLSVRfSU5GTy5tc2coYFxcbiR7SUNPTn0gaG90c3dhcHBpbmcgcmVzb3VyY2VzOmApKTtcbiAgY29uc3QgbGltaXQgPSBwTGltaXQoMTApO1xuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQGNka2xhYnMvcHJvbWlzZWFsbC1uby11bmJvdW5kZWQtcGFyYWxsZWxpc21cbiAgcmV0dXJuIFByb21pc2UuYWxsKGhvdHN3YXBwYWJsZUNoYW5nZXMubWFwKGhvdHN3YXBPcGVyYXRpb24gPT4gbGltaXQoKCkgPT4ge1xuICAgIHJldHVybiBhcHBseUhvdHN3YXBPcGVyYXRpb24oc2RrLCBpb1NwYW4sIGhvdHN3YXBPcGVyYXRpb24pO1xuICB9KSkpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBhcHBseUhvdHN3YXBPcGVyYXRpb24oc2RrOiBTREssIGlvU3BhbjogSU1lc3NhZ2VTcGFuPGFueT4sIGhvdHN3YXBPcGVyYXRpb246IEhvdHN3YXBPcGVyYXRpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gbm90ZSB0aGUgdHlwZSBvZiBzZXJ2aWNlIHRoYXQgd2FzIHN1Y2Nlc3NmdWxseSBob3Rzd2FwcGVkIGluIHRoZSBVc2VyLUFnZW50XG4gIGNvbnN0IGN1c3RvbVVzZXJBZ2VudCA9IGBjZGstaG90c3dhcC9zdWNjZXNzLSR7aG90c3dhcE9wZXJhdGlvbi5zZXJ2aWNlfWA7XG4gIHNkay5hcHBlbmRDdXN0b21Vc2VyQWdlbnQoY3VzdG9tVXNlckFnZW50KTtcbiAgY29uc3QgcmVzb3VyY2VUZXh0ID0gKHI6IEFmZmVjdGVkUmVzb3VyY2UpID0+IHIuZGVzY3JpcHRpb24gPz8gYCR7ci5yZXNvdXJjZVR5cGV9ICcke3IucGh5c2ljYWxOYW1lID8/IHIubG9naWNhbElkfSdgO1xuXG4gIGF3YWl0IGlvU3Bhbi5ub3RpZnkoSU8uQ0RLX1RPT0xLSVRfSTU0MDIubXNnKFxuICAgIGhvdHN3YXBPcGVyYXRpb24uY2hhbmdlLnJlc291cmNlcy5tYXAociA9PiBmb3JtYXQoYCAgICR7SUNPTn0gJXNgLCBjaGFsay5ib2xkKHJlc291cmNlVGV4dChyKSkpKS5qb2luKCdcXG4nKSxcbiAgICBob3Rzd2FwT3BlcmF0aW9uLmNoYW5nZSxcbiAgKSk7XG5cbiAgLy8gaWYgdGhlIFNESyBjYWxsIGZhaWxzLCBhbiBlcnJvciB3aWxsIGJlIHRocm93biBieSB0aGUgU0RLXG4gIC8vIGFuZCB3aWxsIHByZXZlbnQgdGhlIGdyZWVuICdob3Rzd2FwcGVkIScgdGV4dCBmcm9tIGJlaW5nIGRpc3BsYXllZFxuICB0cnkge1xuICAgIGF3YWl0IGhvdHN3YXBPcGVyYXRpb24uYXBwbHkoc2RrKTtcbiAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgaWYgKGUubmFtZSA9PT0gJ1RpbWVvdXRFcnJvcicgfHwgZS5uYW1lID09PSAnQWJvcnRFcnJvcicpIHtcbiAgICAgIGNvbnN0IHJlc3VsdDogV2FpdGVyUmVzdWx0ID0gSlNPTi5wYXJzZShmb3JtYXRFcnJvck1lc3NhZ2UoZSkpO1xuICAgICAgY29uc3QgZXJyb3IgPSBuZXcgVG9vbGtpdEVycm9yKGZvcm1hdFdhaXRlckVycm9yUmVzdWx0KHJlc3VsdCkpO1xuICAgICAgZXJyb3IubmFtZSA9IGUubmFtZTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgICB0aHJvdyBlO1xuICB9XG5cbiAgYXdhaXQgaW9TcGFuLm5vdGlmeShJTy5DREtfVE9PTEtJVF9JNTQwMy5tc2coXG4gICAgaG90c3dhcE9wZXJhdGlvbi5jaGFuZ2UucmVzb3VyY2VzLm1hcChyID0+IGZvcm1hdChgICAgJHtJQ09OfSAlcyAlc2AsIGNoYWxrLmJvbGQocmVzb3VyY2VUZXh0KHIpKSwgY2hhbGsuZ3JlZW4oJ2hvdHN3YXBwZWQhJykpKS5qb2luKCdcXG4nKSxcbiAgICBob3Rzd2FwT3BlcmF0aW9uLmNoYW5nZSxcbiAgKSk7XG5cbiAgc2RrLnJlbW92ZUN1c3RvbVVzZXJBZ2VudChjdXN0b21Vc2VyQWdlbnQpO1xufVxuXG5mdW5jdGlvbiBmb3JtYXRXYWl0ZXJFcnJvclJlc3VsdChyZXN1bHQ6IFdhaXRlclJlc3VsdCkge1xuICBjb25zdCBtYWluID0gW1xuICAgIGBSZXNvdXJjZSBpcyBub3QgaW4gdGhlIGV4cGVjdGVkIHN0YXRlIGR1ZSB0byB3YWl0ZXIgc3RhdHVzOiAke3Jlc3VsdC5zdGF0ZX1gLFxuICAgIHJlc3VsdC5yZWFzb24gPyBgJHtyZXN1bHQucmVhc29ufS5gIDogJycsXG4gIF0uam9pbignLiAnKTtcblxuICBpZiAocmVzdWx0Lm9ic2VydmVkUmVzcG9uc2VzICE9IG51bGwpIHtcbiAgICBjb25zdCBvYnNlcnZlZFJlc3BvbnNlcyA9IE9iamVjdFxuICAgICAgLmVudHJpZXMocmVzdWx0Lm9ic2VydmVkUmVzcG9uc2VzKVxuICAgICAgLm1hcCgoW21zZywgY291bnRdKSA9PiBgICAtICR7bXNnfSAoJHtjb3VudH0pYClcbiAgICAgIC5qb2luKCdcXG4nKTtcblxuICAgIHJldHVybiBgJHttYWlufSBPYnNlcnZlZCByZXNwb25zZXM6XFxuJHtvYnNlcnZlZFJlc3BvbnNlc31gO1xuICB9XG5cbiAgcmV0dXJuIG1haW47XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvZ1JlamVjdGVkQ2hhbmdlcyhcbiAgaW9TcGFuOiBJTWVzc2FnZVNwYW48YW55PixcbiAgcmVqZWN0ZWRDaGFuZ2VzOiBSZWplY3RlZENoYW5nZVtdLFxuICBob3Rzd2FwTW9kZTogSG90c3dhcE1vZGUsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKHJlamVjdGVkQ2hhbmdlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cbiAgLyoqXG4gICAqIEVLUyBTZXJ2aWNlcyBjYW4gaGF2ZSBhIHRhc2sgZGVmaW5pdGlvbiB0aGF0IGRvZXNuJ3QgcmVmZXIgdG8gdGhlIHRhc2sgZGVmaW5pdGlvbiBiZWluZyB1cGRhdGVkLlxuICAgKiBXZSBoYXZlIHRvIGxvZyB0aGlzIGFzIGEgbm9uLWhvdHN3YXBwYWJsZSBjaGFuZ2UgdG8gdGhlIHRhc2sgZGVmaW5pdGlvbiwgYnV0IHdoZW4gd2UgZG8sXG4gICAqIHdlIHdpbmQgdXAgaG90c3dhcHBpbmcgdGhlIHRhc2sgZGVmaW5pdGlvbiBhbmQgbG9nZ2luZyBpdCBhcyBhIG5vbi1ob3Rzd2FwcGFibGUgY2hhbmdlLlxuICAgKlxuICAgKiBUaGlzIGxvZ2ljIHByZXZlbnRzIHVzIGZyb20gbG9nZ2luZyB0aGF0IGNoYW5nZSBhcyBub24taG90c3dhcHBhYmxlIHdoZW4gd2UgaG90c3dhcCBpdC5cbiAgICovXG4gIGlmIChob3Rzd2FwTW9kZSA9PT0gJ2hvdHN3YXAtb25seScpIHtcbiAgICByZWplY3RlZENoYW5nZXMgPSByZWplY3RlZENoYW5nZXMuZmlsdGVyKChjaGFuZ2UpID0+IGNoYW5nZS5ob3Rzd2FwT25seVZpc2libGUgPT09IHRydWUpO1xuXG4gICAgaWYgKHJlamVjdGVkQ2hhbmdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cblxuICBjb25zdCBtZXNzYWdlcyA9IFsnJ107IC8vIHN0YXJ0IHdpdGggZW1wdHkgbGluZVxuXG4gIGlmIChob3Rzd2FwTW9kZSA9PT0gJ2hvdHN3YXAtb25seScpIHtcbiAgICBtZXNzYWdlcy5wdXNoKGZvcm1hdCgnJXMgJXMnLCBjaGFsay5yZWQoJ+KaoO+4jycpLCBjaGFsay5yZWQoJ1RoZSBmb2xsb3dpbmcgbm9uLWhvdHN3YXBwYWJsZSBjaGFuZ2VzIHdlcmUgZm91bmQuIFRvIHJlY29uY2lsZSB0aGVzZSB1c2luZyBDbG91ZEZvcm1hdGlvbiwgc3BlY2lmeSAtLWhvdHN3YXAtZmFsbGJhY2snKSkpO1xuICB9IGVsc2Uge1xuICAgIG1lc3NhZ2VzLnB1c2goZm9ybWF0KCclcyAlcycsIGNoYWxrLnJlZCgn4pqg77iPJyksIGNoYWxrLnJlZCgnVGhlIGZvbGxvd2luZyBub24taG90c3dhcHBhYmxlIGNoYW5nZXMgd2VyZSBmb3VuZDonKSkpO1xuICB9XG5cbiAgZm9yIChjb25zdCB7IGNoYW5nZSB9IG9mIHJlamVjdGVkQ2hhbmdlcykge1xuICAgIG1lc3NhZ2VzLnB1c2goJyAgICAnICsgbm9uSG90c3dhcHBhYmxlQ2hhbmdlTWVzc2FnZShjaGFuZ2UpKTtcbiAgfVxuICBtZXNzYWdlcy5wdXNoKCcnKTsgLy8gbmV3bGluZVxuXG4gIGF3YWl0IGlvU3Bhbi5ub3RpZnkoSU8uREVGQVVMVF9UT09MS0lUX0lORk8ubXNnKG1lc3NhZ2VzLmpvaW4oJ1xcbicpKSk7XG59XG5cbi8qKlxuICogRm9ybWF0cyBhIE5vbkhvdHN3YXBwYWJsZUNoYW5nZVxuICovXG5mdW5jdGlvbiBub25Ib3Rzd2FwcGFibGVDaGFuZ2VNZXNzYWdlKGNoYW5nZTogTm9uSG90c3dhcHBhYmxlQ2hhbmdlKTogc3RyaW5nIHtcbiAgY29uc3Qgc3ViamVjdCA9IGNoYW5nZS5zdWJqZWN0O1xuICBjb25zdCByZWFzb24gPSBjaGFuZ2UuZGVzY3JpcHRpb24gPz8gY2hhbmdlLnJlYXNvbjtcblxuICBzd2l0Y2ggKHN1YmplY3QudHlwZSkge1xuICAgIGNhc2UgJ091dHB1dCc6XG4gICAgICByZXR1cm4gZm9ybWF0KFxuICAgICAgICAnb3V0cHV0OiAlcywgcmVhc29uOiAlcycsXG4gICAgICAgIGNoYWxrLmJvbGQoc3ViamVjdC5sb2dpY2FsSWQpLFxuICAgICAgICBjaGFsay5yZWQocmVhc29uKSxcbiAgICAgICk7XG4gICAgY2FzZSAnUmVzb3VyY2UnOlxuICAgICAgcmV0dXJuIG5vbkhvdHN3YXBwYWJsZVJlc291cmNlTWVzc2FnZShzdWJqZWN0LCByZWFzb24pO1xuICB9XG59XG5cbi8qKlxuICogRm9ybWF0cyBhIG5vbi1ob3Rzd2FwcGFibGUgcmVzb3VyY2Ugc3ViamVjdFxuICovXG5mdW5jdGlvbiBub25Ib3Rzd2FwcGFibGVSZXNvdXJjZU1lc3NhZ2Uoc3ViamVjdDogUmVzb3VyY2VTdWJqZWN0LCByZWFzb246IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmIChzdWJqZWN0LnJlamVjdGVkUHJvcGVydGllcz8ubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGZvcm1hdChcbiAgICAgICdyZXNvdXJjZTogJXMsIHR5cGU6ICVzLCByZWplY3RlZCBjaGFuZ2VzOiAlcywgcmVhc29uOiAlcycsXG4gICAgICBjaGFsay5ib2xkKHN1YmplY3QubG9naWNhbElkKSxcbiAgICAgIGNoYWxrLmJvbGQoc3ViamVjdC5yZXNvdXJjZVR5cGUpLFxuICAgICAgY2hhbGsuYm9sZChzdWJqZWN0LnJlamVjdGVkUHJvcGVydGllcyksXG4gICAgICBjaGFsay5yZWQocmVhc29uKSxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIGZvcm1hdChcbiAgICAncmVzb3VyY2U6ICVzLCB0eXBlOiAlcywgcmVhc29uOiAlcycsXG4gICAgY2hhbGsuYm9sZChzdWJqZWN0LmxvZ2ljYWxJZCksXG4gICAgY2hhbGsuYm9sZChzdWJqZWN0LnJlc291cmNlVHlwZSksXG4gICAgY2hhbGsucmVkKHJlYXNvbiksXG4gICk7XG59XG4iXX0=