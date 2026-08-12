import { randomUUID } from 'node:crypto';
import { format } from 'node:util';
import type { FileManifestEntry } from '@aws-cdk/cdk-assets-lib';
import { AssetManifest } from '@aws-cdk/cdk-assets-lib';
import * as cxapi from '@aws-cdk/cloud-assembly-api';
import { SSMPARAM_NO_INVALIDATE } from '@aws-cdk/cloud-assembly-api';
import {
  type Parameter,
  type ResourceToImport,
  type Tag,
} from '@aws-sdk/client-cloudformation';
import { AssetManifestBuilder } from './asset-manifest-builder';
import type { Deployments } from './deployments';
import { DeploymentError, ToolkitError } from '../../toolkit/toolkit-error';
import { changeSetNameFromArn, stackNameFromArn } from '../../util/cloudformation';
import { waitFor } from '../../util/promises';
import type { ICloudFormationClient, SdkProvider } from '../aws-auth/private';
import type { ChangeSetReport } from '../change-sets';
import { ChangeSetDescriber } from '../change-sets';
import type { Template, TemplateBodyParameter, TemplateParameter } from '../cloudformation';
import { CloudFormationStack, makeBodyParameter } from '../cloudformation';
import { CloudFormationStackDiagnoser } from '../diagnosing/stack-diagnoser';
import type { IoHelper } from '../io/private';
import type { ResourcesToImport } from '../resource-import';
import { StackArtifactSourceTracer } from '../source-tracing/private/stack-source-tracing';

export type PrepareChangeSetOptions = {
  stack: cxapi.CloudFormationStackArtifact;
  deployments: Deployments;
  uuid: string;
  sdkProvider: SdkProvider;
  parameters: { [name: string]: string | undefined };
  resourcesToImport?: ResourcesToImport;
  importExistingResources?: boolean;
  includeNestedStacks?: boolean;
  /**
   * Default behavior is to log AWS CloudFormation errors and move on. Set this property to true to instead
   * fail on errors received by AWS CloudFormation.
   *
   * @default false
   */
  failOnError?: boolean;
};

export interface CreateChangeSetOptions {
  cfn: ICloudFormationClient;
  changeSetName: string;
  exists: boolean;
  uuid: string;
  stack: cxapi.CloudFormationStackArtifact;
  bodyParameter: TemplateBodyParameter;
  parameters: { [name: string]: string | undefined };
  resourcesToImport?: ResourceToImport[];
  importExistingResources?: boolean;
  includeNestedStacks?: boolean;
  role?: string;
  diagnoser: CloudFormationStackDiagnoser;
}

/**
 * Create a changeset for a diff operation
 */
export async function createDiffChangeSet(
  ioHelper: IoHelper,
  options: Omit<PrepareChangeSetOptions, 'includeNestedStacks' | 'diagnoser'>,
): Promise<ChangeSetReport | undefined> {
  try {
    const { cfn, bodyParameter, exists, executionRoleArn, diagnoser } = await prepareChangeSetEnv(ioHelper, options);

    await ioHelper.defaults.info(
      'Hold on while we create a read-only change set to get a diff with accurate replacement information (use --method=template to use a less accurate but faster template-only diff)\n',
    );

    return await createChangeSetAndCleanup(ioHelper, {
      cfn,
      changeSetName: 'cdk-diff-change-set',
      stack: options.stack,
      exists,
      uuid: options.uuid,
      bodyParameter,
      parameters: options.parameters,
      resourcesToImport: options.resourcesToImport,
      importExistingResources: options.importExistingResources,
      includeNestedStacks: true,
      role: executionRoleArn,
      diagnoser,
    });
  } catch (e: any) {
    // This function is currently only used by diff so these messages are diff-specific
    if (options.failOnError) {
      throw ToolkitError.withCause('ChangeSetCreationFailed', 'Could not create a change set, and \'--method=change-set\' was specified. Please check your permissions or use \'--method=auto\' to allow falling back to a template diff.', e);
    }

    await ioHelper.defaults.debug(String(e));
    await ioHelper.defaults.info(
      'Could not create a change set, will base the diff on template differences (run again with -v to see the reason)\n',
    );

    return undefined;
  }
}

/**
 * Returns all file entries from an AssetManifestArtifact that look like templates.
 *
 * This is used in the `uploadBodyParameterAndCreateChangeSet` function to find
 * all template asset files to build and publish.
 *
 * Returns a tuple of [AssetManifest, FileManifestEntry[]]
 */
function templatesFromAssetManifestArtifact(
  artifact: cxapi.AssetManifestArtifact,
): [AssetManifest, FileManifestEntry[]] {
  const assets: FileManifestEntry[] = [];
  const fileName = artifact.file;
  const assetManifest = AssetManifest.fromFile(fileName);

  assetManifest.entries.forEach((entry) => {
    if (entry.type === 'file') {
      const source = (entry as FileManifestEntry).source;
      if (source.path && source.path.endsWith('.template.json')) {
        assets.push(entry as FileManifestEntry);
      }
    }
  });
  return [assetManifest, assets];
}

interface PreparedChangeSetEnv {
  cfn: ICloudFormationClient;
  bodyParameter: TemplateBodyParameter;
  exists: boolean;
  stackExistedBefore: boolean;
  executionRoleArn: string | undefined;
  diagnoser: CloudFormationStackDiagnoser;
}

async function prepareChangeSetEnv(
  ioHelper: IoHelper,
  options: { stack: cxapi.CloudFormationStackArtifact; deployments: Deployments },
): Promise<PreparedChangeSetEnv> {
  const env = await options.deployments.envs.accessStackForMutableStackOperations(options.stack);
  await uploadStackTemplateAssets(options.stack, options.deployments);
  const bodyParameter = await makeBodyParameter(
    ioHelper,
    options.stack,
    env.resolvedEnvironment,
    new AssetManifestBuilder(),
    env.resources,
  );
  const cfn = env.sdk.cloudFormation();
  const stack = await CloudFormationStack.lookup(cfn, options.stack.stackName, false);
  // A stack in REVIEW_IN_PROGRESS was created by a previous CREATE changeset
  // that was never executed. Treat it as non-existent for changeset purposes.
  const exists = stack.exists && stack.stackStatus.name !== 'REVIEW_IN_PROGRESS' && stack.stackStatus.name !== 'DELETE_IN_PROGRESS';
  const executionRoleArn = await env.replacePlaceholders(options.stack.cloudFormationExecutionRoleArn);
  const diagnoser = new CloudFormationStackDiagnoser({
    sdk: env.sdk,
    envResources: env.resources,
    sourceTracer: new StackArtifactSourceTracer(options.stack),
    ioHelper,
    topLevelStackHierarchicalId: options.stack.hierarchicalId,
  });

  return { cfn, bodyParameter, exists, stackExistedBefore: stack.exists, executionRoleArn, diagnoser };
}

/**
 * Uploads the assets that look like templates for this CloudFormation stack
 *
 * This is necessary for any CloudFormation call that needs the template, it may need
 * to be uploaded to an S3 bucket first. We have to follow the instructions in the
 * asset manifest, because technically that is the only place that knows about
 * bucket and assumed roles and such.
 */
export async function uploadStackTemplateAssets(stack: cxapi.CloudFormationStackArtifact, deployments: Deployments) {
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

async function createChangeSetAndCleanup(
  ioHelper: IoHelper,
  options: CreateChangeSetOptions,
): Promise<ChangeSetReport> {
  if (options.exists) {
    await cleanupOldChangeset(options.cfn, ioHelper, options.changeSetName, options.stack.stackName);
  }

  await ioHelper.defaults.debug(`Attempting to create ChangeSet with name ${options.changeSetName} for stack ${options.stack.stackName}`);

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
    ImportExistingResources: options.importExistingResources,
    IncludeNestedStacks: options.includeNestedStacks || undefined,
    RoleARN: options.role,
    Tags: toCfnTags(options.stack.tags),
    Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
  });

  await ioHelper.defaults.debug(format('Initiated creation of changeset: %s; waiting for it to finish creating...', changeSet.Id));

  const changeSetId = changeSet.Id ?? options.changeSetName;
  const stackId = changeSet.StackId ?? options.stack.stackName;

  // Remove the change set (and, for a brand new stack, the empty stack that a
  // CREATE change set leaves in REVIEW_IN_PROGRESS). This has to run whether the
  // change set succeeds or fails validation: otherwise a change set that fails
  // early validation is orphaned and leaves the stack stuck in REVIEW_IN_PROGRESS,
  // which then blocks subsequent change set creation.
  const cleanup = async () => {
    await cleanupOldChangeset(options.cfn, ioHelper, changeSetId, stackId);

    if (!options.exists) {
      await ioHelper.defaults.debug(format('Deleting empty stack created by diff changeset: %s', stackId));
      await options.cfn.deleteStack({
        StackName: stackId,
        ClientRequestToken: randomUUID(),
      });
    }
  };

  let createdChangeSet: ChangeSetReport;
  try {
    // Fetching all pages if we'll execute, so we can have the correct change count when monitoring.
    createdChangeSet = await new ChangeSetDescriber({
      cfn: options.cfn,
      ioHelper,
      stackNameOrArn: stackId,
      changeSetNameOrArn: changeSetId,
    }).waitAndThrowOnProblem({
      diagnoser: options.diagnoser,
    });
  } catch (e) {
    // Best-effort cleanup so a failed change set doesn't leak; don't let a
    // cleanup failure mask the original creation/validation error.
    try {
      await cleanup();
    } catch (cleanupError) {
      await ioHelper.defaults.debug(format('Failed to clean up change set after a creation error: %s', cleanupError));
    }
    throw e;
  }

  await cleanup();

  return createdChangeSet;
}

/**
 * Create a change set for online validation (never executes, returns diagnosis instead of throwing).
 *
 * Uses the same env preparation as diff, but calls `waitForReport` to return
 * the diagnosis rather than throwing on failure. Always cleans up the change set afterwards.
 */
export async function createValidationChangeSet(
  ioHelper: IoHelper,
  options: Omit<PrepareChangeSetOptions, 'includeNestedStacks' | 'diagnoser' | 'sdkProvider'>,
): Promise<ChangeSetReport> {
  const { cfn, bodyParameter, exists, stackExistedBefore, executionRoleArn, diagnoser } = await prepareChangeSetEnv(ioHelper, options);
  const changeSetName = `cdk-validate-${options.uuid}`;

  const templateParams = TemplateParameters.fromTemplate(options.stack.template);
  const stackParams = templateParams.supplyAll(options.parameters);

  const changeSet = await cfn.createChangeSet({
    StackName: options.stack.stackName,
    ChangeSetName: changeSetName,
    ChangeSetType: exists ? 'UPDATE' : 'CREATE',
    Description: `CDK Changeset for validation ${options.uuid}`,
    ClientToken: `validate${options.uuid}`,
    TemplateURL: bodyParameter.TemplateURL,
    TemplateBody: bodyParameter.TemplateBody,
    Parameters: stackParams.apiParameters,
    IncludeNestedStacks: true,
    RoleARN: executionRoleArn,
    Tags: toCfnTags(options.stack.tags),
    Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
  });

  try {
    const report = await new ChangeSetDescriber({
      cfn,
      ioHelper,
      stackNameOrArn: changeSet.StackId ?? options.stack.stackName,
      changeSetNameOrArn: changeSet.Id ?? changeSetName,
    }).waitForReport({ diagnoser });

    return report;
  } finally {
    await cleanupOldChangeset(cfn, ioHelper, changeSet.Id ?? changeSetName, changeSet.StackId ?? options.stack.stackName)
      .catch((e) => ioHelper.defaults.warn(`Failed to clean up validation change set: ${e}`));

    if (!stackExistedBefore) {
      await cfn.deleteStack({
        StackName: changeSet.StackId ?? options.stack.stackName,
        ClientRequestToken: randomUUID(),
      }).catch((e) => ioHelper.defaults.warn(`Failed to clean up REVIEW_IN_PROGRESS stack: ${e}`));
    }
  }
}

function toCfnTags(tags: { [id: string]: string }): Tag[] {
  return Object.entries(tags).map(([k, v]) => ({
    Key: k,
    Value: v,
  }));
}

async function cleanupOldChangeset(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  changeSetNameOrArn: string,
  stackNameOrArn: string,
) {
  const changeSetDisplayName = changeSetNameFromArn(changeSetNameOrArn);
  await ioHelper.defaults.debug(`Removing existing change set with name ${changeSetDisplayName} if it exists`);

  // Delete any existing change sets generated by CDK since change set names must be unique.
  // The delete request is successful as long as the stack exists (even if the change set does not exist).
  await cfn.deleteChangeSet({
    StackName: stackNameOrArn,
    ChangeSetName: changeSetNameOrArn,
  });
}

/**
 * Waits for a CloudFormation stack to stabilize in a complete/available state
 * after a delete operation is issued.
 *
 * Fails if the stack is in a FAILED state. Will not fail if the stack was
 * already deleted.
 *
 * @param cfn        - a CloudFormation client
 * @param stackNameOrArn      - the name of the stack to wait for after a delete
 *
 * @returns     the CloudFormation description of the stabilized stack after the delete attempt
 */
export async function waitForStackDelete(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  stackNameOrArn: string,
  stabilizationPollingInterval?: number,
): Promise<CloudFormationStack | undefined> {
  const stackDisplayName = stackNameFromArn(stackNameOrArn);
  const stack = await stabilizeStack(cfn, ioHelper, stackNameOrArn, stabilizationPollingInterval);
  if (!stack) {
    return undefined;
  }

  const status = stack.stackStatus;
  if (status.isFailure) {
    throw new ToolkitError(
      'StackDeleteFailed',
      `The stack named ${stackDisplayName} is in a failed state. You may need to delete it from the AWS console : ${status}`,
    );
  } else if (status.isDeleted) {
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
 * @param cfn        - a CloudFormation client
 * @param stackName      - the name of the stack to wait for after an update
 *
 * @returns     the CloudFormation description of the stabilized stack after the update attempt
 */
export async function waitForStackDeploy(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  stackName: string,
  stabilizationPollingInterval?: number,
): Promise<CloudFormationStack | undefined> {
  const stack = await stabilizeStack(cfn, ioHelper, stackName, stabilizationPollingInterval);
  if (!stack) {
    return undefined;
  }

  const status = stack.stackStatus;

  if (status.isCreationFailure) {
    throw new DeploymentError(
      `The stack named ${stackName} failed creation, it may need to be manually deleted from the AWS console: ${status}`,
      'StackCreationFailed',
    );
  } else if (!status.isDeploySuccess) {
    throw new DeploymentError(`The stack named ${stackName} failed to deploy: ${status}`, 'StackDeployFailed');
  }

  return stack;
}

/**
 * Wait for a stack to become stable (no longer _IN_PROGRESS), returning it
 */
export async function stabilizeStack(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  stackNameOrArn: string,
  pollingInterval?: number,
) {
  const stackDisplayName = stackNameFromArn(stackNameOrArn);
  await ioHelper.defaults.debug(format('Waiting for stack %s to finish creating or updating...', stackDisplayName));
  return waitFor(async () => {
    const stack = await CloudFormationStack.lookup(cfn, stackNameOrArn);
    if (!stack.exists) {
      await ioHelper.defaults.debug(format('Stack %s does not exist', stackDisplayName));
      return null;
    }
    const status = stack.stackStatus;
    if (status.isInProgress) {
      await ioHelper.defaults.debug(format('Stack %s has an ongoing operation in progress and is not stable (%s)', stackDisplayName, status));
      return undefined;
    } else if (status.isReviewInProgress) {
      // This may happen if a stack creation operation is interrupted before the ChangeSet execution starts. Recovering
      // from this would requiring manual intervention (deleting or executing the pending ChangeSet), and failing to do
      // so will result in an endless wait here (the ChangeSet wont delete or execute itself). Instead of blocking
      // "forever" we proceed as if the stack was existing and stable. If there is a concurrent operation that just
      // hasn't finished proceeding just yet, either this operation or the concurrent one may fail due to the other one
      // having made progress. Which is fine. I guess.
      await ioHelper.defaults.debug(format('Stack %s is in REVIEW_IN_PROGRESS state. Considering this is a stable status (%s)', stackDisplayName, status));
    }

    return stack;
  }, pollingInterval);
}

/**
 * The set of (formal) parameters that have been declared in a template
 */
export class TemplateParameters {
  public static fromTemplate(template: Template) {
    return new TemplateParameters(template.Parameters || {});
  }

  constructor(private readonly params: Record<string, TemplateParameter>) {
  }

  /**
   * Calculate stack parameters to pass from the given desired parameter values
   *
   * Will throw if parameters without a Default value or a Previous value are not
   * supplied.
   */
  public supplyAll(updates: Record<string, string | undefined>): ParameterValues {
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
  public updateExisting(
    updates: Record<string, string | undefined>,
    previousValues: Record<string, string>,
  ): ParameterValues {
    return new ParameterValues(this.params, updates, previousValues);
  }
}

/**
 * The set of parameters we're going to pass to a Stack
 */
export class ParameterValues {
  public readonly values: Record<string, string> = {};
  public readonly apiParameters: Parameter[] = [];

  constructor(
    private readonly formalParams: Record<string, TemplateParameter>,
    updates: Record<string, string | undefined>,
    previousValues: Record<string, string> = {},
  ) {
    const missingRequired = new Array<string>();

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
      throw new ToolkitError('MissingParameters', `The following CloudFormation Parameters are missing a value: ${missingRequired.join(', ')}`);
    }

    // Just append all supplied overrides that aren't really expected (this
    // will fail CFN but maybe people made typos that they want to be notified
    // of)
    const unknownParam = ([key, _]: [string, any]) => this.formalParams[key] === undefined;
    const hasValue = ([_, value]: [string, any]) => !!value;
    for (const [key, value] of Object.entries(updates).filter(unknownParam).filter(hasValue)) {
      this.values[key] = value!;
      this.apiParameters.push({ ParameterKey: key, ParameterValue: value });
    }
  }

  /**
   * Whether this set of parameter updates will change the actual stack values
   */
  public hasChanges(currentValues: Record<string, string>): ParameterChanges {
    // If any of the parameters are SSM parameters, deploying must always happen
    // because we can't predict what the values will be. We will allow some
    // parameters to opt out of this check by having a magic string in their description.
    if (
      Object.values(this.formalParams).some(
        (p) => p.Type.startsWith('AWS::SSM::Parameter::') && !p.Description?.includes(SSMPARAM_NO_INVALIDATE),
      )
    ) {
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

export type ParameterChanges = boolean | 'ssm';
