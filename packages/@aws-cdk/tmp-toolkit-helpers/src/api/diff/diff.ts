import { format } from 'node:util';
import { Writable } from 'stream';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';
import {
  type DescribeChangeSetOutput,
  type TemplateDiff,
  fullDiff,
  formatSecurityChanges,
  formatDifferences,
  mangleLikeCloudFormation,
} from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import * as chalk from 'chalk';

import { RequireApproval } from '../../api/require-approval';
import { ToolkitError } from '../../api/toolkit-error';
import type { NestedStackTemplates } from '../cloudformation/nested-stack-templates';
import type { IoHelper } from '../io/private';
import { IoDefaultMessages } from '../io/private';

/*
 * Custom writable stream that collects text into a string buffer.
 * Used on classes that take in and directly write to a stream, but
 * we intend to capture the output rather than print.
 */
export class StringWriteStream extends Writable {
  private buffer: string[] = [];

  constructor() {
    super();
  }

  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void): void {
    this.buffer.push(chunk.toString());
    callback();
  }

  toString(): string {
    return this.buffer.join('');
  }
}

/**
 * Output of formatSecurityDiff
 */
export interface FormatSecurityDiffOutput {
  /**
   * Complete formatted security diff, if it is prompt-worthy
   */
  readonly formattedDiff?: string;

  /**
   * The full diff object
   */
  readonly fullDiff: TemplateDiff;
}

/**
 * Formats the security changes of this diff, if the change is impactful enough according to the approval level
 *
 * Returns the diff if the changes are prompt-worthy, an empty object otherwise.
 */
export function formatSecurityDiff(
  ioHelper: IoHelper,
  oldTemplate: any,
  newTemplate: cxapi.CloudFormationStackArtifact,
  requireApproval: RequireApproval,
  stackName?: string,
  changeSet?: DescribeChangeSetOutput,
): FormatSecurityDiffOutput {
  const ioDefaultHelper = new IoDefaultMessages(ioHelper);

  const diff = fullDiff(oldTemplate, newTemplate.template, changeSet);

  if (diffRequiresApproval(diff, requireApproval)) {
    ioDefaultHelper.info(format('Stack %s\n', chalk.bold(stackName)));

    // eslint-disable-next-line max-len
    ioDefaultHelper.warning(`This deployment will make potentially sensitive changes according to your current security approval level (--require-approval ${requireApproval}).`);
    ioDefaultHelper.warning('Please confirm you intend to make the following modifications:\n');

    // The security diff is formatted via `Formatter`, which takes in a stream
    // and sends its output directly to that stream. To faciliate use of the
    // global CliIoHost, we create our own stream to capture the output of
    // `Formatter` and return the output as a string for the consumer of
    // `formatSecurityDiff` to decide what to do with it.
    const stream = new StringWriteStream();
    try {
      // formatSecurityChanges updates the stream with the formatted security diff
      formatSecurityChanges(stream, diff, buildLogicalToPathMap(newTemplate));
    } finally {
      stream.end();
    }
    // store the stream containing a formatted stack diff
    const formattedDiff = stream.toString();
    return { formattedDiff, fullDiff: diff };
  }
  return {
    fullDiff: diff,
  };
}

/**
 * Output of formatStackDiff
 */
export interface FormatStackDiffOutput {
  /**
   * Number of stacks with diff changes
   */
  readonly numStacksWithChanges: number;

  /**
   * Complete formatted diff
   */
  readonly formattedDiff: string;

  /**
   * The full diff object
   */
  readonly fullDiff: TemplateDiff,
}

/**
 * Formats the differences between two template states and returns it as a string.
 *
 * @param oldTemplate the old/current state of the stack.
 * @param newTemplate the new/target state of the stack.
 * @param strict      do not filter out AWS::CDK::Metadata or Rules
 * @param context     lines of context to use in arbitrary JSON diff
 * @param quiet       silences \'There were no differences\' messages
 *
 * @returns the formatted diff, and the number of stacks in this stack tree that have differences, including the top-level root stack
 */
export function formatStackDiff(
  ioHelper: IoHelper,
  oldTemplate: any,
  newTemplate: cxapi.CloudFormationStackArtifact,
  strict: boolean,
  context: number,
  quiet: boolean,
  stackName?: string,
  changeSet?: DescribeChangeSetOutput,
  isImport?: boolean,
  nestedStackTemplates?: { [nestedStackLogicalId: string]: NestedStackTemplates }): FormatStackDiffOutput {
  const ioDefaultHelper = new IoDefaultMessages(ioHelper);

  let diff = fullDiff(oldTemplate, newTemplate.template, changeSet, isImport);

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
    if (stackName && (!quiet || !diff.isEmpty)) {
      stream.write(format('Stack %s\n', chalk.bold(stackName)));
    }

    if (!quiet && isImport) {
      stream.write('Parameters and rules created during migration do not affect resource configuration.\n');
    }

    // detect and filter out mangled characters from the diff
    if (diff.differenceCount && !strict) {
      const mangledNewTemplate = JSON.parse(mangleLikeCloudFormation(JSON.stringify(newTemplate.template)));
      const mangledDiff = fullDiff(oldTemplate, mangledNewTemplate, changeSet);
      filteredChangesCount = Math.max(0, diff.differenceCount - mangledDiff.differenceCount);
      if (filteredChangesCount > 0) {
        diff = mangledDiff;
      }
    }

    // filter out 'AWS::CDK::Metadata' resources from the template
    // filter out 'CheckBootstrapVersion' rules from the template
    if (!strict) {
      obscureDiff(diff);
    }

    if (!diff.isEmpty) {
      numStacksWithChanges++;

      // formatDifferences updates the stream with the formatted stack diff
      formatDifferences(stream, diff, {
        ...logicalIdMapFromTemplate(oldTemplate),
        ...buildLogicalToPathMap(newTemplate),
      }, context);

      // store the stream containing a formatted stack diff
      formattedDiff = stream.toString();
    } else if (!quiet) {
      ioDefaultHelper.info(chalk.green('There were no differences'));
    }
  } finally {
    stream.end();
  }

  if (filteredChangesCount > 0) {
    ioDefaultHelper.info(chalk.yellow(`Omitted ${filteredChangesCount} changes because they are likely mangled non-ASCII characters. Use --strict to print them.`));
  }

  for (const nestedStackLogicalId of Object.keys(nestedStackTemplates ?? {})) {
    if (!nestedStackTemplates) {
      break;
    }
    const nestedStack = nestedStackTemplates[nestedStackLogicalId];

    (newTemplate as any)._template = nestedStack.generatedTemplate;
    const nextDiff = formatStackDiff(
      ioHelper,
      nestedStack.deployedTemplate,
      newTemplate,
      strict,
      context,
      quiet,
      nestedStack.physicalName ?? nestedStackLogicalId,
      undefined,
      isImport,
      nestedStack.nestedStackTemplates,
    );
    numStacksWithChanges += nextDiff.numStacksWithChanges;
    formattedDiff += nextDiff.formattedDiff;
  }

  return {
    numStacksWithChanges,
    formattedDiff,
    fullDiff: diff,
  };
}

/**
 * Return whether the diff has security-impacting changes that need confirmation
 *
 * TODO: Filter the security impact determination based off of an enum that allows
 * us to pick minimum "severities" to alert on.
 */
function diffRequiresApproval(diff: TemplateDiff, requireApproval: RequireApproval) {
  switch (requireApproval) {
    case RequireApproval.NEVER: return false;
    case RequireApproval.ANY_CHANGE: return diff.permissionsAnyChanges;
    case RequireApproval.BROADENING: return diff.permissionsBroadened;
    default: throw new ToolkitError(`Unrecognized approval level: ${requireApproval}`);
  }
}

export function buildLogicalToPathMap(stack: cxapi.CloudFormationStackArtifact) {
  const map: { [id: string]: string } = {};
  for (const md of stack.findMetadataByType(cxschema.ArtifactMetadataEntryType.LOGICAL_ID)) {
    map[md.data as string] = md.path;
  }
  return map;
}

export function logicalIdMapFromTemplate(template: any) {
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
export function obscureDiff(diff: TemplateDiff) {
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
