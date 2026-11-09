import type { StackEvent } from '@aws-sdk/client-cloudformation';
import { isFailedHookStatus } from './hook-result-details';
import type { ResourceEvent } from './stack-event-poller';
import { DeploymentErrorCodes } from '../../toolkit/toolkit-error';
import { isCancellationEvent, isErrorEvent, isRegularResourceEvent } from '../../util/cloudformation';

/**
 * A failed CloudFormation Hook invocation that caused a resource error.
 */
export interface ResourceHookFailure {
  /**
   * The type name of the hook that failed (e.g. `Private::Guard::TestHook`)
   */
  readonly hookType: string;

  /**
   * The unique identifier of the hook invocation.
   *
   * Can be used to fetch the full failure details via the `GetHookResult` API.
   */
  readonly hookInvocationId?: string;

  /**
   * The status reason reported on the hook's stack event.
   *
   * This is usually a terse summary; the `GetHookResult` API has richer details.
   */
  readonly hookStatusReason?: string;
}

export interface ResourceError {
  /**
   * The stack this resource error occurred in
   *
   * NOTE: This will be a stack ID (which is a full ARN including the unique identifier),
   * not just a name.
   */
  readonly stackArn: string;

  /**
   * IDs of parent stacks of the resource, in case of resources in nested stacks
   */
  readonly parentStackLogicalIds: string[];

  /**
   * Logical ID of the resource
   *
   * (May be absent in case this message is about the stack itself)
   */
  readonly logicalId?: string;

  /**
   * Resource type
   */
  readonly resourceType?: string;

  /**
   * Physical ID of the resource
   */
  readonly physicalId?: string;

  /**
   * Error message of the resource
   */
  readonly message: string;

  /**
   * Error code of the resource
   */
  readonly errorCode?: string;

  /**
   * Timestamp of the failure event, if known.
   *
   * Used to bound exploratory lookups (e.g. CloudWatch Logs queries) to the time
   * around the failure. This matters for resources whose logs span multiple
   * deployments (creates, updates, rollbacks), where the most recent invocation
   * is not necessarily the one that failed.
   *
   * Only populated for errors derived from stack events; absent for change-set
   * and early-validation errors.
   */
  readonly timestamp?: Date;

  /**
   * CloudFormation Hook failures that caused this resource error, if any.
   *
   * Hook failures are reported on separate stack events from the resource failure
   * itself; they are correlated to the resource error by logical ID and by the
   * hook type appearing in the resource's status reason.
   */
  readonly hookFailures?: ResourceHookFailure[];

  /**
   * Warnings related to this error that should be surfaced alongside it, if any.
   *
   * For example, a note that CloudFormation Hook failure detail could not be fetched
   * (e.g. `ListHookResults` failed due to missing permissions). Rendered as additional
   * context after the main error message.
   */
  readonly warnings?: string[];
}

/**
 * A stack resource that can act as an AWS principal, seen during a stack operation.
 */
export interface OperationPrincipal {
  /**
   * The stack the resource belongs to (a stack ID, not a name)
   */
  readonly stackArn: string;

  /**
   * Logical ID of the resource
   */
  readonly logicalId: string;

  /**
   * Resource type
   */
  readonly resourceType: string;

  /**
   * Physical ID of the resource (a role or function name)
   */
  readonly physicalId: string;
}

/**
 * Resource types whose physical IDs identify the caller of an AWS API call in CloudTrail:
 * a role appears in the session ARN of whoever assumes it, and a Lambda function is the
 * session name (and `inScopeOf` resource) of calls made by its code.
 */
export const PRINCIPAL_RESOURCE_TYPES = ['AWS::IAM::Role', 'AWS::Lambda::Function'];

/**
 * Class used to send stack event errors into, to come up with root causes.
 */
export class ResourceErrors {
  /**
   * A list of all non-cancellation errors we have seen.
   *
   * By the nature of the order we see events in, will be ordered from oldest to newest.
   */
  private readonly _errors: ResourceError[] = [];

  /**
   * Failed hook invocations seen so far, keyed by stack ARN + logical ID of the
   * resource they were invoked on.
   *
   * Hook failures are reported on their own events (usually with an `IN_PROGRESS`
   * resource status), before the resource failure event they cause. We remember
   * them here so they can be attached to that resource error when it arrives.
   */
  private readonly seenHookFailures = new Map<string, ResourceHookFailure[]>();

  /**
   * Principal-capable resources seen in any event of the operation, keyed by stack ARN +
   * logical ID + physical ID.
   */
  private readonly seenPrincipals = new Map<string, OperationPrincipal>();

  public isEmpty() {
    return this._errors.length === 0;
  }

  public get all(): ReadonlyArray<ResourceError> {
    return this._errors;
  }

  /**
   * Every role and Lambda function that appeared in an event of the operation, including
   * ones that were created and have since been rolled back (and so no longer appear in the
   * stack's resource list), and ones replaced by the update.
   */
  public get principals(): ReadonlyArray<OperationPrincipal> {
    return [...this.seenPrincipals.values()];
  }

  /**
   * Update the error collection with the given stack activity
   *
   * May be from a nested stack as well.
   *
   * This class expects to see all events in chronological order.
   */
  public update(...events: ResourceEvent[]) {
    for (const event of events) {
      this.trackHookFailure(event.event);
      this.trackPrincipal(event.event);
      if (isErrorEvent(event.event)) {
        // Cancelled is not an interesting failure reason, nor is the stack message (stack
        // message will just say something like "stack failed to update")
        if (!isCancellationEvent(event.event) && isRegularResourceEvent(event.event)) {
          this._errors.push(errorFromEvent(event, this.hookFailuresFor(event.event)));
        }
      }
    }
  }

  private trackPrincipal(event: StackEvent) {
    const { StackId: stackArn, LogicalResourceId: logicalId, ResourceType: resourceType, PhysicalResourceId: physicalId } = event;
    if (!stackArn || !logicalId || !physicalId || !resourceType || !PRINCIPAL_RESOURCE_TYPES.includes(resourceType)) {
      return;
    }
    this.seenPrincipals.set(`${stackArn}|${logicalId}|${physicalId}`, { stackArn, logicalId, resourceType, physicalId });
  }

  private trackHookFailure(event: StackEvent) {
    if (!isFailedHookStatus(event.HookStatus) || !event.HookType || !event.LogicalResourceId || !event.StackId) {
      return;
    }
    const key = hookFailureKey(event);
    const failures = this.seenHookFailures.get(key) ?? [];
    failures.push({
      hookType: event.HookType,
      hookInvocationId: event.HookInvocationId,
      hookStatusReason: event.HookStatusReason,
    });
    this.seenHookFailures.set(key, failures);
  }

  /**
   * Return the hook failures that caused the given resource failure, if any.
   *
   * A hook failure belongs to a resource failure when it was recorded for the same
   * resource, and its hook type is mentioned in the resource's status reason (e.g.
   * "The following hook(s) failed: [Private::Guard::TestHook]").
   */
  private hookFailuresFor(event: StackEvent): ResourceHookFailure[] {
    const recorded = this.seenHookFailures.get(hookFailureKey(event)) ?? [];
    const reason = event.ResourceStatusReason ?? '';
    return recorded.filter((h) => reason.includes(h.hookType));
  }

  /**
   * Take our best guess at the error code of the root cause
   *
   * The first error that occurs is the root cause.
   */
  public get rootCauseErrorCode(): string | undefined {
    return this.allErrorCodes[0];
  }

  /**
   * Return error messages of all encountered errors (that aren't cancellations)
   */
  public get allErrorMessages(): string[] {
    return this._errors.map(e => e.message);
  }

  /**
   * Return error codeds of all encountered errors (that aren't cancellations nor stack errors)
   *
   * We don't need to include nested stack errors because our poller will poll the nested stack,
   * and have returned the actual error as well.
   */
  public get allErrorCodes(): string[] {
    return this._errors.map(e => e.errorCode).filter(x => typeof x === 'string');
  }
}

function errorFromEvent(ev: ResourceEvent, hookFailures: ResourceHookFailure[]): ResourceError {
  return {
    logicalId: ev.event.LogicalResourceId ?? '',
    message: ev.event.ResourceStatusReason ?? '',
    parentStackLogicalIds: ev.parentStackLogicalIds,
    resourceType: ev.event.ResourceType ?? '',
    stackArn: ev.event.StackId ?? '',
    errorCode: extractErrorCode(ev.event),
    physicalId: ev.event.PhysicalResourceId,
    timestamp: ev.event.Timestamp,
    ...(hookFailures.length > 0 ? { hookFailures } : {}),
  };
}

function hookFailureKey(event: StackEvent): string {
  return `${event.StackId ?? ''}|${event.LogicalResourceId ?? ''}`;
}

/**
 * Extract an error code from the given stack event.
 *
 * Always contains the services, and includes the handler error code if available.
 */
export function extractErrorCode(event: StackEvent): string {
  const isOurCustomResource = OUR_CUSTOM_RESOURCE_TYPES.includes(event.ResourceType ?? '');

  // Get the resource type; if it is non-AWS then we are done.
  const resourceTypeParts = (event.ResourceType ?? '').split('::');
  if (resourceTypeParts[0] !== 'AWS' && !isOurCustomResource) {
    return DeploymentErrorCodes.PRIVATE_RESOURCE_ERROR;
  }

  const resourceType = isOurCustomResource ? resourceTypeParts.join('') : resourceTypeParts.slice(1).join('');

  const reason = event.ResourceStatusReason ?? '';

  const errorRe = /(?:HandlerErrorCode:|Error Code:) ([a-zA-Z0-9:-]+)/;
  const handlerCode = reason.match(errorRe);

  return `${resourceType}:${handlerCode ? handlerCode[1] : DeploymentErrorCodes.UNKNOWN_ERROR}`;
}

// Some custom resource types that the CDK standard library creates that we
// would like to see it if they fail.
const OUR_CUSTOM_RESOURCE_TYPES = [
  'Custom::AWS',
  'Custom::AWSCDK-EKS-Cluster',
  'Custom::AWSCDK-EKS-FargateProfile',
  'Custom::AWSCDK-EKS-HelmChart',
  'Custom::AWSCDK-EKS-KubernetesObjectValue',
  'Custom::AWSCDK-EKS-KubernetesPatch',
  'Custom::AWSCDK-EKS-KubernetesResource',
  'Custom::AWSCDKCfnJson',
  'Custom::AWSCDKCfnJsonStringify',
  'Custom::AWSCDKOpenIdConnectProvider',
  'Custom::CDKBucketDeployment',
  'Custom::CloudwatchLogResourcePolicy',
  'Custom::CrossAccountZoneDelegation',
  'Custom::CrossRegionExportReader',
  'Custom::CrossRegionExportWriter',
  'Custom::CrossRegionStringParameterReader',
  'Custom::DeleteExistingRecordSet',
  'Custom::DescribeCognitoUserPoolClient',
  'Custom::DynamoDBReplica',
  'Custom::ECRAutoDeleteImages',
  'Custom::ElasticsearchAccessPolicy',
  'Custom::LogRetention',
  'Custom::OpenSearchAccessPolicy',
  'Custom::S3AutoDeleteObjects',
  'Custom::S3BucketNotifications',
  'Custom::SyntheticsAutoDeleteUnderlyingResources',
  'Custom::Trigger',
  'Custom::UserPoolCloudFrontDomainName',
  'Custom::VpcRestrictDefaultSG',
];
