import { format } from 'util';
import * as cxapi from '@aws-cdk/cx-api';
import { SSMPARAM_NO_INVALIDATE } from '@aws-cdk/cx-api';
import type {
  DescribeChangeSetCommandOutput,
  Parameter,
  ResourceToImport,
  Tag,
} from '@aws-sdk/client-cloudformation';
import {
  ChangeSetStatus,
} from '@aws-sdk/client-cloudformation';
import type { FileManifestEntry } from 'cdk-assets';
import { AssetManifest } from 'cdk-assets';
import { AssetManifestBuilder } from './asset-manifest-builder';
import type { Deployments } from './deployments';
import type { ICloudFormationClient, SdkProvider } from '../aws-auth/private';
import type { Template, TemplateBodyParameter, TemplateParameter } from '../cloudformation';
import { CloudFormationStack, makeBodyParameter } from '../cloudformation';
import { IO, type IoHelper } from '../io/private';
import type { ResourcesToImport } from '../resource-import';
import { ToolkitError } from '../toolkit-error';

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
async function describeChangeSet(
  cfn: ICloudFormationClient,
  stackName: string,
  changeSetName: string,
  { fetchAll }: { fetchAll: boolean },
): Promise<DescribeChangeSetCommandOutput> {
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
async function waitFor<T>(
  valueProvider: () => Promise<T | null | undefined>,
  timeout: number = 5000,
): Promise<T | undefined> {
  while (true) {
    const result = await valueProvider();
    if (result === null) {
      return undefined;
    } else if (result !== undefined) {
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
export async function waitForChangeSet(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  stackName: string,
  changeSetName: string,
  { fetchAll }: { fetchAll: boolean },
): Promise<DescribeChangeSetCommandOutput> {
  await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Waiting for changeset %s on stack %s to finish creating...', changeSetName, stackName)));
  const ret = await waitFor(async () => {
    const description = await describeChangeSet(cfn, stackName, changeSetName, {
      fetchAll,
    });
    // The following doesn't use a switch because tsc will not allow fall-through, UNLESS it is allows
    // EVERYWHERE that uses this library directly or indirectly, which is undesirable.
    if (description.Status === 'CREATE_PENDING' || description.Status === 'CREATE_IN_PROGRESS') {
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Changeset %s on stack %s is still creating', changeSetName, stackName)));
      return undefined;
    }

    if (description.Status === ChangeSetStatus.CREATE_COMPLETE || changeSetHasNoChanges(description)) {
      return description;
    }

    // eslint-disable-next-line max-len
    throw new ToolkitError(
      `Failed to create ChangeSet ${changeSetName} on ${stackName}: ${description.Status || 'NO_STATUS'}, ${description.StatusReason || 'no reason provided'}`,
    );
  });

  if (!ret) {
    throw new ToolkitError('Change set took too long to be created; aborting');
  }

  return ret;
}

export type PrepareChangeSetOptions = {
  stack: cxapi.CloudFormationStackArtifact;
  deployments: Deployments;
  uuid: string;
  willExecute: boolean;
  sdkProvider: SdkProvider;
  parameters: { [name: string]: string | undefined };
  resourcesToImport?: ResourcesToImport;
  /**
   * Default behavior is to log AWS CloudFormation errors and move on. Set this property to true to instead
   * fail on errors received by AWS CloudFormation.
   *
   * @default false
   */
  failOnError?: boolean;
}

export type CreateChangeSetOptions = {
  cfn: ICloudFormationClient;
  changeSetName: string;
  willExecute: boolean;
  exists: boolean;
  uuid: string;
  stack: cxapi.CloudFormationStackArtifact;
  bodyParameter: TemplateBodyParameter;
  parameters: { [name: string]: string | undefined };
  resourcesToImport?: ResourceToImport[];
  role?: string;
};

/**
 * Create a changeset for a diff operation
 */
export async function createDiffChangeSet(
  ioHelper: IoHelper,
  options: PrepareChangeSetOptions,
): Promise<DescribeChangeSetCommandOutput | undefined> {
  // `options.stack` has been modified to include any nested stack templates directly inline with its own template, under a special `NestedTemplate` property.
  // Thus the parent template's Resources section contains the nested template's CDK metadata check, which uses Fn::Equals.
  // This causes CreateChangeSet to fail with `Template Error: Fn::Equals cannot be partially collapsed`.
  for (const resource of Object.values(options.stack.template.Resources ?? {})) {
    if ((resource as any).Type === 'AWS::CloudFormation::Stack') {
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg('This stack contains one or more nested stacks, falling back to template-only diff...'));

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

async function uploadBodyParameterAndCreateChangeSet(
  ioHelper: IoHelper,
  options: PrepareChangeSetOptions,
): Promise<DescribeChangeSetCommandOutput | undefined> {
  try {
    await uploadStackTemplateAssets(options.stack, options.deployments);
    const env = await options.deployments.envs.accessStackForMutableStackOperations(options.stack);

    const bodyParameter = await makeBodyParameter(
      ioHelper,
      options.stack,
      env.resolvedEnvironment,
      new AssetManifestBuilder(),
      env.resources,
    );
    const cfn = env.sdk.cloudFormation();
    const exists = (await CloudFormationStack.lookup(cfn, options.stack.stackName, false)).exists;

    const executionRoleArn = await env.replacePlaceholders(options.stack.cloudFormationExecutionRoleArn);
    await ioHelper.notify(IO.DEFAULT_TOOLKIT_INFO.msg(
      'Hold on while we create a read-only change set to get a diff with accurate replacement information (use --no-change-set to use a less accurate but faster template-only diff)\n',
    ));

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
  } catch (e: any) {
    // This function is currently only used by diff so these messages are diff-specific
    if (!options.failOnError) {
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(String(e)));
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_INFO.msg(
        'Could not create a change set, will base the diff on template differences (run again with -v to see the reason)\n',
      ));

      return undefined;
    }

    throw new ToolkitError('Could not create a change set and failOnError is set. (run again with failOnError off to base the diff on template differences)\n', e);
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

export async function createChangeSet(
  ioHelper: IoHelper,
  options: CreateChangeSetOptions,
): Promise<DescribeChangeSetCommandOutput> {
  await cleanupOldChangeset(options.cfn, ioHelper, options.changeSetName, options.stack.stackName);

  await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(`Attempting to create ChangeSet with name ${options.changeSetName} for stack ${options.stack.stackName}`));

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

  await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Initiated creation of changeset: %s; waiting for it to finish creating...', changeSet.Id)));
  // Fetching all pages if we'll execute, so we can have the correct change count when monitoring.
  const createdChangeSet = await waitForChangeSet(options.cfn, ioHelper, options.stack.stackName, options.changeSetName, {
    fetchAll: options.willExecute,
  });
  await cleanupOldChangeset(options.cfn, ioHelper, options.changeSetName, options.stack.stackName);

  return createdChangeSet;
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
  changeSetName: string,
  stackName: string,
) {
  // Delete any existing change sets generated by CDK since change set names must be unique.
  // The delete request is successful as long as the stack exists (even if the change set does not exist).
  await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(`Removing existing change set with name ${changeSetName} if it exists`));
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
export function changeSetHasNoChanges(description: DescribeChangeSetCommandOutput) {
  const noChangeErrorPrefixes = [
    // Error message for a regular template
    "The submitted information didn't contain changes.",
    // Error message when a Transform is involved (see #10650)
    'No updates are to be performed.',
  ];

  return (
    description.Status === 'FAILED' && noChangeErrorPrefixes.some((p) => (description.StatusReason ?? '').startsWith(p))
  );
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
export async function waitForStackDelete(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  stackName: string,
): Promise<CloudFormationStack | undefined> {
  const stack = await stabilizeStack(cfn, ioHelper, stackName);
  if (!stack) {
    return undefined;
  }

  const status = stack.stackStatus;
  if (status.isFailure) {
    throw new ToolkitError(
      `The stack named ${stackName} is in a failed state. You may need to delete it from the AWS console : ${status}`,
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
 * @param cfn        a CloudFormation client
 * @param stackName      the name of the stack to wait for after an update
 *
 * @returns     the CloudFormation description of the stabilized stack after the update attempt
 */
export async function waitForStackDeploy(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  stackName: string,
): Promise<CloudFormationStack | undefined> {
  const stack = await stabilizeStack(cfn, ioHelper, stackName);
  if (!stack) {
    return undefined;
  }

  const status = stack.stackStatus;

  if (status.isCreationFailure) {
    throw new ToolkitError(
      `The stack named ${stackName} failed creation, it may need to be manually deleted from the AWS console: ${status}`,
    );
  } else if (!status.isDeploySuccess) {
    throw new ToolkitError(`The stack named ${stackName} failed to deploy: ${status}`);
  }

  return stack;
}

/**
 * Wait for a stack to become stable (no longer _IN_PROGRESS), returning it
 */
export async function stabilizeStack(
  cfn: ICloudFormationClient,
  ioHelper: IoHelper,
  stackName: string,
) {
  await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Waiting for stack %s to finish creating or updating...', stackName)));
  return waitFor(async () => {
    const stack = await CloudFormationStack.lookup(cfn, stackName);
    if (!stack.exists) {
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Stack %s does not exist', stackName)));
      return null;
    }
    const status = stack.stackStatus;
    if (status.isInProgress) {
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Stack %s has an ongoing operation in progress and is not stable (%s)', stackName, status)));
      return undefined;
    } else if (status.isReviewInProgress) {
      // This may happen if a stack creation operation is interrupted before the ChangeSet execution starts. Recovering
      // from this would requiring manual intervention (deleting or executing the pending ChangeSet), and failing to do
      // so will result in an endless wait here (the ChangeSet wont delete or execute itself). Instead of blocking
      // "forever" we proceed as if the stack was existing and stable. If there is a concurrent operation that just
      // hasn't finished proceeding just yet, either this operation or the concurrent one may fail due to the other one
      // having made progress. Which is fine. I guess.
      await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(format('Stack %s is in REVIEW_IN_PROGRESS state. Considering this is a stable status (%s)', stackName, status)));
    }

    return stack;
  });
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
      throw new ToolkitError(`The following CloudFormation Parameters are missing a value: ${missingRequired.join(', ')}`);
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
