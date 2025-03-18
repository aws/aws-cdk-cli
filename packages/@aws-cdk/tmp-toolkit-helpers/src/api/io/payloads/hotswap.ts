import type { PropertyDifference, Resource } from '@aws-cdk/cloudformation-diff';
import type * as cxapi from '@aws-cdk/cx-api';
import type { ResourceMetadata } from '../../resource-metadata/resource-metadata';

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

/**
 * Information about a hotswap deployment
 */
export interface HotswapDeployment {
  /**
   * The stack that's currently being deployed
   */
  readonly stack: cxapi.CloudFormationStackArtifact;

  /**
   * The mode the hotswap deployment was initiated with.
   */
  readonly mode: 'hotswap-only' | 'fall-back';
}
