import { format } from 'node:util';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import {
  formatDifferences,
  formatSecurityChanges,
  fullDiff,
  mangleLikeCloudFormation,
  type DescribeChangeSetOutput,
  type ResourceDifference,
  type TemplateDiff,
} from '@aws-cdk/cloudformation-diff';
import * as chalk from 'chalk';
import { PermissionChangeType } from '../../payloads';
import type { NestedStackTemplates, Template } from '../cloudformation';
import { buildLogicalToPathMap } from '../cloudformation/logical-id-map';
import { StringWriteStream } from '../streams';

/**
 * Output of formatSecurityDiff
 */
interface FormatSecurityDiffOutput {
  /**
   * Complete formatted security diff
   */
  readonly formattedDiff: string;

  /**
   * The type of permission changes in the security diff.
   * The IoHost will use this to decide whether or not to print.
   */
  readonly permissionChangeType: PermissionChangeType;

  /**
   * Number of stacks with security changes
   */
  readonly numStacksWithChanges: number;
}

/**
 * Output of formatStackDiff
 */
interface FormatStackDiffOutput {
  /**
   * Number of stacks with diff changes
   */
  readonly numStacksWithChanges: number;

  /**
   * Complete formatted diff
   */
  readonly formattedDiff: string;
}

/**
 * Props for the Diff Formatter
 */
interface DiffFormatterProps {
  /**
   * The relevant information for the Template that is being diffed.
   * Includes the old/current state of the stack as well as the new state.
   */
  readonly templateInfo: TemplateInfo;
}

/**
 * Properties specific to formatting the stack diff
 */
interface FormatStackDiffOptions {
  /**
   * do not filter out AWS::CDK::Metadata or Rules
   *
   * @default false
   */
  readonly strict?: boolean;

  /**
   * lines of context to use in arbitrary JSON diff
   *
   * @default 3
   */
  readonly contextLines?: number;

  /**
   * silences \'There were no differences\' messages
   *
   * @default false
   */
  readonly quiet?: boolean;
}

interface ReusableStackDiffOptions extends FormatStackDiffOptions {
}

/**
 * Properties specific to formatting the security diff
 */
interface FormatSecurityDiffOptions {
  /**
   * silences stack names and 'no changes' messages for stacks without security changes
   *
   * @default false
   */
  readonly quiet?: boolean;
}

/**
 * Information on a template's old/new state
 * that is used for diff.
 */
export interface TemplateInfo {
  /**
   * The old/existing template
   */
  readonly oldTemplate: Template;

  /**
   * The new template
   */
  readonly newTemplate: cxapi.CloudFormationStackArtifact;

  /**
   * A CloudFormation ChangeSet to help the diff operation.
   * Probably created via `createDiffChangeSet`.
   *
   * @default undefined
   */
  readonly changeSet?: DescribeChangeSetOutput;

  /**
   * Whether or not there are any imported resources
   *
   * @default false
   */
  readonly isImport?: boolean;

  /**
   * Any nested stacks included in the template
   *
   * @default {}
   */
  readonly nestedStacks?: {
    [nestedStackLogicalId: string]: NestedStackTemplates;
  };

  /**
   * Mappings of old locations to new locations. If these are provided,
   * for all resources that were moved, their corresponding addition
   * and removal lines will be augmented with the location they were
   * moved fom and to, respectively.
   */
  readonly mappings?: Record<string, string>;
}

/**
 * Class for formatting the diff output
 */
export class DiffFormatter {
  private readonly templateInfo: TemplateInfo;
  private readonly stackName: string;
  private readonly isImport: boolean;
  private readonly mappings: Record<string, string>;

  /**
   * Cache of computed TemplateDiffs, indexed by stack name.
   */
  private readonly cache = new Map<string, TemplateDiff>();

  constructor(props: DiffFormatterProps) {
    this.templateInfo = props.templateInfo;
    this.stackName = props.templateInfo.newTemplate.displayName ?? props.templateInfo.newTemplate.stackName;
    this.isImport = props.templateInfo.isImport ?? false;
    this.mappings = props.templateInfo.mappings ?? {};
  }

  public get diffs() {
    return Object.fromEntries(this.cache);
  }

  /**
   * Compute the diff for a single stack. Results are cached by stack name.
   *
   * @param stackName - The name to cache the diff under
   * @param oldTemplate - The deployed template
   * @param newTemplate - The new/generated template (read from the artifact)
   * @param changeSet - The CloudFormation changeset for this specific stack, if available
   * @param mappings - Resource move mappings
   */
  private computeDiff(
    stackName: string,
    oldTemplate: Template,
    newTemplate: Template,
    changeSet: DescribeChangeSetOutput | undefined,
    mappings: Record<string, string>,
  ): TemplateDiff {
    if (!this.cache.has(stackName)) {
      const templateDiff = fullDiff(oldTemplate, newTemplate, changeSet, this.isImport);

      const setMove = (change: ResourceDifference, direction: 'from' | 'to', location?: string) => {
        if (location != null) {
          const [sourceStackName, sourceLogicalId] = location.split('.');
          change.move = {
            direction,
            stackName: sourceStackName,
            resourceLogicalId: sourceLogicalId,
          };
        }
      };

      templateDiff.resources.forEachDifference((id, change) => {
        const location = `${stackName}.${id}`;
        if (change.isAddition && Object.values(mappings).includes(location)) {
          setMove(change, 'from', Object.keys(mappings).find(k => mappings[k] === location));
        } else if (change.isRemoval && Object.keys(mappings).includes(location)) {
          setMove(change, 'to', mappings[location]);
        }
      });

      this.cache.set(stackName, templateDiff);
    }
    return this.cache.get(stackName)!;
  }

  /**
   * Format the stack diff, including all nested stacks.
   */
  public formatStackDiff(options: FormatStackDiffOptions = {}): FormatStackDiffOutput {
    return this.formatStackDiffHelper({
      oldTemplate: this.templateInfo.oldTemplate,
      newTemplate: this.templateInfo.newTemplate.template,
      stackName: this.stackName,
      nestedStacks: this.templateInfo.nestedStacks,
      changeSet: this.templateInfo.changeSet,
      mappings: this.mappings,
      logicalIdMap: buildLogicalToPathMap(this.templateInfo.newTemplate).toPath,
    }, options);
  }

  private formatStackDiffHelper(params: {
    oldTemplate: Template;
    newTemplate: Template;
    stackName: string;
    nestedStacks: { [nestedStackLogicalId: string]: NestedStackTemplates } | undefined;
    changeSet: DescribeChangeSetOutput | undefined;
    mappings: Record<string, string>;
    logicalIdMap: Record<string, string>;
  }, options: ReusableStackDiffOptions = {}): FormatStackDiffOutput {
    const { oldTemplate, newTemplate, stackName, nestedStacks, changeSet, mappings, logicalIdMap } = params;

    const diff = this.computeDiff(stackName, oldTemplate, newTemplate, changeSet, mappings);

    const stream = new StringWriteStream();
    let numStacksWithChanges = 0;
    let formattedDiff = '';
    let filteredChangesCount = 0;

    try {
      // must output the stack name if there are differences, even if quiet
      if (stackName && (!options.quiet || !diff.isEmpty)) {
        stream.write(format(`Stack ${chalk.bold(stackName)}\n`));
      }

      if (!options.quiet && this.isImport) {
        stream.write('Parameters and rules created during migration do not affect resource configuration.\n');
      }

      // detect and filter out mangled characters from the diff
      let activeDiff = diff;
      if (diff.differenceCount && !options.strict) {
        const mangledNewTemplate = JSON.parse(mangleLikeCloudFormation(JSON.stringify(newTemplate)));
        const mangledDiff = fullDiff(oldTemplate, mangledNewTemplate, changeSet);
        filteredChangesCount = Math.max(0, diff.differenceCount - mangledDiff.differenceCount);
        if (filteredChangesCount > 0) {
          activeDiff = mangledDiff;
        }
      }

      // filter out 'AWS::CDK::Metadata' resources from the template
      // filter out 'CheckBootstrapVersion' rules from the template
      if (!options.strict) {
        obscureDiff(activeDiff);
      }

      if (!activeDiff.isEmpty) {
        numStacksWithChanges++;

        formatDifferences(stream, activeDiff, {
          ...logicalIdMapFromTemplate(oldTemplate),
          ...logicalIdMapFromTemplate(newTemplate),
          ...logicalIdMap,
        }, options.contextLines);
      } else if (!options.quiet) {
        stream.write(chalk.green('There were no differences\n'));
      }

      if (filteredChangesCount > 0) {
        stream.write(chalk.yellow(`Omitted ${filteredChangesCount} changes because they are likely mangled non-ASCII characters. Use --strict to print them.\n`));
      }
    } finally {
      formattedDiff = stream.toString();
      stream.end();
    }

    // Recurse into nested stacks
    for (const [logicalId, nestedStack] of Object.entries(nestedStacks ?? {})) {
      const nextDiff = this.formatStackDiffHelper({
        oldTemplate: nestedStack.deployedTemplate,
        newTemplate: nestedStack.generatedTemplate,
        stackName: nestedStack.physicalName ?? logicalId,
        nestedStacks: nestedStack.nestedStackTemplates,
        changeSet: nestedStack.changeSet,
        mappings,
        logicalIdMap: {},
      }, options);
      numStacksWithChanges += nextDiff.numStacksWithChanges;
      formattedDiff += nextDiff.formattedDiff;
    }

    return { numStacksWithChanges, formattedDiff };
  }

  /**
   * Format the security diff, including all nested stacks.
   */
  public formatSecurityDiff(options: FormatSecurityDiffOptions = {}): FormatSecurityDiffOutput {
    const { formattedDiff, permissionChangeType, numStacksWithChanges } = this.formatSecurityDiffHelper({
      oldTemplate: this.templateInfo.oldTemplate,
      newTemplate: this.templateInfo.newTemplate.template,
      stackName: this.stackName,
      nestedStacks: this.templateInfo.nestedStacks,
      changeSet: this.templateInfo.changeSet,
      logicalIdMap: buildLogicalToPathMap(this.templateInfo.newTemplate).toPath,
    }, options);

    return { formattedDiff, permissionChangeType, numStacksWithChanges };
  }

  private formatSecurityDiffHelper(params: {
    oldTemplate: Template;
    newTemplate: Template;
    stackName: string;
    nestedStacks: { [nestedStackLogicalId: string]: NestedStackTemplates } | undefined;
    changeSet: DescribeChangeSetOutput | undefined;
    logicalIdMap?: Record<string, string>;
  }, options: FormatSecurityDiffOptions = {}): FormatSecurityDiffOutput {
    const { oldTemplate, newTemplate, stackName, nestedStacks, changeSet, logicalIdMap } = params;

    const diff = this.computeDiff(stackName, oldTemplate, newTemplate, changeSet, this.mappings);
    const permissionChangeType = permissionTypeFromDiff(diff);

    const stream = new StringWriteStream();
    if (!options.quiet || permissionChangeType !== PermissionChangeType.NONE) {
      stream.write(format(`Stack ${chalk.bold(stackName)}\n`));
    }

    try {
      formatSecurityChanges(stream, diff, {
        ...logicalIdMapFromTemplate(newTemplate),
        ...logicalIdMap,
      });
    } finally {
      stream.end();
    }

    let formattedDiff = stream.toString();
    if (!options.quiet && permissionChangeType === PermissionChangeType.NONE) {
      formattedDiff += chalk.green('There were no security-related changes (limitations: https://github.com/aws/aws-cdk/issues/1299)\n');
    }
    let numStacksWithChanges = permissionChangeType !== PermissionChangeType.NONE ? 1 : 0;
    let escalatedPermissionType = permissionChangeType;

    // Recurse into nested stacks
    for (const [logicalId, nestedStack] of Object.entries(nestedStacks ?? {})) {
      const nestedResult = this.formatSecurityDiffHelper({
        oldTemplate: nestedStack.deployedTemplate,
        newTemplate: nestedStack.generatedTemplate,
        stackName: nestedStack.physicalName ?? logicalId,
        nestedStacks: nestedStack.nestedStackTemplates,
        changeSet: nestedStack.changeSet,
      }, options);
      formattedDiff += nestedResult.formattedDiff ? '\n' + nestedResult.formattedDiff : '';
      numStacksWithChanges += nestedResult.numStacksWithChanges;
      // Escalate: if any nested stack broadens permissions, the whole thing broadens
      if (nestedResult.permissionChangeType === PermissionChangeType.BROADENING) {
        escalatedPermissionType = PermissionChangeType.BROADENING;
      } else if (nestedResult.permissionChangeType === PermissionChangeType.NON_BROADENING
        && escalatedPermissionType === PermissionChangeType.NONE) {
        escalatedPermissionType = PermissionChangeType.NON_BROADENING;
      }
    }

    return { formattedDiff, permissionChangeType: escalatedPermissionType, numStacksWithChanges };
  }
}

function permissionTypeFromDiff(diff: TemplateDiff): PermissionChangeType {
  if (diff.permissionsBroadened) {
    return PermissionChangeType.BROADENING;
  } else if (diff.permissionsAnyChanges) {
    return PermissionChangeType.NON_BROADENING;
  }
  return PermissionChangeType.NONE;
}

function logicalIdMapFromTemplate(template: Template) {
  const ret: Record<string, string> = {};

  for (const [logicalId, resource] of Object.entries((template.Resources ?? {}) as Record<string, any>)) {
    const path = resource?.Metadata?.['aws:cdk:path'];
    if (path) {
      ret[logicalId] = path;
    }
  }
  return ret;
}

/**
 * Remove any template elements that we don't want to show users.
 * This is currently:
 * - AWS::CDK::Metadata resource
 * - CheckBootstrapVersion Rule
 */
function obscureDiff(diff: TemplateDiff) {
  if (diff.unknown) {
    // see https://github.com/aws/aws-cdk/issues/17942
    diff.unknown = diff.unknown.filter(change => {
      if (!change) {
        return true;
      }
      if (change.newValue?.CheckBootstrapVersion) {
        return false;
      }
      if (change.oldValue?.CheckBootstrapVersion) {
        return false;
      }
      return true;
    });
  }

  if (diff.resources) {
    diff.resources = diff.resources.filter(change => {
      if (!change) {
        return true;
      }
      if (change.newResourceType === 'AWS::CDK::Metadata') {
        return false;
      }
      if (change.oldResourceType === 'AWS::CDK::Metadata') {
        return false;
      }
      return true;
    });
  }
}
