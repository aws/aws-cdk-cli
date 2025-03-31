import type * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import * as uuid from 'uuid';
import type { Deployments, ResourcesToImport, SdkProvider, StackCollection } from '../../api/aws-cdk';
import { createDiffChangeSet, ResourceMigrator } from '../../api/aws-cdk';
import { ToolkitError, type StackSelector } from '../../api/cloud-assembly';
import type { IoHelper } from '../../api/shared-private';
import { IO } from '../../api/shared-private';
import { removeNonImportResources } from '../../api/shared-public';
import type { NestedStackTemplates } from '../../api/shared-public';
import { deserializeStructure, formatErrorMessage } from '../../private/util';

export interface CloudFormationDiffOptions {
  /**
   * Whether to run the diff against the template after the CloudFormation Transforms inside it have been executed
   * (as opposed to the original template, the default, which contains the unprocessed Transforms).
   *
   * @default false
   */
  readonly compareAgainstProcessedTemplate?: boolean;
}

export interface ChangeSetDiffOptions extends CloudFormationDiffOptions {
  // @TODO: add this as a feature
  // /**
  //  * Enable falling back to template-based diff in case creating the changeset is not possible or results in an error.
  //  *
  //  * Should be used for stacks containing nested stacks or when change set permissions aren't available.
  //  *
  //  * @default true
  //  */
  // readonly fallbackToTemplate?: boolean;

  /**
   * Additional parameters for CloudFormation when creating a diff change set
   *
   * @default {}
   */
  readonly parameters?: { [name: string]: string | undefined };
}

export interface LocalFileDiffOptions {
  /**
   * Path to the local file.
   */
  readonly path: string;
}

export class DiffMethod {
  /**
   * Use a changeset to compute the diff.
   *
   * This will create, analyze, and subsequently delete a changeset against the CloudFormation stack.
   */
  public static ChangeSet(options: ChangeSetDiffOptions = {}): DiffMethod {
    return new class extends DiffMethod {
      public override readonly options: ChangeSetDiffOptions;
      public constructor(opts: ChangeSetDiffOptions) {
        super('change-set', opts);
        this.options = opts;
      }
    }(options);
  }

  public static TemplateOnly(options: CloudFormationDiffOptions = {}): DiffMethod {
    return new class extends DiffMethod {
      public override readonly options: CloudFormationDiffOptions;
      public constructor(opts: CloudFormationDiffOptions) {
        super('template-only', opts);
        this.options = opts;
      }
    }(options);
  }

  /**
   * Use a local template file to compute the diff.
   */
  public static LocalFile(path: string): DiffMethod {
    return new class extends DiffMethod {
      public override readonly options: { path: string };
      public constructor(opts: LocalFileDiffOptions) {
        super('local-file', opts);
        this.options = opts;
      }
    }({ path });
  }

  private constructor(
    public readonly method: 'change-set' | 'template-only' | 'local-file',
    public readonly options: ChangeSetDiffOptions | CloudFormationDiffOptions | LocalFileDiffOptions,
  ) {
  }
}

/**
 * Optins for the diff method
 */
export interface DiffOptions {
  /**
   * Select the stacks
   */
  readonly stacks: StackSelector;

  /**
   * The method to create a stack diff.
   *
   * Use changeset diff for the highest fidelity, including analyze resource replacements.
   * In this method, diff will use the deploy role instead of the lookup role.
   *
   * Use template-only diff for a faster, less accurate diff that doesn't require
   * permissions to create a change-set.
   *
   * Use local-template diff for a fast, local-only diff that doesn't require
   * any permissions or internet access.
   *
   * @default DiffMethod.ChangeSet
   */
  readonly method?: DiffMethod;

  /**
   * Strict diff mode
   * When enabled, this will not filter out AWS::CDK::Metadata resources, mangled non-ASCII characters, or the CheckBootstrapVersionRule.
   *
   * @default false
   */
  readonly strict?: boolean;

  /**
   * How many lines of context to show in the diff
   *
   * @default 3
   */
  readonly contextLines?: number;

  /**
   * Only include broadened security changes in the diff
   *
   * @default false
   *
   * @deprecated implement in IoHost
   */
  readonly securityOnly?: boolean;
}

interface TemplateInfo {
  oldTemplate: any;
  newTemplate: cxapi.CloudFormationStackArtifact;
  changeSet?: any;
  stackName?: string;
  isImport?: boolean;
  nestedStacks?: {
    [nestedStackLogicalId: string]: NestedStackTemplates;
  };
}

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
    return createDiffChangeSet(ioHelper, {
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
