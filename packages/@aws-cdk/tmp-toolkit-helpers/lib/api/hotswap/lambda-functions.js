"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHotswappableLambdaFunctionChange = isHotswappableLambdaFunctionChange;
const stream_1 = require("stream");
const common_1 = require("./common");
const util_1 = require("../../util");
const cloudformation_1 = require("../cloudformation");
const toolkit_error_1 = require("../toolkit-error");
// namespace object imports won't work in the bundle for function exports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');
async function isHotswappableLambdaFunctionChange(logicalId, change, evaluateCfnTemplate) {
    // if the change is for a Lambda Version, we just ignore it
    // we will publish a new version when we get to hotswapping the actual Function this Version points to
    // (Versions can't be changed in CloudFormation anyway, they're immutable)
    if (change.newValue.Type === 'AWS::Lambda::Version') {
        return [];
    }
    // we handle Aliases specially too
    // the actual alias update will happen if we change the function
    if (change.newValue.Type === 'AWS::Lambda::Alias') {
        return classifyAliasChanges(change);
    }
    if (change.newValue.Type !== 'AWS::Lambda::Function') {
        return [];
    }
    const ret = [];
    const classifiedChanges = (0, common_1.classifyChanges)(change, ['Code', 'Environment', 'Description']);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    const functionName = await evaluateCfnTemplate.establishResourcePhysicalName(logicalId, change.newValue.Properties?.FunctionName);
    const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
    if (functionName && namesOfHotswappableChanges.length > 0) {
        const lambdaCodeChange = await evaluateLambdaFunctionProps(classifiedChanges.hotswappableProps, change.newValue.Properties?.Runtime, evaluateCfnTemplate);
        // nothing to do here
        if (lambdaCodeChange === undefined) {
            return ret;
        }
        const dependencies = await dependantResources(logicalId, functionName, evaluateCfnTemplate);
        ret.push({
            change: {
                cause: change,
                resources: [
                    {
                        logicalId,
                        resourceType: change.newValue.Type,
                        physicalName: functionName,
                        metadata: evaluateCfnTemplate.metadataFor(logicalId),
                    },
                    ...dependencies,
                ],
            },
            hotswappable: true,
            service: 'lambda',
            apply: async (sdk) => {
                const lambda = sdk.lambda();
                const operations = [];
                if (lambdaCodeChange.code !== undefined || lambdaCodeChange.configurations !== undefined) {
                    if (lambdaCodeChange.code !== undefined) {
                        const updateFunctionCodeResponse = await lambda.updateFunctionCode({
                            FunctionName: functionName,
                            S3Bucket: lambdaCodeChange.code.s3Bucket,
                            S3Key: lambdaCodeChange.code.s3Key,
                            ImageUri: lambdaCodeChange.code.imageUri,
                            ZipFile: lambdaCodeChange.code.functionCodeZip,
                            S3ObjectVersion: lambdaCodeChange.code.s3ObjectVersion,
                        });
                        await waitForLambdasPropertiesUpdateToFinish(updateFunctionCodeResponse, lambda, functionName);
                    }
                    if (lambdaCodeChange.configurations !== undefined) {
                        const updateRequest = {
                            FunctionName: functionName,
                        };
                        if (lambdaCodeChange.configurations.description !== undefined) {
                            updateRequest.Description = lambdaCodeChange.configurations.description;
                        }
                        if (lambdaCodeChange.configurations.environment !== undefined) {
                            updateRequest.Environment = lambdaCodeChange.configurations.environment;
                        }
                        const updateFunctionCodeResponse = await lambda.updateFunctionConfiguration(updateRequest);
                        await waitForLambdasPropertiesUpdateToFinish(updateFunctionCodeResponse, lambda, functionName);
                    }
                    // only if the code changed is there any point in publishing a new Version
                    const versions = dependencies.filter((d) => d.resourceType === 'AWS::Lambda::Version');
                    if (versions.length) {
                        const publishVersionPromise = lambda.publishVersion({
                            FunctionName: functionName,
                        });
                        const aliases = dependencies.filter((d) => d.resourceType === 'AWS::Lambda::Alias');
                        if (aliases.length) {
                            // we need to wait for the Version to finish publishing
                            const versionUpdate = await publishVersionPromise;
                            for (const alias of aliases) {
                                operations.push(lambda.updateAlias({
                                    FunctionName: functionName,
                                    Name: alias.physicalName,
                                    FunctionVersion: versionUpdate.Version,
                                }));
                            }
                        }
                        else {
                            operations.push(publishVersionPromise);
                        }
                    }
                }
                // run all of our updates in parallel
                // Limited set of updates per function
                // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
                await Promise.all(operations);
            },
        });
    }
    return ret;
}
/**
 * Determines which changes to this Alias are hotswappable or not
 */
function classifyAliasChanges(change) {
    const ret = [];
    const classifiedChanges = (0, common_1.classifyChanges)(change, ['FunctionVersion']);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    // we only want to report not hotswappable changes to aliases
    // the actual alias update will happen if we change the function
    return ret;
}
/**
 * Evaluates the hotswappable properties of an AWS::Lambda::Function and
 * Returns a `LambdaFunctionChange` if the change is hotswappable.
 * Returns `undefined` if the change is not hotswappable.
 */
async function evaluateLambdaFunctionProps(hotswappablePropChanges, runtime, evaluateCfnTemplate) {
    /*
     * At first glance, we would want to initialize these using the "previous" values (change.oldValue),
     * in case only one of them changed, like the key, and the Bucket stayed the same.
     * However, that actually fails for old-style synthesis, which uses CFN Parameters!
     * Because the names of the Parameters depend on the hash of the Asset,
     * the Parameters used for the "old" values no longer exist in `assetParams` at this point,
     * which means we don't have the correct values available to evaluate the CFN expression with.
     * Fortunately, the diff will always include both the s3Bucket and s3Key parts of the Lambda's Code property,
     * even if only one of them was actually changed,
     * which means we don't need the "old" values at all, and we can safely initialize these with just `''`.
     */
    let code = undefined;
    let description = undefined;
    let environment = undefined;
    for (const updatedPropName in hotswappablePropChanges) {
        const updatedProp = hotswappablePropChanges[updatedPropName];
        switch (updatedPropName) {
            case 'Code':
                let s3Bucket, s3Key, s3ObjectVersion, imageUri, functionCodeZip;
                for (const newPropName in updatedProp.newValue) {
                    switch (newPropName) {
                        case 'S3Bucket':
                            s3Bucket = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            break;
                        case 'S3Key':
                            s3Key = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            break;
                        case 'S3ObjectVersion':
                            s3ObjectVersion = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            break;
                        case 'ImageUri':
                            imageUri = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            break;
                        case 'ZipFile':
                            // We must create a zip package containing a file with the inline code
                            const functionCode = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            const functionRuntime = await evaluateCfnTemplate.evaluateCfnExpression(runtime);
                            if (!functionRuntime) {
                                return undefined;
                            }
                            // file extension must be chosen depending on the runtime
                            const codeFileExt = determineCodeFileExtFromRuntime(functionRuntime);
                            functionCodeZip = await zipString(`index.${codeFileExt}`, functionCode);
                            break;
                    }
                }
                code = {
                    s3Bucket,
                    s3Key,
                    s3ObjectVersion,
                    imageUri,
                    functionCodeZip,
                };
                break;
            case 'Description':
                description = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue);
                break;
            case 'Environment':
                environment = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue);
                break;
            default:
                // we will never get here, but just in case we do throw an error
                throw new toolkit_error_1.ToolkitError('while apply()ing, found a property that cannot be hotswapped. Please report this at github.com/aws/aws-cdk/issues/new/choose');
        }
    }
    const configurations = description || environment ? { description, environment } : undefined;
    return code || configurations ? { code, configurations } : undefined;
}
/**
 * Compress a string as a file, returning a promise for the zip buffer
 * https://github.com/archiverjs/node-archiver/issues/342
 */
function zipString(fileName, rawString) {
    return new Promise((resolve, reject) => {
        const buffers = [];
        const converter = new stream_1.Writable();
        converter._write = (chunk, _, callback) => {
            buffers.push(chunk);
            process.nextTick(callback);
        };
        converter.on('finish', () => {
            resolve(Buffer.concat(buffers));
        });
        const archive = archiver('zip');
        archive.on('error', (err) => {
            reject(err);
        });
        archive.pipe(converter);
        archive.append(rawString, {
            name: fileName,
            date: new Date('1980-01-01T00:00:00.000Z'), // Add date to make resulting zip file deterministic
        });
        void archive.finalize();
    });
}
/**
 * After a Lambda Function is updated, it cannot be updated again until the
 * `State=Active` and the `LastUpdateStatus=Successful`.
 *
 * Depending on the configuration of the Lambda Function this could happen relatively quickly
 * or very slowly. For example, Zip based functions _not_ in a VPC can take ~1 second whereas VPC
 * or Container functions can take ~25 seconds (and 'idle' VPC functions can take minutes).
 */
async function waitForLambdasPropertiesUpdateToFinish(currentFunctionConfiguration, lambda, functionName) {
    const functionIsInVpcOrUsesDockerForCode = currentFunctionConfiguration.VpcConfig?.VpcId || currentFunctionConfiguration.PackageType === 'Image';
    // if the function is deployed in a VPC or if it is a container image function
    // then the update will take much longer and we can wait longer between checks
    // otherwise, the update will be quick, so a 1-second delay is fine
    const delaySeconds = functionIsInVpcOrUsesDockerForCode ? 5 : 1;
    await lambda.waitUntilFunctionUpdated(delaySeconds, {
        FunctionName: functionName,
    });
}
/**
 * Get file extension from Lambda runtime string.
 * We use this extension to create a deployment package from Lambda inline code.
 */
function determineCodeFileExtFromRuntime(runtime) {
    if (runtime.startsWith('node')) {
        return 'js';
    }
    if (runtime.startsWith('python')) {
        return 'py';
    }
    // Currently inline code only supports Node.js and Python, ignoring other runtimes.
    // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-code.html#aws-properties-lambda-function-code-properties
    throw new cloudformation_1.CfnEvaluationException(`runtime ${runtime} is unsupported, only node.js and python runtimes are currently supported.`);
}
/**
 * Finds all Versions that reference an AWS::Lambda::Function with logical ID `logicalId`
 * and Aliases that reference those Versions.
 */
async function versionsAndAliases(logicalId, evaluateCfnTemplate) {
    // find all Lambda Versions that reference this Function
    const versionsReferencingFunction = evaluateCfnTemplate
        .findReferencesTo(logicalId)
        .filter((r) => r.Type === 'AWS::Lambda::Version');
    // find all Lambda Aliases that reference the above Versions
    const aliasesReferencingVersions = (0, util_1.flatMap)(versionsReferencingFunction, v => evaluateCfnTemplate.findReferencesTo(v.LogicalId));
    return { versionsReferencingFunction, aliasesReferencingVersions };
}
async function dependantResources(logicalId, functionName, evaluateCfnTemplate) {
    const candidates = await versionsAndAliases(logicalId, evaluateCfnTemplate);
    // Limited set of updates per function
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const aliases = await Promise.all(candidates.aliasesReferencingVersions.map(async (a) => {
        const name = await evaluateCfnTemplate.evaluateCfnExpression(a.Properties?.Name);
        return {
            logicalId: a.LogicalId,
            resourceType: a.Type,
            physicalName: name,
            description: `${a.Type} '${name}' for AWS::Lambda::Function '${functionName}'`,
            metadata: evaluateCfnTemplate.metadataFor(a.LogicalId),
        };
    }));
    const versions = candidates.versionsReferencingFunction.map((v) => ({
        logicalId: v.LogicalId,
        resourceType: v.Type,
        description: `${v.Type} for AWS::Lambda::Function '${functionName}'`,
        metadata: evaluateCfnTemplate.metadataFor(v.LogicalId),
    }));
    return [
        ...versions,
        ...aliases,
    ];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9hcGkvaG90c3dhcC9sYW1iZGEtZnVuY3Rpb25zLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZUEsZ0ZBK0hDO0FBOUlELG1DQUFrQztBQUlsQyxxQ0FBMkM7QUFFM0MscUNBQXFDO0FBRXJDLHNEQUFnRztBQUNoRyxvREFBZ0Q7QUFFaEQseUVBQXlFO0FBQ3pFLGlFQUFpRTtBQUNqRSxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7QUFFOUIsS0FBSyxVQUFVLGtDQUFrQyxDQUN0RCxTQUFpQixFQUNqQixNQUFzQixFQUN0QixtQkFBbUQ7SUFFbkQsMkRBQTJEO0lBQzNELHNHQUFzRztJQUN0RywwRUFBMEU7SUFDMUUsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksS0FBSyxzQkFBc0IsRUFBRSxDQUFDO1FBQ3BELE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVELGtDQUFrQztJQUNsQyxnRUFBZ0U7SUFDaEUsSUFBSSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUksS0FBSyxvQkFBb0IsRUFBRSxDQUFDO1FBQ2xELE9BQU8sb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDdEMsQ0FBQztJQUVELElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEtBQUssdUJBQXVCLEVBQUUsQ0FBQztRQUNyRCxPQUFPLEVBQUUsQ0FBQztJQUNaLENBQUM7SUFFRCxNQUFNLEdBQUcsR0FBb0IsRUFBRSxDQUFDO0lBQ2hDLE1BQU0saUJBQWlCLEdBQUcsSUFBQSx3QkFBZSxFQUFDLE1BQU0sRUFBRSxDQUFDLE1BQU0sRUFBRSxhQUFhLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQztJQUMxRixpQkFBaUIsQ0FBQyxvQ0FBb0MsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUU1RCxNQUFNLFlBQVksR0FBRyxNQUFNLG1CQUFtQixDQUFDLDZCQUE2QixDQUMxRSxTQUFTLEVBQ1QsTUFBTSxDQUFDLFFBQVEsQ0FBQyxVQUFVLEVBQUUsWUFBWSxDQUN6QyxDQUFDO0lBQ0YsTUFBTSwwQkFBMEIsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLGlCQUFpQixDQUFDLENBQUM7SUFDcEYsSUFBSSxZQUFZLElBQUksMEJBQTBCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQzFELE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSwyQkFBMkIsQ0FDeEQsaUJBQWlCLENBQUMsaUJBQWlCLEVBQ25DLE1BQU0sQ0FBQyxRQUFRLENBQUMsVUFBVSxFQUFFLE9BQU8sRUFDbkMsbUJBQW1CLENBQ3BCLENBQUM7UUFFRixxQkFBcUI7UUFDckIsSUFBSSxnQkFBZ0IsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNuQyxPQUFPLEdBQUcsQ0FBQztRQUNiLENBQUM7UUFFRCxNQUFNLFlBQVksR0FBRyxNQUFNLGtCQUFrQixDQUFDLFNBQVMsRUFBRSxZQUFZLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztRQUU1RixHQUFHLENBQUMsSUFBSSxDQUFDO1lBQ1AsTUFBTSxFQUFFO2dCQUNOLEtBQUssRUFBRSxNQUFNO2dCQUNiLFNBQVMsRUFBRTtvQkFDVDt3QkFDRSxTQUFTO3dCQUNULFlBQVksRUFBRSxNQUFNLENBQUMsUUFBUSxDQUFDLElBQUk7d0JBQ2xDLFlBQVksRUFBRSxZQUFZO3dCQUMxQixRQUFRLEVBQUUsbUJBQW1CLENBQUMsV0FBVyxDQUFDLFNBQVMsQ0FBQztxQkFDckQ7b0JBQ0QsR0FBRyxZQUFZO2lCQUNoQjthQUNGO1lBQ0QsWUFBWSxFQUFFLElBQUk7WUFDbEIsT0FBTyxFQUFFLFFBQVE7WUFDakIsS0FBSyxFQUFFLEtBQUssRUFBRSxHQUFRLEVBQUUsRUFBRTtnQkFDeEIsTUFBTSxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUM1QixNQUFNLFVBQVUsR0FBbUIsRUFBRSxDQUFDO2dCQUV0QyxJQUFJLGdCQUFnQixDQUFDLElBQUksS0FBSyxTQUFTLElBQUksZ0JBQWdCLENBQUMsY0FBYyxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUN6RixJQUFJLGdCQUFnQixDQUFDLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQzt3QkFDeEMsTUFBTSwwQkFBMEIsR0FBRyxNQUFNLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQzs0QkFDakUsWUFBWSxFQUFFLFlBQVk7NEJBQzFCLFFBQVEsRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsUUFBUTs0QkFDeEMsS0FBSyxFQUFFLGdCQUFnQixDQUFDLElBQUksQ0FBQyxLQUFLOzRCQUNsQyxRQUFRLEVBQUUsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLFFBQVE7NEJBQ3hDLE9BQU8sRUFBRSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsZUFBZTs0QkFDOUMsZUFBZSxFQUFFLGdCQUFnQixDQUFDLElBQUksQ0FBQyxlQUFlO3lCQUN2RCxDQUFDLENBQUM7d0JBRUgsTUFBTSxzQ0FBc0MsQ0FBQywwQkFBMEIsRUFBRSxNQUFNLEVBQUUsWUFBWSxDQUFDLENBQUM7b0JBQ2pHLENBQUM7b0JBRUQsSUFBSSxnQkFBZ0IsQ0FBQyxjQUFjLEtBQUssU0FBUyxFQUFFLENBQUM7d0JBQ2xELE1BQU0sYUFBYSxHQUE0Qzs0QkFDN0QsWUFBWSxFQUFFLFlBQVk7eUJBQzNCLENBQUM7d0JBQ0YsSUFBSSxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsV0FBVyxLQUFLLFNBQVMsRUFBRSxDQUFDOzRCQUM5RCxhQUFhLENBQUMsV0FBVyxHQUFHLGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxXQUFXLENBQUM7d0JBQzFFLENBQUM7d0JBQ0QsSUFBSSxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsV0FBVyxLQUFLLFNBQVMsRUFBRSxDQUFDOzRCQUM5RCxhQUFhLENBQUMsV0FBVyxHQUFHLGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxXQUFXLENBQUM7d0JBQzFFLENBQUM7d0JBQ0QsTUFBTSwwQkFBMEIsR0FBRyxNQUFNLE1BQU0sQ0FBQywyQkFBMkIsQ0FBQyxhQUFhLENBQUMsQ0FBQzt3QkFDM0YsTUFBTSxzQ0FBc0MsQ0FBQywwQkFBMEIsRUFBRSxNQUFNLEVBQUUsWUFBWSxDQUFDLENBQUM7b0JBQ2pHLENBQUM7b0JBRUQsMEVBQTBFO29CQUMxRSxNQUFNLFFBQVEsR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsWUFBWSxLQUFLLHNCQUFzQixDQUFDLENBQUM7b0JBQ3ZGLElBQUksUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDO3dCQUNwQixNQUFNLHFCQUFxQixHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUM7NEJBQ2xELFlBQVksRUFBRSxZQUFZO3lCQUMzQixDQUFDLENBQUM7d0JBRUgsTUFBTSxPQUFPLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLFlBQVksS0FBSyxvQkFBb0IsQ0FBQyxDQUFDO3dCQUNwRixJQUFJLE9BQU8sQ0FBQyxNQUFNLEVBQUUsQ0FBQzs0QkFDbkIsdURBQXVEOzRCQUN2RCxNQUFNLGFBQWEsR0FBRyxNQUFNLHFCQUFxQixDQUFDOzRCQUNsRCxLQUFLLE1BQU0sS0FBSyxJQUFJLE9BQU8sRUFBRSxDQUFDO2dDQUM1QixVQUFVLENBQUMsSUFBSSxDQUNiLE1BQU0sQ0FBQyxXQUFXLENBQUM7b0NBQ2pCLFlBQVksRUFBRSxZQUFZO29DQUMxQixJQUFJLEVBQUUsS0FBSyxDQUFDLFlBQVk7b0NBQ3hCLGVBQWUsRUFBRSxhQUFhLENBQUMsT0FBTztpQ0FDdkMsQ0FBQyxDQUNILENBQUM7NEJBQ0osQ0FBQzt3QkFDSCxDQUFDOzZCQUFNLENBQUM7NEJBQ04sVUFBVSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO3dCQUN6QyxDQUFDO29CQUNILENBQUM7Z0JBQ0gsQ0FBQztnQkFFRCxxQ0FBcUM7Z0JBQ3JDLHNDQUFzQztnQkFDdEMsd0VBQXdFO2dCQUN4RSxNQUFNLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDaEMsQ0FBQztTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLEdBQUcsQ0FBQztBQUNiLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsb0JBQW9CLENBQUMsTUFBc0I7SUFDbEQsTUFBTSxHQUFHLEdBQW9CLEVBQUUsQ0FBQztJQUNoQyxNQUFNLGlCQUFpQixHQUFHLElBQUEsd0JBQWUsRUFBQyxNQUFNLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUM7SUFDdkUsaUJBQWlCLENBQUMsb0NBQW9DLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFNUQsNkRBQTZEO0lBQzdELGdFQUFnRTtJQUVoRSxPQUFPLEdBQUcsQ0FBQztBQUNiLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsS0FBSyxVQUFVLDJCQUEyQixDQUN4Qyx1QkFBZ0UsRUFDaEUsT0FBZSxFQUNmLG1CQUFtRDtJQUVuRDs7Ozs7Ozs7OztPQVVHO0lBQ0gsSUFBSSxJQUFJLEdBQW1DLFNBQVMsQ0FBQztJQUNyRCxJQUFJLFdBQVcsR0FBdUIsU0FBUyxDQUFDO0lBQ2hELElBQUksV0FBVyxHQUEwQyxTQUFTLENBQUM7SUFFbkUsS0FBSyxNQUFNLGVBQWUsSUFBSSx1QkFBdUIsRUFBRSxDQUFDO1FBQ3RELE1BQU0sV0FBVyxHQUFHLHVCQUF1QixDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRTdELFFBQVEsZUFBZSxFQUFFLENBQUM7WUFDeEIsS0FBSyxNQUFNO2dCQUNULElBQUksUUFBUSxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQztnQkFFaEUsS0FBSyxNQUFNLFdBQVcsSUFBSSxXQUFXLENBQUMsUUFBUSxFQUFFLENBQUM7b0JBQy9DLFFBQVEsV0FBVyxFQUFFLENBQUM7d0JBQ3BCLEtBQUssVUFBVTs0QkFDYixRQUFRLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7NEJBQzlGLE1BQU07d0JBQ1IsS0FBSyxPQUFPOzRCQUNWLEtBQUssR0FBRyxNQUFNLG1CQUFtQixDQUFDLHFCQUFxQixDQUFDLFdBQVcsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQzs0QkFDM0YsTUFBTTt3QkFDUixLQUFLLGlCQUFpQjs0QkFDcEIsZUFBZSxHQUFHLE1BQU0sbUJBQW1CLENBQUMscUJBQXFCLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDOzRCQUNyRyxNQUFNO3dCQUNSLEtBQUssVUFBVTs0QkFDYixRQUFRLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7NEJBQzlGLE1BQU07d0JBQ1IsS0FBSyxTQUFTOzRCQUNaLHNFQUFzRTs0QkFDdEUsTUFBTSxZQUFZLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7NEJBQ3hHLE1BQU0sZUFBZSxHQUFHLE1BQU0sbUJBQW1CLENBQUMscUJBQXFCLENBQUMsT0FBTyxDQUFDLENBQUM7NEJBQ2pGLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztnQ0FDckIsT0FBTyxTQUFTLENBQUM7NEJBQ25CLENBQUM7NEJBQ0QseURBQXlEOzRCQUN6RCxNQUFNLFdBQVcsR0FBRywrQkFBK0IsQ0FBQyxlQUFlLENBQUMsQ0FBQzs0QkFDckUsZUFBZSxHQUFHLE1BQU0sU0FBUyxDQUFDLFNBQVMsV0FBVyxFQUFFLEVBQUUsWUFBWSxDQUFDLENBQUM7NEJBQ3hFLE1BQU07b0JBQ1YsQ0FBQztnQkFDSCxDQUFDO2dCQUNELElBQUksR0FBRztvQkFDTCxRQUFRO29CQUNSLEtBQUs7b0JBQ0wsZUFBZTtvQkFDZixRQUFRO29CQUNSLGVBQWU7aUJBQ2hCLENBQUM7Z0JBQ0YsTUFBTTtZQUNSLEtBQUssYUFBYTtnQkFDaEIsV0FBVyxHQUFHLE1BQU0sbUJBQW1CLENBQUMscUJBQXFCLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUNwRixNQUFNO1lBQ1IsS0FBSyxhQUFhO2dCQUNoQixXQUFXLEdBQUcsTUFBTSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQ3BGLE1BQU07WUFDUjtnQkFDRSxnRUFBZ0U7Z0JBQ2hFLE1BQU0sSUFBSSw0QkFBWSxDQUNwQiw4SEFBOEgsQ0FDL0gsQ0FBQztRQUNOLENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxjQUFjLEdBQUcsV0FBVyxJQUFJLFdBQVcsQ0FBQyxDQUFDLENBQUMsRUFBRSxXQUFXLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUM3RixPQUFPLElBQUksSUFBSSxjQUFjLENBQUMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7QUFDdkUsQ0FBQztBQW9CRDs7O0dBR0c7QUFDSCxTQUFTLFNBQVMsQ0FBQyxRQUFnQixFQUFFLFNBQWlCO0lBQ3BELE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDckMsTUFBTSxPQUFPLEdBQWEsRUFBRSxDQUFDO1FBRTdCLE1BQU0sU0FBUyxHQUFHLElBQUksaUJBQVEsRUFBRSxDQUFDO1FBRWpDLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxLQUFhLEVBQUUsQ0FBUyxFQUFFLFFBQW9CLEVBQUUsRUFBRTtZQUNwRSxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3BCLE9BQU8sQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDN0IsQ0FBQyxDQUFDO1FBRUYsU0FBUyxDQUFDLEVBQUUsQ0FBQyxRQUFRLEVBQUUsR0FBRyxFQUFFO1lBQzFCLE9BQU8sQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7UUFDbEMsQ0FBQyxDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFaEMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxHQUFRLEVBQUUsRUFBRTtZQUMvQixNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDZCxDQUFDLENBQUMsQ0FBQztRQUVILE9BQU8sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFeEIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLEVBQUU7WUFDeEIsSUFBSSxFQUFFLFFBQVE7WUFDZCxJQUFJLEVBQUUsSUFBSSxJQUFJLENBQUMsMEJBQTBCLENBQUMsRUFBRSxvREFBb0Q7U0FDakcsQ0FBQyxDQUFDO1FBRUgsS0FBSyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7SUFDMUIsQ0FBQyxDQUFDLENBQUM7QUFDTCxDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILEtBQUssVUFBVSxzQ0FBc0MsQ0FDbkQsNEJBQW1ELEVBQ25ELE1BQXFCLEVBQ3JCLFlBQW9CO0lBRXBCLE1BQU0sa0NBQWtDLEdBQ3RDLDRCQUE0QixDQUFDLFNBQVMsRUFBRSxLQUFLLElBQUksNEJBQTRCLENBQUMsV0FBVyxLQUFLLE9BQU8sQ0FBQztJQUV4Ryw4RUFBOEU7SUFDOUUsOEVBQThFO0lBQzlFLG1FQUFtRTtJQUNuRSxNQUFNLFlBQVksR0FBRyxrQ0FBa0MsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFaEUsTUFBTSxNQUFNLENBQUMsd0JBQXdCLENBQUMsWUFBWSxFQUFFO1FBQ2xELFlBQVksRUFBRSxZQUFZO0tBQzNCLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLCtCQUErQixDQUFDLE9BQWU7SUFDdEQsSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7UUFDL0IsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBQ0QsSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7UUFDakMsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBQ0QsbUZBQW1GO0lBQ25GLHlKQUF5SjtJQUN6SixNQUFNLElBQUksdUNBQXNCLENBQzlCLFdBQVcsT0FBTyw0RUFBNEUsQ0FDL0YsQ0FBQztBQUNKLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxLQUFLLFVBQVUsa0JBQWtCLENBQUMsU0FBaUIsRUFBRSxtQkFBbUQ7SUFDdEcsd0RBQXdEO0lBQ3hELE1BQU0sMkJBQTJCLEdBQUcsbUJBQW1CO1NBQ3BELGdCQUFnQixDQUFDLFNBQVMsQ0FBQztTQUMzQixNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLEtBQUssc0JBQXNCLENBQUMsQ0FBQztJQUNwRCw0REFBNEQ7SUFDNUQsTUFBTSwwQkFBMEIsR0FBRyxJQUFBLGNBQU8sRUFBQywyQkFBMkIsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUMxRSxtQkFBbUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztJQUVyRCxPQUFPLEVBQUUsMkJBQTJCLEVBQUUsMEJBQTBCLEVBQUUsQ0FBQztBQUNyRSxDQUFDO0FBRUQsS0FBSyxVQUFVLGtCQUFrQixDQUMvQixTQUFpQixFQUNqQixZQUFvQixFQUNwQixtQkFBbUQ7SUFFbkQsTUFBTSxVQUFVLEdBQUcsTUFBTSxrQkFBa0IsQ0FBQyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztJQUU1RSxzQ0FBc0M7SUFDdEMsd0VBQXdFO0lBQ3hFLE1BQU0sT0FBTyxHQUFHLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsMEJBQTBCLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDLEVBQUUsRUFBRTtRQUN0RixNQUFNLElBQUksR0FBRyxNQUFNLG1CQUFtQixDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQyxVQUFVLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDakYsT0FBTztZQUNMLFNBQVMsRUFBRSxDQUFDLENBQUMsU0FBUztZQUN0QixZQUFZLEVBQUUsQ0FBQyxDQUFDLElBQUk7WUFDcEIsWUFBWSxFQUFFLElBQUk7WUFDbEIsV0FBVyxFQUFFLEdBQUcsQ0FBQyxDQUFDLElBQUksS0FBSyxJQUFJLGdDQUFnQyxZQUFZLEdBQUc7WUFDOUUsUUFBUSxFQUFFLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1NBQ3ZELENBQUM7SUFDSixDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRUosTUFBTSxRQUFRLEdBQUcsVUFBVSxDQUFDLDJCQUEyQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FDakU7UUFDRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLFNBQVM7UUFDdEIsWUFBWSxFQUFFLENBQUMsQ0FBQyxJQUFJO1FBQ3BCLFdBQVcsRUFBRSxHQUFHLENBQUMsQ0FBQyxJQUFJLCtCQUErQixZQUFZLEdBQUc7UUFDcEUsUUFBUSxFQUFFLG1CQUFtQixDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0tBQ3ZELENBQ0YsQ0FBQyxDQUFDO0lBRUgsT0FBTztRQUNMLEdBQUcsUUFBUTtRQUNYLEdBQUcsT0FBTztLQUNYLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgV3JpdGFibGUgfSBmcm9tICdzdHJlYW0nO1xuaW1wb3J0IHR5cGUgeyBQcm9wZXJ0eURpZmZlcmVuY2UgfSBmcm9tICdAYXdzLWNkay9jbG91ZGZvcm1hdGlvbi1kaWZmJztcbmltcG9ydCB0eXBlIHsgRnVuY3Rpb25Db25maWd1cmF0aW9uLCBVcGRhdGVGdW5jdGlvbkNvbmZpZ3VyYXRpb25Db21tYW5kSW5wdXQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcbmltcG9ydCB0eXBlIHsgSG90c3dhcENoYW5nZSB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IGNsYXNzaWZ5Q2hhbmdlcyB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB0eXBlIHsgQWZmZWN0ZWRSZXNvdXJjZSwgUmVzb3VyY2VDaGFuZ2UgfSBmcm9tICcuLi8uLi9wYXlsb2Fkcy9ob3Rzd2FwJztcbmltcG9ydCB7IGZsYXRNYXAgfSBmcm9tICcuLi8uLi91dGlsJztcbmltcG9ydCB0eXBlIHsgSUxhbWJkYUNsaWVudCwgU0RLIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHsgQ2ZuRXZhbHVhdGlvbkV4Y2VwdGlvbiwgdHlwZSBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUgfSBmcm9tICcuLi9jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgeyBUb29sa2l0RXJyb3IgfSBmcm9tICcuLi90b29sa2l0LWVycm9yJztcblxuLy8gbmFtZXNwYWNlIG9iamVjdCBpbXBvcnRzIHdvbid0IHdvcmsgaW4gdGhlIGJ1bmRsZSBmb3IgZnVuY3Rpb24gZXhwb3J0c1xuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHNcbmNvbnN0IGFyY2hpdmVyID0gcmVxdWlyZSgnYXJjaGl2ZXInKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzSG90c3dhcHBhYmxlTGFtYmRhRnVuY3Rpb25DaGFuZ2UoXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IFJlc291cmNlQ2hhbmdlLFxuICBldmFsdWF0ZUNmblRlbXBsYXRlOiBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUsXG4pOiBQcm9taXNlPEhvdHN3YXBDaGFuZ2VbXT4ge1xuICAvLyBpZiB0aGUgY2hhbmdlIGlzIGZvciBhIExhbWJkYSBWZXJzaW9uLCB3ZSBqdXN0IGlnbm9yZSBpdFxuICAvLyB3ZSB3aWxsIHB1Ymxpc2ggYSBuZXcgdmVyc2lvbiB3aGVuIHdlIGdldCB0byBob3Rzd2FwcGluZyB0aGUgYWN0dWFsIEZ1bmN0aW9uIHRoaXMgVmVyc2lvbiBwb2ludHMgdG9cbiAgLy8gKFZlcnNpb25zIGNhbid0IGJlIGNoYW5nZWQgaW4gQ2xvdWRGb3JtYXRpb24gYW55d2F5LCB0aGV5J3JlIGltbXV0YWJsZSlcbiAgaWYgKGNoYW5nZS5uZXdWYWx1ZS5UeXBlID09PSAnQVdTOjpMYW1iZGE6OlZlcnNpb24nKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgLy8gd2UgaGFuZGxlIEFsaWFzZXMgc3BlY2lhbGx5IHRvb1xuICAvLyB0aGUgYWN0dWFsIGFsaWFzIHVwZGF0ZSB3aWxsIGhhcHBlbiBpZiB3ZSBjaGFuZ2UgdGhlIGZ1bmN0aW9uXG4gIGlmIChjaGFuZ2UubmV3VmFsdWUuVHlwZSA9PT0gJ0FXUzo6TGFtYmRhOjpBbGlhcycpIHtcbiAgICByZXR1cm4gY2xhc3NpZnlBbGlhc0NoYW5nZXMoY2hhbmdlKTtcbiAgfVxuXG4gIGlmIChjaGFuZ2UubmV3VmFsdWUuVHlwZSAhPT0gJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbicpIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCByZXQ6IEhvdHN3YXBDaGFuZ2VbXSA9IFtdO1xuICBjb25zdCBjbGFzc2lmaWVkQ2hhbmdlcyA9IGNsYXNzaWZ5Q2hhbmdlcyhjaGFuZ2UsIFsnQ29kZScsICdFbnZpcm9ubWVudCcsICdEZXNjcmlwdGlvbiddKTtcbiAgY2xhc3NpZmllZENoYW5nZXMucmVwb3J0Tm9uSG90c3dhcHBhYmxlUHJvcGVydHlDaGFuZ2VzKHJldCk7XG5cbiAgY29uc3QgZnVuY3Rpb25OYW1lID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5lc3RhYmxpc2hSZXNvdXJjZVBoeXNpY2FsTmFtZShcbiAgICBsb2dpY2FsSWQsXG4gICAgY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LkZ1bmN0aW9uTmFtZSxcbiAgKTtcbiAgY29uc3QgbmFtZXNPZkhvdHN3YXBwYWJsZUNoYW5nZXMgPSBPYmplY3Qua2V5cyhjbGFzc2lmaWVkQ2hhbmdlcy5ob3Rzd2FwcGFibGVQcm9wcyk7XG4gIGlmIChmdW5jdGlvbk5hbWUgJiYgbmFtZXNPZkhvdHN3YXBwYWJsZUNoYW5nZXMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IGxhbWJkYUNvZGVDaGFuZ2UgPSBhd2FpdCBldmFsdWF0ZUxhbWJkYUZ1bmN0aW9uUHJvcHMoXG4gICAgICBjbGFzc2lmaWVkQ2hhbmdlcy5ob3Rzd2FwcGFibGVQcm9wcyxcbiAgICAgIGNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzPy5SdW50aW1lLFxuICAgICAgZXZhbHVhdGVDZm5UZW1wbGF0ZSxcbiAgICApO1xuXG4gICAgLy8gbm90aGluZyB0byBkbyBoZXJlXG4gICAgaWYgKGxhbWJkYUNvZGVDaGFuZ2UgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHJldDtcbiAgICB9XG5cbiAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBhd2FpdCBkZXBlbmRhbnRSZXNvdXJjZXMobG9naWNhbElkLCBmdW5jdGlvbk5hbWUsIGV2YWx1YXRlQ2ZuVGVtcGxhdGUpO1xuXG4gICAgcmV0LnB1c2goe1xuICAgICAgY2hhbmdlOiB7XG4gICAgICAgIGNhdXNlOiBjaGFuZ2UsXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgICAgIHJlc291cmNlVHlwZTogY2hhbmdlLm5ld1ZhbHVlLlR5cGUsXG4gICAgICAgICAgICBwaHlzaWNhbE5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgIG1ldGFkYXRhOiBldmFsdWF0ZUNmblRlbXBsYXRlLm1ldGFkYXRhRm9yKGxvZ2ljYWxJZCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICAuLi5kZXBlbmRlbmNpZXMsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgaG90c3dhcHBhYmxlOiB0cnVlLFxuICAgICAgc2VydmljZTogJ2xhbWJkYScsXG4gICAgICBhcHBseTogYXN5bmMgKHNkazogU0RLKSA9PiB7XG4gICAgICAgIGNvbnN0IGxhbWJkYSA9IHNkay5sYW1iZGEoKTtcbiAgICAgICAgY29uc3Qgb3BlcmF0aW9uczogUHJvbWlzZTxhbnk+W10gPSBbXTtcblxuICAgICAgICBpZiAobGFtYmRhQ29kZUNoYW5nZS5jb2RlICE9PSB1bmRlZmluZWQgfHwgbGFtYmRhQ29kZUNoYW5nZS5jb25maWd1cmF0aW9ucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKGxhbWJkYUNvZGVDaGFuZ2UuY29kZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zdCB1cGRhdGVGdW5jdGlvbkNvZGVSZXNwb25zZSA9IGF3YWl0IGxhbWJkYS51cGRhdGVGdW5jdGlvbkNvZGUoe1xuICAgICAgICAgICAgICBGdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgICAgUzNCdWNrZXQ6IGxhbWJkYUNvZGVDaGFuZ2UuY29kZS5zM0J1Y2tldCxcbiAgICAgICAgICAgICAgUzNLZXk6IGxhbWJkYUNvZGVDaGFuZ2UuY29kZS5zM0tleSxcbiAgICAgICAgICAgICAgSW1hZ2VVcmk6IGxhbWJkYUNvZGVDaGFuZ2UuY29kZS5pbWFnZVVyaSxcbiAgICAgICAgICAgICAgWmlwRmlsZTogbGFtYmRhQ29kZUNoYW5nZS5jb2RlLmZ1bmN0aW9uQ29kZVppcCxcbiAgICAgICAgICAgICAgUzNPYmplY3RWZXJzaW9uOiBsYW1iZGFDb2RlQ2hhbmdlLmNvZGUuczNPYmplY3RWZXJzaW9uLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IHdhaXRGb3JMYW1iZGFzUHJvcGVydGllc1VwZGF0ZVRvRmluaXNoKHVwZGF0ZUZ1bmN0aW9uQ29kZVJlc3BvbnNlLCBsYW1iZGEsIGZ1bmN0aW9uTmFtZSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGxhbWJkYUNvZGVDaGFuZ2UuY29uZmlndXJhdGlvbnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc3QgdXBkYXRlUmVxdWVzdDogVXBkYXRlRnVuY3Rpb25Db25maWd1cmF0aW9uQ29tbWFuZElucHV0ID0ge1xuICAgICAgICAgICAgICBGdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAobGFtYmRhQ29kZUNoYW5nZS5jb25maWd1cmF0aW9ucy5kZXNjcmlwdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3QuRGVzY3JpcHRpb24gPSBsYW1iZGFDb2RlQ2hhbmdlLmNvbmZpZ3VyYXRpb25zLmRlc2NyaXB0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGxhbWJkYUNvZGVDaGFuZ2UuY29uZmlndXJhdGlvbnMuZW52aXJvbm1lbnQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LkVudmlyb25tZW50ID0gbGFtYmRhQ29kZUNoYW5nZS5jb25maWd1cmF0aW9ucy5lbnZpcm9ubWVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHVwZGF0ZUZ1bmN0aW9uQ29kZVJlc3BvbnNlID0gYXdhaXQgbGFtYmRhLnVwZGF0ZUZ1bmN0aW9uQ29uZmlndXJhdGlvbih1cGRhdGVSZXF1ZXN0KTtcbiAgICAgICAgICAgIGF3YWl0IHdhaXRGb3JMYW1iZGFzUHJvcGVydGllc1VwZGF0ZVRvRmluaXNoKHVwZGF0ZUZ1bmN0aW9uQ29kZVJlc3BvbnNlLCBsYW1iZGEsIGZ1bmN0aW9uTmFtZSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gb25seSBpZiB0aGUgY29kZSBjaGFuZ2VkIGlzIHRoZXJlIGFueSBwb2ludCBpbiBwdWJsaXNoaW5nIGEgbmV3IFZlcnNpb25cbiAgICAgICAgICBjb25zdCB2ZXJzaW9ucyA9IGRlcGVuZGVuY2llcy5maWx0ZXIoKGQpID0+IGQucmVzb3VyY2VUeXBlID09PSAnQVdTOjpMYW1iZGE6OlZlcnNpb24nKTtcbiAgICAgICAgICBpZiAodmVyc2lvbnMubGVuZ3RoKSB7XG4gICAgICAgICAgICBjb25zdCBwdWJsaXNoVmVyc2lvblByb21pc2UgPSBsYW1iZGEucHVibGlzaFZlcnNpb24oe1xuICAgICAgICAgICAgICBGdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBjb25zdCBhbGlhc2VzID0gZGVwZW5kZW5jaWVzLmZpbHRlcigoZCkgPT4gZC5yZXNvdXJjZVR5cGUgPT09ICdBV1M6OkxhbWJkYTo6QWxpYXMnKTtcbiAgICAgICAgICAgIGlmIChhbGlhc2VzLmxlbmd0aCkge1xuICAgICAgICAgICAgICAvLyB3ZSBuZWVkIHRvIHdhaXQgZm9yIHRoZSBWZXJzaW9uIHRvIGZpbmlzaCBwdWJsaXNoaW5nXG4gICAgICAgICAgICAgIGNvbnN0IHZlcnNpb25VcGRhdGUgPSBhd2FpdCBwdWJsaXNoVmVyc2lvblByb21pc2U7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgYWxpYXMgb2YgYWxpYXNlcykge1xuICAgICAgICAgICAgICAgIG9wZXJhdGlvbnMucHVzaChcbiAgICAgICAgICAgICAgICAgIGxhbWJkYS51cGRhdGVBbGlhcyh7XG4gICAgICAgICAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogZnVuY3Rpb25OYW1lLFxuICAgICAgICAgICAgICAgICAgICBOYW1lOiBhbGlhcy5waHlzaWNhbE5hbWUsXG4gICAgICAgICAgICAgICAgICAgIEZ1bmN0aW9uVmVyc2lvbjogdmVyc2lvblVwZGF0ZS5WZXJzaW9uLFxuICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgb3BlcmF0aW9ucy5wdXNoKHB1Ymxpc2hWZXJzaW9uUHJvbWlzZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gcnVuIGFsbCBvZiBvdXIgdXBkYXRlcyBpbiBwYXJhbGxlbFxuICAgICAgICAvLyBMaW1pdGVkIHNldCBvZiB1cGRhdGVzIHBlciBmdW5jdGlvblxuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQGNka2xhYnMvcHJvbWlzZWFsbC1uby11bmJvdW5kZWQtcGFyYWxsZWxpc21cbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwob3BlcmF0aW9ucyk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHJldDtcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmVzIHdoaWNoIGNoYW5nZXMgdG8gdGhpcyBBbGlhcyBhcmUgaG90c3dhcHBhYmxlIG9yIG5vdFxuICovXG5mdW5jdGlvbiBjbGFzc2lmeUFsaWFzQ2hhbmdlcyhjaGFuZ2U6IFJlc291cmNlQ2hhbmdlKTogSG90c3dhcENoYW5nZVtdIHtcbiAgY29uc3QgcmV0OiBIb3Rzd2FwQ2hhbmdlW10gPSBbXTtcbiAgY29uc3QgY2xhc3NpZmllZENoYW5nZXMgPSBjbGFzc2lmeUNoYW5nZXMoY2hhbmdlLCBbJ0Z1bmN0aW9uVmVyc2lvbiddKTtcbiAgY2xhc3NpZmllZENoYW5nZXMucmVwb3J0Tm9uSG90c3dhcHBhYmxlUHJvcGVydHlDaGFuZ2VzKHJldCk7XG5cbiAgLy8gd2Ugb25seSB3YW50IHRvIHJlcG9ydCBub3QgaG90c3dhcHBhYmxlIGNoYW5nZXMgdG8gYWxpYXNlc1xuICAvLyB0aGUgYWN0dWFsIGFsaWFzIHVwZGF0ZSB3aWxsIGhhcHBlbiBpZiB3ZSBjaGFuZ2UgdGhlIGZ1bmN0aW9uXG5cbiAgcmV0dXJuIHJldDtcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZXMgdGhlIGhvdHN3YXBwYWJsZSBwcm9wZXJ0aWVzIG9mIGFuIEFXUzo6TGFtYmRhOjpGdW5jdGlvbiBhbmRcbiAqIFJldHVybnMgYSBgTGFtYmRhRnVuY3Rpb25DaGFuZ2VgIGlmIHRoZSBjaGFuZ2UgaXMgaG90c3dhcHBhYmxlLlxuICogUmV0dXJucyBgdW5kZWZpbmVkYCBpZiB0aGUgY2hhbmdlIGlzIG5vdCBob3Rzd2FwcGFibGUuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGV2YWx1YXRlTGFtYmRhRnVuY3Rpb25Qcm9wcyhcbiAgaG90c3dhcHBhYmxlUHJvcENoYW5nZXM6IFJlY29yZDxzdHJpbmcsIFByb3BlcnR5RGlmZmVyZW5jZTxhbnk+PixcbiAgcnVudGltZTogc3RyaW5nLFxuICBldmFsdWF0ZUNmblRlbXBsYXRlOiBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUsXG4pOiBQcm9taXNlPExhbWJkYUZ1bmN0aW9uQ2hhbmdlIHwgdW5kZWZpbmVkPiB7XG4gIC8qXG4gICAqIEF0IGZpcnN0IGdsYW5jZSwgd2Ugd291bGQgd2FudCB0byBpbml0aWFsaXplIHRoZXNlIHVzaW5nIHRoZSBcInByZXZpb3VzXCIgdmFsdWVzIChjaGFuZ2Uub2xkVmFsdWUpLFxuICAgKiBpbiBjYXNlIG9ubHkgb25lIG9mIHRoZW0gY2hhbmdlZCwgbGlrZSB0aGUga2V5LCBhbmQgdGhlIEJ1Y2tldCBzdGF5ZWQgdGhlIHNhbWUuXG4gICAqIEhvd2V2ZXIsIHRoYXQgYWN0dWFsbHkgZmFpbHMgZm9yIG9sZC1zdHlsZSBzeW50aGVzaXMsIHdoaWNoIHVzZXMgQ0ZOIFBhcmFtZXRlcnMhXG4gICAqIEJlY2F1c2UgdGhlIG5hbWVzIG9mIHRoZSBQYXJhbWV0ZXJzIGRlcGVuZCBvbiB0aGUgaGFzaCBvZiB0aGUgQXNzZXQsXG4gICAqIHRoZSBQYXJhbWV0ZXJzIHVzZWQgZm9yIHRoZSBcIm9sZFwiIHZhbHVlcyBubyBsb25nZXIgZXhpc3QgaW4gYGFzc2V0UGFyYW1zYCBhdCB0aGlzIHBvaW50LFxuICAgKiB3aGljaCBtZWFucyB3ZSBkb24ndCBoYXZlIHRoZSBjb3JyZWN0IHZhbHVlcyBhdmFpbGFibGUgdG8gZXZhbHVhdGUgdGhlIENGTiBleHByZXNzaW9uIHdpdGguXG4gICAqIEZvcnR1bmF0ZWx5LCB0aGUgZGlmZiB3aWxsIGFsd2F5cyBpbmNsdWRlIGJvdGggdGhlIHMzQnVja2V0IGFuZCBzM0tleSBwYXJ0cyBvZiB0aGUgTGFtYmRhJ3MgQ29kZSBwcm9wZXJ0eSxcbiAgICogZXZlbiBpZiBvbmx5IG9uZSBvZiB0aGVtIHdhcyBhY3R1YWxseSBjaGFuZ2VkLFxuICAgKiB3aGljaCBtZWFucyB3ZSBkb24ndCBuZWVkIHRoZSBcIm9sZFwiIHZhbHVlcyBhdCBhbGwsIGFuZCB3ZSBjYW4gc2FmZWx5IGluaXRpYWxpemUgdGhlc2Ugd2l0aCBqdXN0IGAnJ2AuXG4gICAqL1xuICBsZXQgY29kZTogTGFtYmRhRnVuY3Rpb25Db2RlIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICBsZXQgZGVzY3JpcHRpb246IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgbGV0IGVudmlyb25tZW50OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9IHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuXG4gIGZvciAoY29uc3QgdXBkYXRlZFByb3BOYW1lIGluIGhvdHN3YXBwYWJsZVByb3BDaGFuZ2VzKSB7XG4gICAgY29uc3QgdXBkYXRlZFByb3AgPSBob3Rzd2FwcGFibGVQcm9wQ2hhbmdlc1t1cGRhdGVkUHJvcE5hbWVdO1xuXG4gICAgc3dpdGNoICh1cGRhdGVkUHJvcE5hbWUpIHtcbiAgICAgIGNhc2UgJ0NvZGUnOlxuICAgICAgICBsZXQgczNCdWNrZXQsIHMzS2V5LCBzM09iamVjdFZlcnNpb24sIGltYWdlVXJpLCBmdW5jdGlvbkNvZGVaaXA7XG5cbiAgICAgICAgZm9yIChjb25zdCBuZXdQcm9wTmFtZSBpbiB1cGRhdGVkUHJvcC5uZXdWYWx1ZSkge1xuICAgICAgICAgIHN3aXRjaCAobmV3UHJvcE5hbWUpIHtcbiAgICAgICAgICAgIGNhc2UgJ1MzQnVja2V0JzpcbiAgICAgICAgICAgICAgczNCdWNrZXQgPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih1cGRhdGVkUHJvcC5uZXdWYWx1ZVtuZXdQcm9wTmFtZV0pO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ1MzS2V5JzpcbiAgICAgICAgICAgICAgczNLZXkgPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih1cGRhdGVkUHJvcC5uZXdWYWx1ZVtuZXdQcm9wTmFtZV0pO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ1MzT2JqZWN0VmVyc2lvbic6XG4gICAgICAgICAgICAgIHMzT2JqZWN0VmVyc2lvbiA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKHVwZGF0ZWRQcm9wLm5ld1ZhbHVlW25ld1Byb3BOYW1lXSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnSW1hZ2VVcmknOlxuICAgICAgICAgICAgICBpbWFnZVVyaSA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKHVwZGF0ZWRQcm9wLm5ld1ZhbHVlW25ld1Byb3BOYW1lXSk7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSAnWmlwRmlsZSc6XG4gICAgICAgICAgICAgIC8vIFdlIG11c3QgY3JlYXRlIGEgemlwIHBhY2thZ2UgY29udGFpbmluZyBhIGZpbGUgd2l0aCB0aGUgaW5saW5lIGNvZGVcbiAgICAgICAgICAgICAgY29uc3QgZnVuY3Rpb25Db2RlID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24odXBkYXRlZFByb3AubmV3VmFsdWVbbmV3UHJvcE5hbWVdKTtcbiAgICAgICAgICAgICAgY29uc3QgZnVuY3Rpb25SdW50aW1lID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24ocnVudGltZSk7XG4gICAgICAgICAgICAgIGlmICghZnVuY3Rpb25SdW50aW1lKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAvLyBmaWxlIGV4dGVuc2lvbiBtdXN0IGJlIGNob3NlbiBkZXBlbmRpbmcgb24gdGhlIHJ1bnRpbWVcbiAgICAgICAgICAgICAgY29uc3QgY29kZUZpbGVFeHQgPSBkZXRlcm1pbmVDb2RlRmlsZUV4dEZyb21SdW50aW1lKGZ1bmN0aW9uUnVudGltZSk7XG4gICAgICAgICAgICAgIGZ1bmN0aW9uQ29kZVppcCA9IGF3YWl0IHppcFN0cmluZyhgaW5kZXguJHtjb2RlRmlsZUV4dH1gLCBmdW5jdGlvbkNvZGUpO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY29kZSA9IHtcbiAgICAgICAgICBzM0J1Y2tldCxcbiAgICAgICAgICBzM0tleSxcbiAgICAgICAgICBzM09iamVjdFZlcnNpb24sXG4gICAgICAgICAgaW1hZ2VVcmksXG4gICAgICAgICAgZnVuY3Rpb25Db2RlWmlwLFxuICAgICAgICB9O1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0Rlc2NyaXB0aW9uJzpcbiAgICAgICAgZGVzY3JpcHRpb24gPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih1cGRhdGVkUHJvcC5uZXdWYWx1ZSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnRW52aXJvbm1lbnQnOlxuICAgICAgICBlbnZpcm9ubWVudCA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKHVwZGF0ZWRQcm9wLm5ld1ZhbHVlKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICAvLyB3ZSB3aWxsIG5ldmVyIGdldCBoZXJlLCBidXQganVzdCBpbiBjYXNlIHdlIGRvIHRocm93IGFuIGVycm9yXG4gICAgICAgIHRocm93IG5ldyBUb29sa2l0RXJyb3IoXG4gICAgICAgICAgJ3doaWxlIGFwcGx5KClpbmcsIGZvdW5kIGEgcHJvcGVydHkgdGhhdCBjYW5ub3QgYmUgaG90c3dhcHBlZC4gUGxlYXNlIHJlcG9ydCB0aGlzIGF0IGdpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzL25ldy9jaG9vc2UnLFxuICAgICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGNvbmZpZ3VyYXRpb25zID0gZGVzY3JpcHRpb24gfHwgZW52aXJvbm1lbnQgPyB7IGRlc2NyaXB0aW9uLCBlbnZpcm9ubWVudCB9IDogdW5kZWZpbmVkO1xuICByZXR1cm4gY29kZSB8fCBjb25maWd1cmF0aW9ucyA/IHsgY29kZSwgY29uZmlndXJhdGlvbnMgfSA6IHVuZGVmaW5lZDtcbn1cblxuaW50ZXJmYWNlIExhbWJkYUZ1bmN0aW9uQ29kZSB7XG4gIHJlYWRvbmx5IHMzQnVja2V0Pzogc3RyaW5nO1xuICByZWFkb25seSBzM0tleT86IHN0cmluZztcbiAgcmVhZG9ubHkgczNPYmplY3RWZXJzaW9uPzogc3RyaW5nO1xuICByZWFkb25seSBpbWFnZVVyaT86IHN0cmluZztcbiAgcmVhZG9ubHkgZnVuY3Rpb25Db2RlWmlwPzogQnVmZmVyO1xufVxuXG5pbnRlcmZhY2UgTGFtYmRhRnVuY3Rpb25Db25maWd1cmF0aW9ucyB7XG4gIHJlYWRvbmx5IGRlc2NyaXB0aW9uPzogc3RyaW5nO1xuICByZWFkb25seSBlbnZpcm9ubWVudD86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG59XG5cbmludGVyZmFjZSBMYW1iZGFGdW5jdGlvbkNoYW5nZSB7XG4gIHJlYWRvbmx5IGNvZGU/OiBMYW1iZGFGdW5jdGlvbkNvZGU7XG4gIHJlYWRvbmx5IGNvbmZpZ3VyYXRpb25zPzogTGFtYmRhRnVuY3Rpb25Db25maWd1cmF0aW9ucztcbn1cblxuLyoqXG4gKiBDb21wcmVzcyBhIHN0cmluZyBhcyBhIGZpbGUsIHJldHVybmluZyBhIHByb21pc2UgZm9yIHRoZSB6aXAgYnVmZmVyXG4gKiBodHRwczovL2dpdGh1Yi5jb20vYXJjaGl2ZXJqcy9ub2RlLWFyY2hpdmVyL2lzc3Vlcy8zNDJcbiAqL1xuZnVuY3Rpb24gemlwU3RyaW5nKGZpbGVOYW1lOiBzdHJpbmcsIHJhd1N0cmluZzogc3RyaW5nKTogUHJvbWlzZTxCdWZmZXI+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBidWZmZXJzOiBCdWZmZXJbXSA9IFtdO1xuXG4gICAgY29uc3QgY29udmVydGVyID0gbmV3IFdyaXRhYmxlKCk7XG5cbiAgICBjb252ZXJ0ZXIuX3dyaXRlID0gKGNodW5rOiBCdWZmZXIsIF86IHN0cmluZywgY2FsbGJhY2s6ICgpID0+IHZvaWQpID0+IHtcbiAgICAgIGJ1ZmZlcnMucHVzaChjaHVuayk7XG4gICAgICBwcm9jZXNzLm5leHRUaWNrKGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgY29udmVydGVyLm9uKCdmaW5pc2gnLCAoKSA9PiB7XG4gICAgICByZXNvbHZlKEJ1ZmZlci5jb25jYXQoYnVmZmVycykpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgYXJjaGl2ZSA9IGFyY2hpdmVyKCd6aXAnKTtcblxuICAgIGFyY2hpdmUub24oJ2Vycm9yJywgKGVycjogYW55KSA9PiB7XG4gICAgICByZWplY3QoZXJyKTtcbiAgICB9KTtcblxuICAgIGFyY2hpdmUucGlwZShjb252ZXJ0ZXIpO1xuXG4gICAgYXJjaGl2ZS5hcHBlbmQocmF3U3RyaW5nLCB7XG4gICAgICBuYW1lOiBmaWxlTmFtZSxcbiAgICAgIGRhdGU6IG5ldyBEYXRlKCcxOTgwLTAxLTAxVDAwOjAwOjAwLjAwMFonKSwgLy8gQWRkIGRhdGUgdG8gbWFrZSByZXN1bHRpbmcgemlwIGZpbGUgZGV0ZXJtaW5pc3RpY1xuICAgIH0pO1xuXG4gICAgdm9pZCBhcmNoaXZlLmZpbmFsaXplKCk7XG4gIH0pO1xufVxuXG4vKipcbiAqIEFmdGVyIGEgTGFtYmRhIEZ1bmN0aW9uIGlzIHVwZGF0ZWQsIGl0IGNhbm5vdCBiZSB1cGRhdGVkIGFnYWluIHVudGlsIHRoZVxuICogYFN0YXRlPUFjdGl2ZWAgYW5kIHRoZSBgTGFzdFVwZGF0ZVN0YXR1cz1TdWNjZXNzZnVsYC5cbiAqXG4gKiBEZXBlbmRpbmcgb24gdGhlIGNvbmZpZ3VyYXRpb24gb2YgdGhlIExhbWJkYSBGdW5jdGlvbiB0aGlzIGNvdWxkIGhhcHBlbiByZWxhdGl2ZWx5IHF1aWNrbHlcbiAqIG9yIHZlcnkgc2xvd2x5LiBGb3IgZXhhbXBsZSwgWmlwIGJhc2VkIGZ1bmN0aW9ucyBfbm90XyBpbiBhIFZQQyBjYW4gdGFrZSB+MSBzZWNvbmQgd2hlcmVhcyBWUENcbiAqIG9yIENvbnRhaW5lciBmdW5jdGlvbnMgY2FuIHRha2UgfjI1IHNlY29uZHMgKGFuZCAnaWRsZScgVlBDIGZ1bmN0aW9ucyBjYW4gdGFrZSBtaW51dGVzKS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckxhbWJkYXNQcm9wZXJ0aWVzVXBkYXRlVG9GaW5pc2goXG4gIGN1cnJlbnRGdW5jdGlvbkNvbmZpZ3VyYXRpb246IEZ1bmN0aW9uQ29uZmlndXJhdGlvbixcbiAgbGFtYmRhOiBJTGFtYmRhQ2xpZW50LFxuICBmdW5jdGlvbk5hbWU6IHN0cmluZyxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBmdW5jdGlvbklzSW5WcGNPclVzZXNEb2NrZXJGb3JDb2RlID1cbiAgICBjdXJyZW50RnVuY3Rpb25Db25maWd1cmF0aW9uLlZwY0NvbmZpZz8uVnBjSWQgfHwgY3VycmVudEZ1bmN0aW9uQ29uZmlndXJhdGlvbi5QYWNrYWdlVHlwZSA9PT0gJ0ltYWdlJztcblxuICAvLyBpZiB0aGUgZnVuY3Rpb24gaXMgZGVwbG95ZWQgaW4gYSBWUEMgb3IgaWYgaXQgaXMgYSBjb250YWluZXIgaW1hZ2UgZnVuY3Rpb25cbiAgLy8gdGhlbiB0aGUgdXBkYXRlIHdpbGwgdGFrZSBtdWNoIGxvbmdlciBhbmQgd2UgY2FuIHdhaXQgbG9uZ2VyIGJldHdlZW4gY2hlY2tzXG4gIC8vIG90aGVyd2lzZSwgdGhlIHVwZGF0ZSB3aWxsIGJlIHF1aWNrLCBzbyBhIDEtc2Vjb25kIGRlbGF5IGlzIGZpbmVcbiAgY29uc3QgZGVsYXlTZWNvbmRzID0gZnVuY3Rpb25Jc0luVnBjT3JVc2VzRG9ja2VyRm9yQ29kZSA/IDUgOiAxO1xuXG4gIGF3YWl0IGxhbWJkYS53YWl0VW50aWxGdW5jdGlvblVwZGF0ZWQoZGVsYXlTZWNvbmRzLCB7XG4gICAgRnVuY3Rpb25OYW1lOiBmdW5jdGlvbk5hbWUsXG4gIH0pO1xufVxuXG4vKipcbiAqIEdldCBmaWxlIGV4dGVuc2lvbiBmcm9tIExhbWJkYSBydW50aW1lIHN0cmluZy5cbiAqIFdlIHVzZSB0aGlzIGV4dGVuc2lvbiB0byBjcmVhdGUgYSBkZXBsb3ltZW50IHBhY2thZ2UgZnJvbSBMYW1iZGEgaW5saW5lIGNvZGUuXG4gKi9cbmZ1bmN0aW9uIGRldGVybWluZUNvZGVGaWxlRXh0RnJvbVJ1bnRpbWUocnVudGltZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKHJ1bnRpbWUuc3RhcnRzV2l0aCgnbm9kZScpKSB7XG4gICAgcmV0dXJuICdqcyc7XG4gIH1cbiAgaWYgKHJ1bnRpbWUuc3RhcnRzV2l0aCgncHl0aG9uJykpIHtcbiAgICByZXR1cm4gJ3B5JztcbiAgfVxuICAvLyBDdXJyZW50bHkgaW5saW5lIGNvZGUgb25seSBzdXBwb3J0cyBOb2RlLmpzIGFuZCBQeXRob24sIGlnbm9yaW5nIG90aGVyIHJ1bnRpbWVzLlxuICAvLyBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTQ2xvdWRGb3JtYXRpb24vbGF0ZXN0L1VzZXJHdWlkZS9hd3MtcHJvcGVydGllcy1sYW1iZGEtZnVuY3Rpb24tY29kZS5odG1sI2F3cy1wcm9wZXJ0aWVzLWxhbWJkYS1mdW5jdGlvbi1jb2RlLXByb3BlcnRpZXNcbiAgdGhyb3cgbmV3IENmbkV2YWx1YXRpb25FeGNlcHRpb24oXG4gICAgYHJ1bnRpbWUgJHtydW50aW1lfSBpcyB1bnN1cHBvcnRlZCwgb25seSBub2RlLmpzIGFuZCBweXRob24gcnVudGltZXMgYXJlIGN1cnJlbnRseSBzdXBwb3J0ZWQuYCxcbiAgKTtcbn1cblxuLyoqXG4gKiBGaW5kcyBhbGwgVmVyc2lvbnMgdGhhdCByZWZlcmVuY2UgYW4gQVdTOjpMYW1iZGE6OkZ1bmN0aW9uIHdpdGggbG9naWNhbCBJRCBgbG9naWNhbElkYFxuICogYW5kIEFsaWFzZXMgdGhhdCByZWZlcmVuY2UgdGhvc2UgVmVyc2lvbnMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHZlcnNpb25zQW5kQWxpYXNlcyhsb2dpY2FsSWQ6IHN0cmluZywgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlKSB7XG4gIC8vIGZpbmQgYWxsIExhbWJkYSBWZXJzaW9ucyB0aGF0IHJlZmVyZW5jZSB0aGlzIEZ1bmN0aW9uXG4gIGNvbnN0IHZlcnNpb25zUmVmZXJlbmNpbmdGdW5jdGlvbiA9IGV2YWx1YXRlQ2ZuVGVtcGxhdGVcbiAgICAuZmluZFJlZmVyZW5jZXNUbyhsb2dpY2FsSWQpXG4gICAgLmZpbHRlcigocikgPT4gci5UeXBlID09PSAnQVdTOjpMYW1iZGE6OlZlcnNpb24nKTtcbiAgLy8gZmluZCBhbGwgTGFtYmRhIEFsaWFzZXMgdGhhdCByZWZlcmVuY2UgdGhlIGFib3ZlIFZlcnNpb25zXG4gIGNvbnN0IGFsaWFzZXNSZWZlcmVuY2luZ1ZlcnNpb25zID0gZmxhdE1hcCh2ZXJzaW9uc1JlZmVyZW5jaW5nRnVuY3Rpb24sIHYgPT5cbiAgICBldmFsdWF0ZUNmblRlbXBsYXRlLmZpbmRSZWZlcmVuY2VzVG8odi5Mb2dpY2FsSWQpKTtcblxuICByZXR1cm4geyB2ZXJzaW9uc1JlZmVyZW5jaW5nRnVuY3Rpb24sIGFsaWFzZXNSZWZlcmVuY2luZ1ZlcnNpb25zIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRlcGVuZGFudFJlc291cmNlcyhcbiAgbG9naWNhbElkOiBzdHJpbmcsXG4gIGZ1bmN0aW9uTmFtZTogc3RyaW5nLFxuICBldmFsdWF0ZUNmblRlbXBsYXRlOiBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUsXG4pOiBQcm9taXNlPEFycmF5PEFmZmVjdGVkUmVzb3VyY2U+PiB7XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBhd2FpdCB2ZXJzaW9uc0FuZEFsaWFzZXMobG9naWNhbElkLCBldmFsdWF0ZUNmblRlbXBsYXRlKTtcblxuICAvLyBMaW1pdGVkIHNldCBvZiB1cGRhdGVzIHBlciBmdW5jdGlvblxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQGNka2xhYnMvcHJvbWlzZWFsbC1uby11bmJvdW5kZWQtcGFyYWxsZWxpc21cbiAgY29uc3QgYWxpYXNlcyA9IGF3YWl0IFByb21pc2UuYWxsKGNhbmRpZGF0ZXMuYWxpYXNlc1JlZmVyZW5jaW5nVmVyc2lvbnMubWFwKGFzeW5jIChhKSA9PiB7XG4gICAgY29uc3QgbmFtZSA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKGEuUHJvcGVydGllcz8uTmFtZSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxvZ2ljYWxJZDogYS5Mb2dpY2FsSWQsXG4gICAgICByZXNvdXJjZVR5cGU6IGEuVHlwZSxcbiAgICAgIHBoeXNpY2FsTmFtZTogbmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBgJHthLlR5cGV9ICcke25hbWV9JyBmb3IgQVdTOjpMYW1iZGE6OkZ1bmN0aW9uICcke2Z1bmN0aW9uTmFtZX0nYCxcbiAgICAgIG1ldGFkYXRhOiBldmFsdWF0ZUNmblRlbXBsYXRlLm1ldGFkYXRhRm9yKGEuTG9naWNhbElkKSxcbiAgICB9O1xuICB9KSk7XG5cbiAgY29uc3QgdmVyc2lvbnMgPSBjYW5kaWRhdGVzLnZlcnNpb25zUmVmZXJlbmNpbmdGdW5jdGlvbi5tYXAoKHYpID0+IChcbiAgICB7XG4gICAgICBsb2dpY2FsSWQ6IHYuTG9naWNhbElkLFxuICAgICAgcmVzb3VyY2VUeXBlOiB2LlR5cGUsXG4gICAgICBkZXNjcmlwdGlvbjogYCR7di5UeXBlfSBmb3IgQVdTOjpMYW1iZGE6OkZ1bmN0aW9uICcke2Z1bmN0aW9uTmFtZX0nYCxcbiAgICAgIG1ldGFkYXRhOiBldmFsdWF0ZUNmblRlbXBsYXRlLm1ldGFkYXRhRm9yKHYuTG9naWNhbElkKSxcbiAgICB9XG4gICkpO1xuXG4gIHJldHVybiBbXG4gICAgLi4udmVyc2lvbnMsXG4gICAgLi4uYWxpYXNlcyxcbiAgXTtcbn1cbiJdfQ==