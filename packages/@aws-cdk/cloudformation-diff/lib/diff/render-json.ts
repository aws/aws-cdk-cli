import type { IamChangesJson } from '../iam/iam-changes';
import type { SecurityGroupChangesJson } from '../network/security-group-changes';
import { deepRemoveUndefined } from '../util';
import type { Difference, Move, PropertyDifference, ResourceImpact, TemplateDiff } from './types';

/**
 * A machine-readable rendering of a single value difference
 */
export interface DifferenceJson {
  /**
   * The old value, if any
   */
  readonly oldValue?: any;

  /**
   * The new value, if any
   */
  readonly newValue?: any;
}

/**
 * A machine-readable rendering of a single property difference of a resource
 */
export interface PropertyDifferenceJson extends DifferenceJson {
  /**
   * The impact this property change has on the resource
   */
  readonly changeImpact?: ResourceImpact;
}

/**
 * A machine-readable rendering of a single resource difference
 */
export interface ResourceDifferenceJson {
  /**
   * The resource type before the change, if the resource existed before
   */
  readonly oldResourceType?: string;

  /**
   * The resource type after the change, if the resource still exists
   */
  readonly newResourceType?: string;

  /**
   * The impact this change has on the physical resource
   */
  readonly changeImpact: ResourceImpact;

  /**
   * Whether the resource is newly added to the template
   */
  readonly isAddition: boolean;

  /**
   * Whether the resource is removed from the template
   */
  readonly isRemoval: boolean;

  /**
   * Whether the resource is imported rather than created
   */
  readonly isImport?: boolean;

  /**
   * If this resource was moved from or to another stack, details about the move
   */
  readonly move?: Move;

  /**
   * Changes to the resource's properties, keyed by property name
   */
  readonly propertyDiffs?: { [propertyName: string]: PropertyDifferenceJson };

  /**
   * Changes to non-property attributes of the resource (e.g. Metadata, DependsOn), keyed by attribute name
   */
  readonly otherDiffs?: { [key: string]: DifferenceJson };
}

/**
 * A machine-readable rendering of a template diff
 */
export interface TemplateDiffJson {
  /**
   * Change to the AWSTemplateFormatVersion field
   */
  readonly awsTemplateFormatVersion?: DifferenceJson;

  /**
   * Change to the template Description
   */
  readonly description?: DifferenceJson;

  /**
   * Change to the template Transform
   */
  readonly transform?: DifferenceJson;

  /**
   * Changes to resources, keyed by logical ID
   */
  readonly resources?: { [logicalId: string]: ResourceDifferenceJson };

  /**
   * Changes to parameters, keyed by logical ID
   */
  readonly parameters?: { [logicalId: string]: DifferenceJson };

  /**
   * Changes to outputs, keyed by logical ID
   */
  readonly outputs?: { [logicalId: string]: DifferenceJson };

  /**
   * Changes to conditions, keyed by logical ID
   */
  readonly conditions?: { [logicalId: string]: DifferenceJson };

  /**
   * Changes to mappings, keyed by logical ID
   */
  readonly mappings?: { [logicalId: string]: DifferenceJson };

  /**
   * Changes to template metadata, keyed by logical ID
   */
  readonly metadata?: { [logicalId: string]: DifferenceJson };

  /**
   * Changes to unclassified template elements
   */
  readonly unknown?: { [logicalId: string]: DifferenceJson };

  /**
   * IAM policy changes contained in this diff
   */
  readonly iamChanges?: IamChangesJson;

  /**
   * Security group rule changes contained in this diff
   */
  readonly securityGroupChanges?: SecurityGroupChangesJson;

  /**
   * Whether IAM permissions or security group rules are broadened by this diff
   */
  readonly permissionsBroadened: boolean;

  /**
   * The number of differences in this diff
   */
  readonly differenceCount: number;
}

/**
 * Render a TemplateDiff to a plain JSON-serializable object.
 *
 * Contains the full structural diff of the template, plus dedicated
 * sections for IAM policy changes and security group rule changes.
 */
export function templateDiffToJson(templateDiff: TemplateDiff): TemplateDiffJson {
  const resources: { [logicalId: string]: ResourceDifferenceJson } = {};
  templateDiff.resources.forEachDifference((logicalId, change) => {
    const propertyDiffs: { [propertyName: string]: PropertyDifferenceJson } = {};
    const otherDiffs: { [key: string]: DifferenceJson } = {};
    change.forEachDifference((type, name, diff) => {
      if (type === 'Property') {
        propertyDiffs[name] = propertyDifferenceToJson(diff as PropertyDifference<any>);
      } else {
        otherDiffs[name] = differenceToJson(diff);
      }
    });

    resources[logicalId] = {
      oldResourceType: change.oldResourceType,
      newResourceType: change.newResourceType,
      changeImpact: change.changeImpact,
      isAddition: change.isAddition,
      isRemoval: change.isRemoval,
      isImport: change.isImport,
      move: change.move,
      propertyDiffs: dropIfEmptyObject(propertyDiffs),
      otherDiffs: dropIfEmptyObject(otherDiffs),
    };
  });

  return deepRemoveUndefined({
    awsTemplateFormatVersion: optionalDifferenceToJson(templateDiff.awsTemplateFormatVersion),
    description: optionalDifferenceToJson(templateDiff.description),
    transform: optionalDifferenceToJson(templateDiff.transform),
    resources: dropIfEmptyObject(resources),
    parameters: differenceCollectionToJson(templateDiff.parameters),
    outputs: differenceCollectionToJson(templateDiff.outputs),
    conditions: differenceCollectionToJson(templateDiff.conditions),
    mappings: differenceCollectionToJson(templateDiff.mappings),
    metadata: differenceCollectionToJson(templateDiff.metadata),
    unknown: differenceCollectionToJson(templateDiff.unknown),
    iamChanges: templateDiff.iamChanges.hasChanges ? templateDiff.iamChanges._toJson() : undefined,
    securityGroupChanges: templateDiff.securityGroupChanges.hasChanges ? templateDiff.securityGroupChanges.toJson() : undefined,
    permissionsBroadened: templateDiff.permissionsBroadened,
    differenceCount: templateDiff.differenceCount,
  });
}

function differenceCollectionToJson(
  collection: { forEachDifference: (cb: (logicalId: string, change: Difference<any>) => any) => void } | undefined,
): { [logicalId: string]: DifferenceJson } | undefined {
  if (!collection) {
    return undefined;
  }
  const ret: { [logicalId: string]: DifferenceJson } = {};
  collection.forEachDifference((logicalId, change) => {
    ret[logicalId] = differenceToJson(change);
  });
  return dropIfEmptyObject(ret);
}

function optionalDifferenceToJson(difference?: Difference<any>): DifferenceJson | undefined {
  return difference?.isDifferent ? differenceToJson(difference) : undefined;
}

function differenceToJson(difference: Difference<any>): DifferenceJson {
  return {
    oldValue: difference.oldValue,
    newValue: difference.newValue,
  };
}

function propertyDifferenceToJson(difference: PropertyDifference<any>): PropertyDifferenceJson {
  return {
    ...differenceToJson(difference),
    changeImpact: difference.changeImpact,
  };
}

function dropIfEmptyObject<T extends object>(x: T): T | undefined {
  return Object.keys(x).length > 0 ? x : undefined;
}
