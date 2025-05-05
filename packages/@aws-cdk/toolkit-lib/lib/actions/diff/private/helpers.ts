import type * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import * as uuid from 'uuid';
import type { ChangeSetDiffOptions, DiffOptions, LocalFileDiffOptions } from '..';
import { DiffMethod } from '..';
import { Mode } from '../../../api';
import type { StackCollection } from '../../../api/cloud-assembly/stack-collection';
import type { Deployments } from '../../../api/deployments';
import { detectStackDrift } from '../../../api/deployments/cfn-api';
import type { TemplateInfo } from '../../../api/diff';
import type { ResourcesToImport } from '../../../api/resource-import';
import { removeNonImportResources, ResourceMigrator } from '../../../api/resource-import';
import type { IoHelper, SdkProvider } from '../../../api/shared-private';
import { IO, cfnApi } from '../../../api/shared-private';
import { ToolkitError } from '../../../api/shared-public';
import { deserializeStructure, formatErrorMessage } from '../../../private/util';

export function prepareDiff(
  ioHelper: IoHelper,
  stacks: StackCollection,
  deployments: Deployments,
  sdkProvider: SdkProvider,
  options: DiffOptions,
): Promise<TemplateInfo[]> {
  switch (options.method?.method ?? DiffMethod.ChangeSet().method) {
    case 'local-file':
      return localFileDiff(stacks, options);
    case 'template-only':
      return cfnDiff(ioHelper, stacks, deployments, options, sdkProvider, false);
    case 'change-set':
      return cfnDiff(ioHelper, stacks, deployments, options, sdkProvider, true);
    default:
      throw new ToolkitError(formatErrorMessage(`Unknown diff method ${options.method}`));
  }
}

async function localFileDiff(stacks: StackCollection, options: DiffOptions): Promise<TemplateInfo[]> {
  const methodOptions = (options.method?.options ?? {}) as LocalFileDiffOptions;

  // Compare single stack against fixed template
  if (stacks.stackCount !== 1) {
    throw new ToolkitError(
      'Can only select one stack when comparing to fixed template. Use --exclusively to avoid selecting multiple stacks.',
    );
  }

  if (!(await fs.pathExists(methodOptions.path))) {
    throw new ToolkitError(`There is no file at ${methodOptions.path}`);
  }

  const file = fs.readFileSync(methodOptions.path).toString();
  const template = deserializeStructure(file);

  return [{
    oldTemplate: template,
    newTemplate: stacks.firstStack,
  }];
}

async function cfnDiff(
  ioHelper: IoHelper,
  stacks: StackCollection,
  deployments: Deployments,
  options: DiffOptions,
  sdkProvider: SdkProvider,
  includeChangeSet: boolean,
): Promise<TemplateInfo[]> {
  const templateInfos = [];
  const methodOptions = (options.method?.options ?? {}) as ChangeSetDiffOptions;

  // Compare N stacks against deployed templates
  for (const stack of stacks.stackArtifacts) {
    const templateWithNestedStacks = await deployments.readCurrentTemplateWithNestedStacks(
      stack,
      methodOptions.compareAgainstProcessedTemplate,
    );
    const currentTemplate = templateWithNestedStacks.deployedRootTemplate;
    const nestedStacks = templateWithNestedStacks.nestedStacks;

    const driftResults = await collectDriftResults(stack, ioHelper, deployments, options, sdkProvider);

    const migrator = new ResourceMigrator({ deployments, ioHelper });
    const resourcesToImport = await migrator.tryGetResources(await deployments.resolveEnvironment(stack));
    if (resourcesToImport) {
      removeNonImportResources(stack);
    }

    const changeSet = includeChangeSet ? await changeSetDiff(
      ioHelper,
      deployments,
      stack,
      sdkProvider,
      resourcesToImport,
      methodOptions.parameters,
      methodOptions.fallbackToTemplate,
    ) : undefined;

    templateInfos.push({
      oldTemplate: currentTemplate,
      newTemplate: stack,
      isImport: !!resourcesToImport,
      nestedStacks,
      changeSet,
      driftResults,
    });
  }

  return templateInfos;
}

async function changeSetDiff(
  ioHelper: IoHelper,
  deployments: Deployments,
  stack: cxapi.CloudFormationStackArtifact,
  sdkProvider: SdkProvider,
  resourcesToImport?: ResourcesToImport,
  parameters: { [name: string]: string | undefined } = {},
  fallBackToTemplate: boolean = true,
): Promise<any | undefined> {
  let stackExists = false;
  try {
    stackExists = await deployments.stackExists({
      stack,
      deployName: stack.stackName,
      tryLookupRole: true,
    });
  } catch (e: any) {
    if (!fallBackToTemplate) {
      throw new ToolkitError(`describeStacks call failed with ${e} for ${stack.stackName}, set fallBackToTemplate to true or use DiffMethod.templateOnly to base the diff on template differences.`);
    }

    await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(`Checking if the stack ${stack.stackName} exists before creating the changeset has failed, will base the diff on template differences.\n`));
    await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(formatErrorMessage(e)));
    stackExists = false;
  }

  if (stackExists) {
    return cfnApi.createDiffChangeSet(ioHelper, {
      stack,
      uuid: uuid.v4(),
      deployments,
      willExecute: false,
      sdkProvider,
      parameters: parameters,
      resourcesToImport,
      failOnError: !fallBackToTemplate,
    });
  } else {
    if (!fallBackToTemplate) {
      throw new ToolkitError(`the stack '${stack.stackName}' has not been deployed to CloudFormation, set fallBackToTemplate to true or use DiffMethod.templateOnly to base the diff on template differences.`);
    }

    await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(`the stack '${stack.stackName}' has not been deployed to CloudFormation, skipping changeset creation.`));
    return;
  }
}

/**
 * Collect drift detection results for a given CloudFormation stack
 */
async function collectDriftResults(
  stack: cxapi.CloudFormationStackArtifact,
  ioHelper: IoHelper,
  deployments: Deployments,
  options: DiffOptions,
  sdkProvider: SdkProvider,
) {
  if (!options.detectDrift) {
    return undefined;
  }

  const env = await deployments.resolveEnvironment(stack);
  const cfn = (await sdkProvider.forEnvironment(env, Mode.ForReading)).sdk.cloudFormation();

  return detectStackDrift(
    cfn,
    ioHelper,
    stack.stackName,
  );
}

/**
 * Appends all properties from obj2 to obj1.
 * obj2 values take priority in the case of collisions.
 *
 * @param obj1 The object to modify
 * @param obj2 The object to consume
 *
 * @returns obj1 with all properties from obj2
 */
export function appendObject<T>(
  obj1: { [name: string]: T },
  obj2: { [name: string]: T },
): { [name: string]: T } {
  // Directly modify obj1 by adding all properties from obj2
  for (const key in obj2) {
    obj1[key] = obj2[key];
  }

  // Return the modified obj1
  return obj1;
}
