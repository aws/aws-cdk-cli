import { DescribeChangeSetOutput, fullDiff } from '@aws-cdk/cloudformation-diff';
import * as cxapi from '@aws-cdk/cx-api';
import { RequireApproval } from '../../deploy';

/**
 * Return whether the diff has security-impacting changes that need confirmation.
 * We will return the 
 * 
 * RequireApproval.BROADENING is returned if there is a broadening change. This
 * means that we will request response if the IoHost specifies RequireApproval.BROADENING
 * OR RequireApproval.ANY_CHANGE.
 * RequireApproval.ANY_CHANGE is returned if there is a non-broadening change
 * in the template. This will request response if the IoHost specifies
 * RequireApproval.ANY_CHANGE only.
 * REequireApproval.NEVER is returned if there are no security-impacting changes. This
 * means that we wil never request response regardless of IoHost settings.
 */
export function determineApprovalLevel(
  oldTemplate: any,
  newTemplate: cxapi.CloudFormationStackArtifact,
  changeSet?: DescribeChangeSetOutput,
): RequireApproval {
  // @todo return a printable version of the full diff.
  const diff = fullDiff(oldTemplate, newTemplate.template, changeSet);

  if (diff.permissionsAnyChanges) {
    return RequireApproval.ANY_CHANGE;
  } else if (diff.permissionsBroadened) {
    return RequireApproval.BROADENING;
  } else {
    return RequireApproval.NEVER;
  }
}
