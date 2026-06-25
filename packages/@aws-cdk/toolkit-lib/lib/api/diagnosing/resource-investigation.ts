import { investigateCustomResource, type InvestigateCustomResourceOptions } from './investigate-custom-resource';
import { investigateEcsService, type InvestigateOptions } from './investigate-ecs-service';
import type { AdditionalDiagnosticContext } from '../../actions/diagnose';
import type { SDK } from '../aws-auth/sdk';
import type { ResourceError } from '../stack-events/resource-errors';

export type { InvestigateOptions };

/**
 * The superset of options across all resource-type investigations. The dispatcher accepts
 * this and routes the relevant subset to each investigation (e.g. only the custom-resource
 * path reads `cloudTrailEnabled`).
 */
export type InvestigateResourceOptions = InvestigateCustomResourceOptions;

/**
 * Investigate a failed resource using AWS service APIs to gather additional root cause context.
 *
 * Returns additional diagnostic context (e.g. log lines) or an empty array if
 * investigation is not possible or yields no results for this resource type.
 */
export async function investigateResource(
  err: ResourceError,
  sdk: SDK,
  debug: (msg: string) => Promise<void>,
  options: InvestigateResourceOptions = {},
): Promise<AdditionalDiagnosticContext[]> {
  const resourceType = err.resourceType ?? '';
  if (resourceType === 'AWS::ECS::Service') {
    return investigateEcsService(err, sdk, debug, options);
  }
  if (resourceType === 'AWS::CloudFormation::CustomResource' || resourceType.startsWith('Custom::')) {
    return investigateCustomResource(err, sdk, debug, options);
  }
  return [];
}
