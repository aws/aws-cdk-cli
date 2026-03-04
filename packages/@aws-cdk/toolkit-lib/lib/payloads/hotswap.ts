import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import type { PropertyDifference, Resource } from '@aws-cdk/cloudformation-diff';
import type { Duration } from './types';
import type { ResourceMetadata } from '../api/resource-metadata/resource-metadata';
export type { ResourceMetadata } from '../api/resource-metadata/resource-metadata';

/**
 * A resource affected by a change
 */
export interface AffectedResource {
  /**
   * The logical ID of the affected resource in the template
   */
  readonly logicalId: string;
  /**
   * The CloudFormation type of the resource
   * This could be a custom type.
   */
  readonly resourceType: string;
  /**
   * The friendly description of the affected resource
   */
  readonly description?: string;
  /**
   * The physical name of the resource when deployed.
   *
   * A physical name is not always available, e.g. new resources will not have one until after the deployment
   */
  readonly physicalName?: string;
  /**
   * Resource metadata attached to the logical id from the cloud assembly
   *
   * This is only present if the resource is present in the current Cloud Assembly,
   * i.e. resource deletions will not have metadata.
   */
  readonly metadata?: ResourceMetadata;
}

/**
 * Represents a change in a resource
 */
export interface ResourceChange {
  /**
   * The logical ID of the resource which is being changed
   */
  readonly logicalId: string;
  /**
   * The value the resource is being updated from
   */
  readonly oldValue: Resource;
  /**
   * The value the resource is being updated to
   */
  readonly newValue: Resource;
  /**
   * The changes made to the resource properties
   */
  readonly propertyUpdates: Record<string, PropertyDifference<unknown>>;
  /**
   * Resource metadata attached to the logical id from the cloud assembly
   *
   * This is only present if the resource is present in the current Cloud Assembly,
   * i.e. resource deletions will not have metadata.
   */
  readonly metadata?: ResourceMetadata;
}

/**
 * A change that can be hotswapped
 */
export interface HotswappableChange {
  /**
   * The resource change that is causing the hotswap.
   */
  readonly cause: ResourceChange;
  /**
   * A list of resources that are being hotswapped as part of the change
   */
  readonly resources: AffectedResource[];
}

export enum NonHotswappableReason {
  /**
   * Tags are not hotswappable
   */
  TAGS = 'tags',
  /**
   * Changed resource properties are not hotswappable on this resource type
   */
  PROPERTIES = 'properties',
  /**
   * A stack output has changed
   */
  OUTPUT = 'output',
  /**
   * A dependant resource is not hotswappable
   */
  DEPENDENCY_UNSUPPORTED = 'dependency-unsupported',
  /**
   * The resource type is not hotswappable
   */
  RESOURCE_UNSUPPORTED = 'resource-unsupported',
  /**
   * The resource is created in the deployment
   */
  RESOURCE_CREATION = 'resource-creation',
  /**
   * The resource is removed in the deployment
   */
  RESOURCE_DELETION = 'resource-deletion',
  /**
   * The resource identified by the logical id has its type changed
   */
  RESOURCE_TYPE_CHANGED = 'resource-type-changed',
  /**
   * The nested stack is created in the deployment
   */
  NESTED_STACK_CREATION = 'nested-stack-creation',
}

export interface RejectionSubject {
  /**
   * The type of the rejection subject, e.g. Resource or Output
   */
  readonly type: string;

  /**
   * The logical ID of the change that is not hotswappable
   */
  readonly logicalId: string;
  /**
   * Resource metadata attached to the logical id from the cloud assembly
   *
   * This is only present if the resource is present in the current Cloud Assembly,
   * i.e. resource deletions will not have metadata.
   */
  readonly metadata?: ResourceMetadata;
}

export interface ResourceSubject extends RejectionSubject {
  /**
   * A rejected resource
   */
  readonly type: 'Resource';
  /**
   * The type of the rejected resource
   */
  readonly resourceType: string;
  /**
   * The list of properties that are cause for the rejection
   */
  readonly rejectedProperties?: string[];
}

export interface OutputSubject extends RejectionSubject {
  /**
   * A rejected output
   */
  readonly type: 'Output';
}

/**
 * A change that can not be hotswapped
 */
export interface NonHotswappableChange {
  /**
   * The subject of the change that was rejected
   */
  readonly subject: ResourceSubject | OutputSubject;
  /**
   * Why was this change was deemed non-hotswappable
   */
  readonly reason: NonHotswappableReason;
  /**
   * Tells the user exactly why this change was deemed non-hotswappable and what its logical ID is.
   * If not specified, `displayReason` default to state that the properties listed in `rejectedChanges` are not hotswappable.
   */
  readonly description: string;
}

export interface HotswapDeploymentAttempt {
  /**
   * The stack that's currently being deployed
   */
  readonly stack: cxapi.CloudFormationStackArtifact;

  /**
   * The mode the hotswap deployment was initiated with.
   */
  readonly mode: 'hotswap-only' | 'fall-back';
}

/**
 * Information about a hotswap deployment
 */
export interface HotswapDeploymentDetails {
  /**
   * The stack that's currently being deployed
   */
  readonly stack: cxapi.CloudFormationStackArtifact;

  /**
   * The mode the hotswap deployment was initiated with.
   */
  readonly mode: 'hotswap-only' | 'fall-back';
  /**
   * The changes that were deemed hotswappable
   */
  readonly hotswappableChanges: HotswappableChange[];
  /**
   * The changes that were deemed not hotswappable
   */
  readonly nonHotswappableChanges: NonHotswappableChange[];
}

/**
 * The result of an attempted hotswap deployment
 */
export interface HotswapResult extends Duration, HotswapDeploymentDetails {
  /**
   * Whether hotswapping happened or not.
   *
   * `false` indicates that the deployment could not be hotswapped and full deployment may be attempted as fallback.
   */
  readonly hotswapped: boolean;
}
