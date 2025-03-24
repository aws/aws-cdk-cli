import type * as cxapi from '@aws-cdk/cx-api';
import { RequireApproval } from '../../../require-approval';
import { ToolkitError } from '../../../toolkit-error';
import { buildLogicalToPathMap, StringWriteStream } from './util';
import {
  type DescribeChangeSetOutput,
  type TemplateDiff,
  fullDiff,
  formatSecurityChanges,
} from '@aws-cdk/cloudformation-diff';

/**
 * Output of formatSecurityDiff
 */
export interface FormatSecurityDiffOutput {
  /**
   * Complete formatted security diff, if it is prompt-worthy
   */
  readonly formattedDiff?: string;
}

/**
 * Formats the security changes of this diff, if the change is impactful enough according to the approval level
 *
 * Returns the diff if the changes are prompt-worthy, an empty object otherwise.
 */
export function formatSecurityDiff(
  oldTemplate: any,
  newTemplate: cxapi.CloudFormationStackArtifact,
  requireApproval: RequireApproval,
  stackName?: string,
  changeSet?: DescribeChangeSetOutput,
): FormatSecurityDiffOutput {
  const diff = fullDiff(oldTemplate, newTemplate.template, changeSet);

  if (diffRequiresApproval(diff, requireApproval)) {
    info(format('Stack %s\n', chalk.bold(stackName)));

    // eslint-disable-next-line max-len
    warning(`This deployment will make potentially sensitive changes according to your current security approval level (--require-approval ${requireApproval}).`);
    warning('Please confirm you intend to make the following modifications:\n');

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
    return { formattedDiff };
  }
  return {};
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