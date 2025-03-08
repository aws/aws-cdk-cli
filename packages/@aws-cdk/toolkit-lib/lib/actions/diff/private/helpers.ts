import type { DescribeChangeSetOutput } from '@aws-cdk/cloudformation-diff';
import { fullDiff } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import { PermissionChangeType } from '..';

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
