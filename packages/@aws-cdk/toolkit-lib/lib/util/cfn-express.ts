import type { StackEvent } from '@aws-sdk/client-cloudformation';
import * as chalk from 'chalk';
import type { StabilizingResource } from '../toolkit/types';

/**
 * Whether the Express Mode warning is for a stack that was just deployed or destroyed.
 */
export type ExpressStabilizationMode = 'deploy' | 'destroy';

/**
 * Whether a CloudFormation event reports a resource that completed but is still
 * stabilizing (Express Mode).
 *
 * The root stack itself is excluded: its `*_COMPLETE` reason describes the
 * overall operation, not an individual stabilizing resource.
 */
export function isStabilizingResourceEvent(event: StackEvent): boolean {
  return (
    event.ResourceStatus !== undefined &&
    event.ResourceStatus?.endsWith('_COMPLETE') &&
    event.ResourceType !== 'AWS::CloudFormation::Stack' &&
    event.ResourceType !== 'AWS::CDK::Metadata' &&
    event.ResourceStatusReason !== undefined &&
    event.LogicalResourceId !== undefined
  );
}

/**
 * Build the Express Mode warning about resources that are still settling after the
 * CloudFormation operation reports complete.
 *
 * The `CDKMetadata` resource is excluded from both the displayed names and the final count.
 *
 * @returns the formatted warning message, or `undefined`
 */
export function formatExpressStabilizationWarning(
  stabilizingResources: StabilizingResource[],
  mode: ExpressStabilizationMode,
): string | undefined {
  if (stabilizingResources.length === 0) {
    return undefined;
  }

  const maxNamed = 5;
  const names = stabilizingResources.map((r) => r.logicalResourceId);
  const shown = names.slice(0, maxNamed).join(', ');
  const remaining = names.length - maxNamed;
  const resourceList = remaining > 0 ? `${shown}, ...and ${remaining} more...` : shown;

  const message = mode === 'deploy'
    ? `⚠️  Stack deployed using Express Mode. Resources still stabilizing: ${resourceList}\n`
    : `⚠️  Stack deleted using Express Mode. Resources still tearing down: ${resourceList}\n`;

  return chalk.yellow(message);
}
