import type { PropertyDifference, Resource } from '@aws-cdk/cloudformation-diff';

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

export interface HotswappableChange {
  /**
   * The resource change that is causing the hotswap.
   */
  readonly cause: ResourceChange;
}
