import type * as cxapi from '@aws-cdk/cx-api';
import {
  type DescribeChangeSetOutput,
  formatDifferences,
  fullDiff,
  mangleLikeCloudFormation,
} from '@aws-cdk/cloudformation-diff';
import { buildLogicalToPathMap, logicalIdMapFromTemplate, obscureDiff, StringWriteStream } from './util';
import { NestedStackTemplates } from './nested-stack-templates';

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
  oldTemplate: any,
  newTemplate: cxapi.CloudFormationStackArtifact,
  strict: boolean,
  context: number,
  quiet: boolean,
  stackName?: string,
  changeSet?: DescribeChangeSetOutput,
  isImport?: boolean,
  nestedStackTemplates?: { [nestedStackLogicalId: string]: NestedStackTemplates }): FormatStackDiffOutput {
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
      info(chalk.green('There were no differences'));
    }
  } finally {
    stream.end();
  }

  if (filteredChangesCount > 0) {
    info(chalk.yellow(`Omitted ${filteredChangesCount} changes because they are likely mangled non-ASCII characters. Use --strict to print them.`));
  }

  for (const nestedStackLogicalId of Object.keys(nestedStackTemplates ?? {})) {
    if (!nestedStackTemplates) {
      break;
    }
    const nestedStack = nestedStackTemplates[nestedStackLogicalId];

    (newTemplate as any)._template = nestedStack.generatedTemplate;
    const nextDiff = formatStackDiff(
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
  };
}
