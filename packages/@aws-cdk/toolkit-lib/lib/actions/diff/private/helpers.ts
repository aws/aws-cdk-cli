import type { DescribeChangeSetOutput } from '@aws-cdk/cloudformation-diff';
import { fullDiff } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import * as uuid from 'uuid';
import type { ChangeSetDiffOptions, DiffOptions, LocalFileDiffOptions } from '..';
import { DiffMethod } from '..';
import type { Deployments, ResourcesToImport, IoHelper, SdkProvider, StackCollection, TemplateInfo } from '../../../api/shared-private';
import { ResourceMigrator, IO, removeNonImportResources, cfnApi } from '../../../api/shared-private';
import { PermissionChangeType, ToolkitError } from '../../../api/shared-public';
import { deserializeStructure, formatErrorMessage } from '../../../private/util';

export function makeTemplateInfos(
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
  changeSet: boolean,
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

    const migrator = new ResourceMigrator({ deployments, ioHelper });
    const resourcesToImport = await migrator.tryGetResources(await deployments.resolveEnvironment(stack));
    if (resourcesToImport) {
      removeNonImportResources(stack);
    }

    templateInfos.push({
      oldTemplate: currentTemplate,
      newTemplate: stack,
      stackName: stack.stackName,
      isImport: !!resourcesToImport,
      nestedStacks,
      changeSet: changeSet ? await changeSetDiff(ioHelper, deployments, stack, sdkProvider, resourcesToImport, methodOptions.parameters) : undefined,
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
): Promise<any | undefined> {
  let stackExists = false;
  try {
    stackExists = await deployments.stackExists({
      stack,
      deployName: stack.stackName,
      tryLookupRole: true,
    });
  } catch (e: any) {
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
    });
  } else {
    await ioHelper.notify(IO.DEFAULT_TOOLKIT_DEBUG.msg(`the stack '${stack.stackName}' has not been deployed to CloudFormation or describeStacks call failed, skipping changeset creation.`));
    return;
  }
}

/**
 * Return whether the diff has security-impacting changes that need confirmation.
 */
export function determinePermissionType(
  oldTemplate: any,
  newTemplate: cxapi.CloudFormationStackArtifact,
  changeSet?: DescribeChangeSetOutput,
): PermissionChangeType {
  // @todo return a printable version of the full diff.
  const diff = fullDiff(oldTemplate, newTemplate.template, changeSet);

  if (diff.permissionsBroadened) {
    return PermissionChangeType.BROADENING;
  } else if (diff.permissionsAnyChanges) {
    return PermissionChangeType.NON_BROADENING;
  } else {
    return PermissionChangeType.NONE;
  }
}
