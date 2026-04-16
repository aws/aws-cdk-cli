import { StackEvent } from "@aws-sdk/client-cloudformation";
import { isCancellationEvent, isErrorEvent, isRegularResourceEvent } from "../../util/cloudformation";
import { DeploymentErrorCodes } from "../../toolkit/toolkit-error";
import { ResourceEvent } from "./stack-event-poller";

export interface ResourceError {
  /**
   * The stack this resource error occurred in
   *
   * NOTE: This will be a stack ID (which is a full ARN including the unique identifier),
   * not just a name.
   */
  readonly stackId: string;

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
}


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

  public isEmpty() {
    return this._errors.length === 0;
  }

  public get all(): ReadonlyArray<ResourceError> {
    return this._errors;
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
      if (isErrorEvent(event.event)) {
        // Cancelled is not an interesting failure reason, nor is the stack message (stack
        // message will just say something like "stack failed to update")
        if (!isCancellationEvent(event.event) && isRegularResourceEvent(event.event)) {
          this._errors.push(errorFromEvent(event));
        }
      }
    }
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

function errorFromEvent(ev: ResourceEvent): ResourceError {
  // FIXME: Check hooks

  return {
    logicalId: ev.event.LogicalResourceId ?? '',
    message: ev.event.ResourceStatusReason ?? '',
    parentStackLogicalIds: ev.parentStackLogicalIds,
    resourceType: ev.event.ResourceType ?? '',
    stackId: ev.event.StackId ?? '',
    errorCode: extractErrorCode(ev.event),
    physicalId: ev.event.PhysicalResourceId,
  };
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
