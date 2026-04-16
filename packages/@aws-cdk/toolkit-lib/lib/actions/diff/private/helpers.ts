import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import type { DescribeChangeSetCommandOutput } from '@aws-sdk/client-cloudformation';
import * as fs from 'fs-extra';
import * as uuid from 'uuid';
import type { ChangeSetDiffOptions, DiffOptions, LocalFileDiffOptions } from '..';
import { DiffMethod } from '..';
import type { SdkProvider } from '../../../api/aws-auth/private';
import type { StackCollection } from '../../../api/cloud-assembly/stack-collection';
import type { NestedStackTemplates } from '../../../api/cloudformation';
import type { Deployments } from '../../../api/deployments';
import * as cfnApi from '../../../api/deployments/cfn-api';
import type { TemplateInfo } from '../../../api/diff';
import type { IoHelper } from '../../../api/io/private';
import { removeNonImportResources, ResourceMigrator } from '../../../api/resource-import';
import { ToolkitError } from '../../../toolkit/toolkit-error';
import { deserializeStructure, formatErrorMessage } from '../../../util';
import { mappingsByEnvironment } from '../../refactor/private/mapping-helpers';

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
      throw new ToolkitError('UnknownDiffMethod', formatErrorMessage(`Unknown diff method ${options.method}`));
  }
}

async function localFileDiff(stacks: StackCollection, options: DiffOptions): Promise<TemplateInfo[]> {
  const methodOptions = (options.method?.options ?? {}) as LocalFileDiffOptions;

  // Compare single stack against fixed template
  if (stacks.stackCount !== 1) {
    throw new ToolkitError(
      'SingleStackRequired',
      'Can only select one stack when comparing to fixed template. Use --exclusively to avoid selecting multiple stacks.',
    );
  }

  if (!(await fs.pathExists(methodOptions.path))) {
    throw new ToolkitError('TemplateFileNotFound', `There is no file at ${methodOptions.path}`);
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

  const allMappings = options.includeMoves
    ? await mappingsByEnvironment(stacks.stackArtifacts, sdkProvider, true)
    : [];

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

    const changeSet = includeChangeSet ? await cfnApi.createDiffChangeSet(ioHelper, {
      deployments,
      stack,
      sdkProvider,
      resourcesToImport,
      parameters: methodOptions.parameters ?? {},
      failOnError: !methodOptions.fallbackToTemplate,
      importExistingResources: methodOptions.importExistingResources,
      uuid: uuid.v4(),
      willExecute: false,
     }) : undefined;

    // If the changeset includes nested stacks, describe each nested changeset
    // and attach it to the corresponding entry in nestedStacks.
    if (changeSet) {
      await attachNestedChangeSetData(deployments, stack, changeSet, nestedStacks);
    }

    const mappings = allMappings.find(m =>
      m.environment.region === stack.environment.region && m.environment.account === stack.environment.account,
    )?.mappings ?? {};

    templateInfos.push({
      oldTemplate: currentTemplate,
      newTemplate: stack,
      isImport: !!resourcesToImport,
      nestedStacks,
      changeSet,
      mappings,
    });
  }

  return templateInfos;
}

/**
 * Walk the root changeset's Changes looking for nested stack resources
 * that have their own ChangeSetId. Describe each nested changeset and
 * attach it to the matching entry in the nestedStacks map.
 */
async function attachNestedChangeSetData(
  deployments: Deployments,
  stack: cxapi.CloudFormationStackArtifact,
  rootChangeSet: DescribeChangeSetCommandOutput,
  nestedStacks: { [logicalId: string]: NestedStackTemplates },
): Promise<void> {
  const env = await deployments.envs.accessStackForReadOnlyStackOperations(stack);
  const cfn = env.sdk.cloudFormation();

  for (const change of rootChangeSet.Changes ?? []) {
    const rc = change.ResourceChange;
    if (rc?.ResourceType !== 'AWS::CloudFormation::Stack' || !rc.ChangeSetId || !rc.LogicalResourceId) {
      continue;
    }

    const nested = nestedStacks[rc.LogicalResourceId];
    if (!nested) {
      continue;
    }

    const nestedChangeSet = await cfn.describeChangeSet({
      ChangeSetName: rc.ChangeSetId,
      StackName: rc.PhysicalResourceId ?? rc.LogicalResourceId,
    });

    // Replace the entry with one that includes the changeset
    (nestedStacks as any)[rc.LogicalResourceId] = {
      ...nested,
      changeSet: nestedChangeSet,
    };

    // Recurse into deeper nesting levels
    if (nestedChangeSet && Object.keys(nested.nestedStackTemplates).length > 0) {
      await attachNestedChangeSetData(deployments, stack, nestedChangeSet, nested.nestedStackTemplates);
    }
  }
}

/**
 * Appends all properties from obj2 to obj1.
 * obj2 values take priority in the case of collisions.
 *
 * @param obj1 - The object to modify
 * @param obj2 - The object to consume
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
