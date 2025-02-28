import { DescribeChangeSetOutput, fullDiff } from '@aws-cdk/cloudformation-diff';
import * as cxapi from '@aws-cdk/cx-api';

/**
 * Return whether the diff has security-impacting changes that need confirmation.
 */
export function determinePermissionType(
  oldTemplate: any,
  newTemplate: cxapi.CloudFormationStackArtifact,
  changeSet?: DescribeChangeSetOutput,
): 'non-broadening' | 'broadening' | 'none' {
  // @todo return a printable version of the full diff.
  const diff = fullDiff(oldTemplate, newTemplate.template, changeSet);

  if (diff.permissionsBroadened) {
    return 'broadening';
  } else if (diff.permissionsAnyChanges) {
    return 'non-broadening';
  } else {
    return 'none';
  }
}
