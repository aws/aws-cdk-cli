import { format } from 'node:util';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import {
  formatDifferences,
  formatSecurityChanges,
  fullDiff,
  mangleLikeCloudFormation,
  type ResourceDifference,
  type TemplateDiff,
} from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import { PermissionChangeType } from '../../payloads';
import type { NestedStackTemplates } from '../cloudformation';
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
 * Information on a template's old/new state
 * that is used for diff.
 */
export interface TemplateInfo {
  /**
   * The old/existing template
   */
  readonly oldTemplate: any;

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
  readonly changeSet?: any;

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
  private readonly oldTemplate: any;
  private readonly newTemplate: cxapi.CloudFormationStackArtifact;
  private readonly stackName: string;
  private readonly changeSet?: any;
  private readonly nestedStacks: { [nestedStackLogicalId: string]: NestedStackTemplates } | undefined;
  private readonly isImport: boolean;
  private readonly mappings: Record<string, string>;

  /**
   * Stores the TemplateDiffs that get calculated in this DiffFormatter,
   * indexed by the stack name.
   */
  private _diffs: { [name: string]: TemplateDiff } = {};

  constructor(props: DiffFormatterProps) {
    this.oldTemplate = props.templateInfo.oldTemplate;
    this.newTemplate = props.templateInfo.newTemplate;
    this.stackName = props.templateInfo.newTemplate.displayName ?? props.templateInfo.newTemplate.stackName;
    this.changeSet = props.templateInfo.changeSet;
    this.nestedStacks = props.templateInfo.nestedStacks;
    this.isImport = props.templateInfo.isImport ?? false;
    this.mappings = props.templateInfo.mappings ?? {};
  }

  public get diffs() {
    return this._diffs;
  }

  /**
   * Get or creates the diff of a stack.
   * If it creates the diff, it stores the result in a map for
   * easier retrieval later.
   */
  private diff(stackName?: string, oldTemplate?: any, mappings: Record<string, string> = {}) {
    const realStackName = stackName ?? this.stackName;

    if (!this._diffs[realStackName]) {
      const templateDiff = fullDiff(
        oldTemplate ?? this.oldTemplate,
        this.newTemplate.template,
        this.changeSet,
        this.isImport,
      );

      const setMove = (change: ResourceDifference, direction: 'from' | 'to', location?: string)=> {
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
        const location = `${realStackName}.${id}`;
        if (change.isAddition && Object.values(mappings).includes(location)) {
          setMove(change, 'from', Object.keys(mappings).find(k => mappings[k] === location));
        } else if (change.isRemoval && Object.keys(mappings).includes(location)) {
          setMove(change, 'to', mappings[location]);
        }
      });

      this._diffs[realStackName] = templateDiff;
    }
    return this._diffs[realStackName];
  }

  /**
   * Return whether the diff has security-impacting changes that need confirmation.
   *
   * If no stackName is given, then the root stack name is used.
   */
  private permissionType(): PermissionChangeType {
    const diff = this.diff();

    if (diff.permissionsBroadened) {
      return PermissionChangeType.BROADENING;
    } else if (diff.permissionsAnyChanges) {
      return PermissionChangeType.NON_BROADENING;
    } else {
      return PermissionChangeType.NONE;
    }
  }

  /**
   * Format the stack diff
   */
  public formatStackDiff(options: FormatStackDiffOptions = {}): FormatStackDiffOutput {
    return this.formatStackDiffHelper(
      this.oldTemplate,
      this.stackName,
      this.nestedStacks,
      options,
      this.mappings,
    );
  }

  private formatStackDiffHelper(
    oldTemplate: any,
    stackName: string,
    nestedStackTemplates: { [nestedStackLogicalId: string]: NestedStackTemplates } | undefined,
    options: ReusableStackDiffOptions,
    mappings: Record<string, string> = {},
  ) {
    let diff = this.diff(stackName, oldTemplate, mappings);

    // The stack diff is formatted via `Formatter`, which takes in a stream
    // and sends its output directly to that stream. To facilitate use of the
    // global CliIoHost, we create our own stream to capture the output of
    // `Formatter` and return the output as a string for the consumer of
    // `formatStackDiff` to decide what to do with it.
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
      if (diff.differenceCount && !options.strict) {
        const mangledNewTemplate = JSON.parse(mangleLikeCloudFormation(JSON.stringify(this.newTemplate.template)));
        const mangledDiff = fullDiff(this.oldTemplate, mangledNewTemplate, this.changeSet);
        filteredChangesCount = Math.max(0, diff.differenceCount - mangledDiff.differenceCount);
        if (filteredChangesCount > 0) {
          diff = mangledDiff;
        }
      }

      // filter out 'AWS::CDK::Metadata' resources from the template
      // filter out 'CheckBootstrapVersion' rules from the template
      if (!options.strict) {
        obscureDiff(diff);
      }

      if (!diff.isEmpty) {
        numStacksWithChanges++;

        // formatDifferences updates the stream with the formatted stack diff
        formatDifferences(stream, diff, {
          ...logicalIdMapFromTemplate(this.oldTemplate),
          ...buildLogicalToPathMap(this.newTemplate),
        }, options.contextLines);
      } else if (!options.quiet) {
        stream.write(chalk.green('There were no differences\n'));
      }

      if (filteredChangesCount > 0) {
        stream.write(chalk.yellow(`Omitted ${filteredChangesCount} changes because they are likely mangled non-ASCII characters. Use --strict to print them.\n`));
      }
    } finally {
      // store the stream containing a formatted stack diff
      formattedDiff = stream.toString();
      stream.end();
    }

    for (const nestedStackLogicalId of Object.keys(nestedStackTemplates ?? {})) {
      if (!nestedStackTemplates) {
        break;
      }
      const nestedStack = nestedStackTemplates[nestedStackLogicalId];

      (this.newTemplate as any)._template = nestedStack.generatedTemplate;
      const nextDiff = this.formatStackDiffHelper(
        nestedStack.deployedTemplate,
        nestedStack.physicalName ?? nestedStackLogicalId,
        nestedStack.nestedStackTemplates,
        options,
        this.mappings,
      );
      numStacksWithChanges += nextDiff.numStacksWithChanges;
      formattedDiff += nextDiff.formattedDiff;
    }

    return {
      numStacksWithChanges,
      formattedDiff,
    };
  }

  /**
   * Format the security diff
   */
  public formatSecurityDiff(): FormatSecurityDiffOutput {
    const diff = this.diff();

    // The security diff is formatted via `Formatter`, which takes in a stream
    // and sends its output directly to that stream. To faciliate use of the
    // global CliIoHost, we create our own stream to capture the output of
    // `Formatter` and return the output as a string for the consumer of
    // `formatSecurityDiff` to decide what to do with it.
    const stream = new StringWriteStream();

    stream.write(format(`Stack ${chalk.bold(this.stackName)}\n`));

    try {
      // formatSecurityChanges updates the stream with the formatted security diff
      formatSecurityChanges(stream, diff, buildLogicalToPathMap(this.newTemplate));
    } finally {
      stream.end();
    }
    // store the stream containing a formatted stack diff
    const formattedDiff = stream.toString();
    return { formattedDiff, permissionChangeType: this.permissionType() };
  }
}

function buildLogicalToPathMap(stack: cxapi.CloudFormationStackArtifact) {
  const map: { [id: string]: string } = {};
  for (const md of stack.findMetadataByType(cxschema.ArtifactMetadataEntryType.LOGICAL_ID)) {
    map[md.data as string] = md.path;
  }
  return map;
}

function logicalIdMapFromTemplate(template: any) {
  const ret: Record<string, string> = {};

  for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
    const path = (resource as any)?.Metadata?.['aws:cdk:path'];
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
