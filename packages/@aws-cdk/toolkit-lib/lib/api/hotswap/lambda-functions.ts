import { Writable } from 'stream';
import type { PropertyDifference } from '@aws-cdk/cloudformation-diff';
import type { FunctionConfiguration, UpdateFunctionConfigurationCommandInput } from '@aws-sdk/client-lambda';
import type { HotswapChange } from './common';
import { classifyChanges } from './common';
import type { AffectedResource, ResourceChange } from '../../payloads/hotswap';
import { ToolkitError } from '../../toolkit/toolkit-error';
import { flatMap } from '../../util';
import type { ILambdaClient, SDK } from '../aws-auth/private';
import { CfnEvaluationException, type EvaluateCloudFormationTemplate } from '../cloudformation';

// namespace object imports won't work in the bundle for function exports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');

export async function isHotswappableLambdaFunctionChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<HotswapChange[]> {
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

  const ret: HotswapChange[] = [];
  const classifiedChanges = classifyChanges(change, ['Code', 'Environment', 'Description']);
  classifiedChanges.reportNonHotswappablePropertyChanges(ret);

  const functionName = await evaluateCfnTemplate.establishResourcePhysicalName(
    logicalId,
    change.newValue.Properties?.FunctionName,
  );
  const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
  if (functionName && namesOfHotswappableChanges.length > 0) {
    const lambdaCodeChange = await evaluateLambdaFunctionProps(
      classifiedChanges.hotswappableProps,
      change.newValue.Properties?.Runtime,
      evaluateCfnTemplate,
    );

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
      apply: async (sdk: SDK) => {
        const lambda = sdk.lambda();
        const operations: Promise<any>[] = [];

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
            const updateRequest: UpdateFunctionConfigurationCommandInput = {
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
                operations.push(
                  lambda.updateAlias({
                    FunctionName: functionName,
                    Name: alias.physicalName,
                    FunctionVersion: versionUpdate.Version,
                  }),
                );
              }
            } else {
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
function classifyAliasChanges(change: ResourceChange): HotswapChange[] {
  const ret: HotswapChange[] = [];
  const classifiedChanges = classifyChanges(change, ['FunctionVersion']);
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
async function evaluateLambdaFunctionProps(
  hotswappablePropChanges: Record<string, PropertyDifference<any>>,
  runtime: string,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<LambdaFunctionChange | undefined> {
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
  let code: LambdaFunctionCode | undefined = undefined;
  let description: string | undefined = undefined;
  let environment: { [key: string]: string } | undefined = undefined;

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
        throw new ToolkitError(
          'while apply()ing, found a property that cannot be hotswapped. Please report this at github.com/aws/aws-cdk/issues/new/choose',
        );
    }
  }

  const configurations = description || environment ? { description, environment } : undefined;
  return code || configurations ? { code, configurations } : undefined;
}

interface LambdaFunctionCode {
  readonly s3Bucket?: string;
  readonly s3Key?: string;
  readonly s3ObjectVersion?: string;
  readonly imageUri?: string;
  readonly functionCodeZip?: Buffer;
}

interface LambdaFunctionConfigurations {
  readonly description?: string;
  readonly environment?: { [key: string]: string };
}

interface LambdaFunctionChange {
  readonly code?: LambdaFunctionCode;
  readonly configurations?: LambdaFunctionConfigurations;
}

/**
 * Compress a string as a file, returning a promise for the zip buffer
 * https://github.com/archiverjs/node-archiver/issues/342
 */
function zipString(fileName: string, rawString: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffers: Buffer[] = [];

    const converter = new Writable();

    converter._write = (chunk: Buffer, _: string, callback: () => void) => {
      buffers.push(chunk);
      process.nextTick(callback);
    };

    converter.on('finish', () => {
      resolve(Buffer.concat(buffers));
    });

    const archive = archiver('zip');

    archive.on('error', (err: any) => {
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
async function waitForLambdasPropertiesUpdateToFinish(
  currentFunctionConfiguration: FunctionConfiguration,
  lambda: ILambdaClient,
  functionName: string,
): Promise<void> {
  const functionIsInVpcOrUsesDockerForCode =
    currentFunctionConfiguration.VpcConfig?.VpcId || currentFunctionConfiguration.PackageType === 'Image';

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
function determineCodeFileExtFromRuntime(runtime: string): string {
  if (runtime.startsWith('node')) {
    return 'js';
  }
  if (runtime.startsWith('python')) {
    return 'py';
  }
  // Currently inline code only supports Node.js and Python, ignoring other runtimes.
  // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-code.html#aws-properties-lambda-function-code-properties
  throw new CfnEvaluationException(
    `runtime ${runtime} is unsupported, only node.js and python runtimes are currently supported.`,
  );
}

/**
 * Finds all Versions that reference an AWS::Lambda::Function with logical ID `logicalId`
 * and Aliases that reference those Versions.
 */
async function versionsAndAliases(logicalId: string, evaluateCfnTemplate: EvaluateCloudFormationTemplate) {
  // find all Lambda Versions that reference this Function
  const versionsReferencingFunction = evaluateCfnTemplate
    .findReferencesTo(logicalId)
    .filter((r) => r.Type === 'AWS::Lambda::Version');
  // find all Lambda Aliases that reference the above Versions
  const aliasesReferencingVersions = flatMap(versionsReferencingFunction, v =>
    evaluateCfnTemplate.findReferencesTo(v.LogicalId));

  return { versionsReferencingFunction, aliasesReferencingVersions };
}

async function dependantResources(
  logicalId: string,
  functionName: string,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<Array<AffectedResource>> {
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

  const versions = candidates.versionsReferencingFunction.map((v) => (
    {
      logicalId: v.LogicalId,
      resourceType: v.Type,
      description: `${v.Type} for AWS::Lambda::Function '${functionName}'`,
      metadata: evaluateCfnTemplate.metadataFor(v.LogicalId),
    }
  ));

  return [
    ...versions,
    ...aliases,
  ];
}
