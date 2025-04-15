import { format } from 'node:util';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import {
  formatDifferences,
  formatSecurityChanges,
  fullDiff,
  mangleLikeCloudFormation,
  type TemplateDiff,
} from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';
import type { NestedStackTemplates } from '../cloudformation';
import type { IoHelper } from '../io/private';
import { IoDefaultMessages } from '../io/private';
import { StringWriteStream } from '../streams';
import { ToolkitError } from '../toolkit-error';
import { PermissionChangeType } from '../../payloads';

/**
 * Output of formatSecurityDiff
 */
interface FormatSecurityDiffOutput {
  /**
   * Complete formatted security diff, if it is prompt-worthy
   */
  readonly formattedDiff?: string;
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
   * Helper for the IoHost class
   */
  readonly ioHelper: IoHelper;

  /**
   * The relevant information for the Template that is being diffed.
   * Includes the old/current state of the stack as well as the new state.
   */
  readonly templateInfo: TemplateInfo;
}

/**
 * Properties specific to formatting the security diff
 */
interface FormatSecurityDiffOptions {}

/**
 * PRoperties specific to formatting the stack diff
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
  readonly context?: number;

  /**
   * silences \'There were no differences\' messages
   *
   * @default false
   */
  readonly quiet?: boolean;
}

interface ReusableStackDiffOptions extends FormatStackDiffOptions {
  readonly ioDefaultHelper: IoDefaultMessages;
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
   * The name of the stack
   *
   * @default undefined
   */
  readonly stackName?: string;

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
}

/**
 * Class for formatting the diff output
 */
export class DiffFormatter {
  private readonly ioHelper: IoHelper;
  private readonly oldTemplate: any;
  private readonly newTemplate: cxapi.CloudFormationStackArtifact;
  private readonly stackName?: string;
  private readonly changeSet?: any;
  private readonly nestedStacks: { [nestedStackLogicalId: string]: NestedStackTemplates } | undefined;
  private readonly isImport: boolean;

  /**
   * Stores the TemplateDiffs that get calculated in this DiffFormatter,
   * indexed by the stack name.
   */
  private _diffs: { [name: string]: TemplateDiff } = {};

  constructor(props: DiffFormatterProps) {
    this.ioHelper = props.ioHelper;
    this.oldTemplate = props.templateInfo.oldTemplate;
    this.newTemplate = props.templateInfo.newTemplate;
    this.stackName = props.templateInfo.stackName;
    this.changeSet = props.templateInfo.changeSet;
    this.nestedStacks = props.templateInfo.nestedStacks;
    this.isImport = props.templateInfo.isImport ?? false;
  }

  public get diffs() {
    return this._diffs;
  }

  /**
   * Return whether the diff has security-impacting changes that need confirmation.
   */
  public determinePermissionType(stackName: string): PermissionChangeType {
    const diff = this._diffs[stackName];

    if (!diff) {
      throw new ToolkitError(`No diff found for stack ${stackName}`);
    }

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
    const ioDefaultHelper = new IoDefaultMessages(this.ioHelper);
    return this.formatStackDiffHelper(
      this.oldTemplate,
      this.stackName,
      this.nestedStacks,
      {
        ...options,
        ioDefaultHelper,
      },
    );
  }

  private formatStackDiffHelper(
    oldTemplate: any,
    stackName: string | undefined,
    nestedStackTemplates: { [nestedStackLogicalId: string]: NestedStackTemplates } | undefined,
    options: ReusableStackDiffOptions,
  ) {
    let diff = fullDiff(oldTemplate, this.newTemplate.template, this.changeSet, this.isImport);

    // The stack diff is formatted via `Formatter`, which takes in a stream
    // and sends its output directly to that stream. To faciliate use of the
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
        }, options.context);
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
  public formatSecurityDiff(_options: FormatSecurityDiffOptions = {}): FormatSecurityDiffOutput {
    const ioDefaultHelper = new IoDefaultMessages(this.ioHelper);

    const diff = fullDiff(this.oldTemplate, this.newTemplate.template, this.changeSet);

    // The security diff is formatted via `Formatter`, which takes in a stream
    // and sends its output directly to that stream. To faciliate use of the
    // global CliIoHost, we create our own stream to capture the output of
    // `Formatter` and return the output as a string for the consumer of
    // `formatSecurityDiff` to decide what to do with it.
    const stream = new StringWriteStream();

    stream.write(format(`Stack ${chalk.bold(this.stackName)}\n`));

    // eslint-disable-next-line max-len
    ioDefaultHelper.warning(`This deployment will make potentially sensitive changes according to your current security approval level.`);
    ioDefaultHelper.warning('Please confirm you intend to make the following modifications:\n');
    try {
      // formatSecurityChanges updates the stream with the formatted security diff
      formatSecurityChanges(stream, diff, buildLogicalToPathMap(this.newTemplate));
    } finally {
      stream.end();
    }
    // store the stream containing a formatted stack diff
    const formattedDiff = stream.toString();
    return { formattedDiff };
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
