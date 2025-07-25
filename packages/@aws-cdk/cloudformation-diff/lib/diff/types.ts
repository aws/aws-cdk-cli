import { AssertionError } from 'assert';
import type { Resource as ResourceModel } from '@aws-cdk/service-spec-types';
import { PropertyScrutinyType, ResourceScrutinyType } from '@aws-cdk/service-spec-types';
import { deepEqual, loadResourceModel } from './util';
import { IamChanges } from '../iam/iam-changes';
import { SecurityGroupChanges } from '../network/security-group-changes';

export type PropertyMap = { [key: string]: any };

export type ChangeSetResources = { [logicalId: string]: ChangeSetResource };

/**
 * @param beforeContext - is the BeforeContext field from the ChangeSet.ResourceChange.BeforeContext. This is the part of the CloudFormation template
 * that defines what the resource is before the change is applied; that is, BeforeContext is CloudFormationTemplate.Resources[LogicalId] before the ChangeSet is executed.
 *
 * @param afterContext - same as beforeContext but for after the change is made; that is, AfterContext is CloudFormationTemplate.Resources[LogicalId] after the ChangeSet is executed.
 *
 *  * Here is an example of what a beforeContext/afterContext looks like:
 *  '{"Properties":{"Value":"sdflkja","Type":"String","Name":"mySsmParameterFromStack"},"Metadata":{"aws:cdk:path":"cdk/mySsmParameter/Resource"}}'
 */
export interface ChangeSetResource {
  resourceWasReplaced: boolean;
  resourceType: string | undefined;
  propertyReplacementModes: PropertyReplacementModeMap | undefined;
}

export type PropertyReplacementModeMap = {
  [propertyName: string]: {
    replacementMode: ReplacementModes | undefined;
  };
};

/**
 * 'Always' means that changing the corresponding property will always cause a resource replacement. Never means never. Conditionally means maybe.
 */
export type ReplacementModes = 'Always' | 'Never' | 'Conditionally';

/** Semantic differences between two CloudFormation templates. */
export class TemplateDiff implements ITemplateDiff {
  public awsTemplateFormatVersion?: Difference<string>;
  public description?: Difference<string>;
  public transform?: Difference<string>;
  public conditions: DifferenceCollection<Condition, ConditionDifference>;
  public mappings: DifferenceCollection<Mapping, MappingDifference>;
  public metadata: DifferenceCollection<Metadata, MetadataDifference>;
  public outputs: DifferenceCollection<Output, OutputDifference>;
  public parameters: DifferenceCollection<Parameter, ParameterDifference>;
  public resources: DifferenceCollection<Resource, ResourceDifference>;
  /** The differences in unknown/unexpected parts of the template */
  public unknown: DifferenceCollection<any, Difference<any>>;

  /**
   * Changes to IAM policies
   */
  public readonly iamChanges: IamChanges;

  /**
   * Changes to Security Group ingress and egress rules
   */
  public readonly securityGroupChanges: SecurityGroupChanges;

  constructor(args: ITemplateDiff) {
    if (args.awsTemplateFormatVersion !== undefined) {
      this.awsTemplateFormatVersion = args.awsTemplateFormatVersion;
    }
    if (args.description !== undefined) {
      this.description = args.description;
    }
    if (args.transform !== undefined) {
      this.transform = args.transform;
    }

    this.conditions = args.conditions || new DifferenceCollection({});
    this.mappings = args.mappings || new DifferenceCollection({});
    this.metadata = args.metadata || new DifferenceCollection({});
    this.outputs = args.outputs || new DifferenceCollection({});
    this.parameters = args.parameters || new DifferenceCollection({});
    this.resources = args.resources || new DifferenceCollection({});
    this.unknown = args.unknown || new DifferenceCollection({});

    this.iamChanges = new IamChanges({
      propertyChanges: this.scrutinizablePropertyChanges(IamChanges.IamPropertyScrutinies),
      resourceChanges: this.scrutinizableResourceChanges(IamChanges.IamResourceScrutinies),
    });

    this.securityGroupChanges = new SecurityGroupChanges({
      egressRulePropertyChanges: this.scrutinizablePropertyChanges([PropertyScrutinyType.EgressRules]),
      ingressRulePropertyChanges: this.scrutinizablePropertyChanges([PropertyScrutinyType.IngressRules]),
      egressRuleResourceChanges: this.scrutinizableResourceChanges([ResourceScrutinyType.EgressRuleResource]),
      ingressRuleResourceChanges: this.scrutinizableResourceChanges([ResourceScrutinyType.IngressRuleResource]),
    });
  }

  public get differenceCount() {
    let count = 0;

    if (this.awsTemplateFormatVersion !== undefined) {
      count += 1;
    }
    if (this.description !== undefined) {
      count += 1;
    }
    if (this.transform !== undefined) {
      count += 1;
    }

    count += this.conditions.differenceCount;
    count += this.mappings.differenceCount;
    count += this.metadata.differenceCount;
    count += this.outputs.differenceCount;
    count += this.parameters.differenceCount;
    count += this.resources.differenceCount;
    count += this.unknown.differenceCount;

    return count;
  }

  public get isEmpty(): boolean {
    return this.differenceCount === 0;
  }

  /**
   * Return true if any of the permissions objects involve a broadening of permissions
   */
  public get permissionsBroadened(): boolean {
    return this.iamChanges.permissionsBroadened || this.securityGroupChanges.rulesAdded;
  }

  /**
   * Return true if any of the permissions objects have changed
   */
  public get permissionsAnyChanges(): boolean {
    return this.iamChanges.hasChanges || this.securityGroupChanges.hasChanges;
  }

  /**
   * Return all property changes of a given scrutiny type
   *
   * We don't just look at property updates; we also look at resource additions and deletions (in which
   * case there is no further detail on property values), and resource type changes.
   */
  private scrutinizablePropertyChanges(scrutinyTypes: PropertyScrutinyType[]): PropertyChange[] {
    const ret = new Array<PropertyChange>();

    for (const [resourceLogicalId, resourceChange] of Object.entries(this.resources.changes)) {
      if (resourceChange.resourceTypeChanged) {
        // we ignore resource type changes here, and handle them in scrutinizableResourceChanges()
        continue;
      }

      if (!resourceChange.resourceType) {
        // We use resourceChange.resourceType to loadResourceModel so that we can inspect the
        // properties of a resource even after the resource is removed from the template.
        continue;
      }

      const newTypeProps = loadResourceModel(resourceChange.resourceType)?.properties || {};
      for (const [propertyName, prop] of Object.entries(newTypeProps)) {
        const propScrutinyType = prop.scrutinizable || PropertyScrutinyType.None;
        if (scrutinyTypes.includes(propScrutinyType)) {
          ret.push({
            resourceLogicalId,
            propertyName,
            resourceType: resourceChange.resourceType,
            scrutinyType: propScrutinyType,
            oldValue: resourceChange.oldProperties?.[propertyName],
            newValue: resourceChange.newProperties?.[propertyName],
          });
        }
      }
    }

    return ret;
  }

  /**
   * Return all resource changes of a given scrutiny type
   *
   * We don't just look at resource updates; we also look at resource additions and deletions (in which
   * case there is no further detail on property values), and resource type changes.
   */
  private scrutinizableResourceChanges(scrutinyTypes: ResourceScrutinyType[]): ResourceChange[] {
    const ret = new Array<ResourceChange>();

    for (const [resourceLogicalId, resourceChange] of Object.entries(this.resources.changes)) {
      if (!resourceChange) {
        continue;
      }

      const commonProps = {
        oldProperties: resourceChange.oldProperties,
        newProperties: resourceChange.newProperties,
        resourceLogicalId,
      };

      // changes to the Type of resources can happen when migrating from CFN templates that use Transforms
      if (resourceChange.resourceTypeChanged) {
        // Treat as DELETE+ADD
        if (resourceChange.oldResourceType) {
          const oldResourceModel = loadResourceModel(resourceChange.oldResourceType);
          if (oldResourceModel && this.resourceIsScrutinizable(oldResourceModel, scrutinyTypes)) {
            ret.push({
              ...commonProps,
              newProperties: undefined,
              resourceType: resourceChange.oldResourceType!,
              scrutinyType: oldResourceModel.scrutinizable!,
            });
          }
        }

        if (resourceChange.newResourceType) {
          const newResourceModel = loadResourceModel(resourceChange.newResourceType);
          if (newResourceModel && this.resourceIsScrutinizable(newResourceModel, scrutinyTypes)) {
            ret.push({
              ...commonProps,
              oldProperties: undefined,
              resourceType: resourceChange.newResourceType!,
              scrutinyType: newResourceModel.scrutinizable!,
            });
          }
        }
      } else {
        if (!resourceChange.resourceType) {
          continue;
        }

        const resourceModel = loadResourceModel(resourceChange.resourceType);
        if (resourceModel && this.resourceIsScrutinizable(resourceModel, scrutinyTypes)) {
          ret.push({
            ...commonProps,
            resourceType: resourceChange.resourceType,
            scrutinyType: resourceModel.scrutinizable!,
          });
        }
      }
    }

    return ret;
  }

  private resourceIsScrutinizable(res: ResourceModel, scrutinyTypes: Array<ResourceScrutinyType>): boolean {
    return scrutinyTypes.includes(res.scrutinizable || ResourceScrutinyType.None);
  }
}

/**
 * A change in property values
 *
 * Not necessarily an update, it could be that there used to be no value there
 * because there was no resource, and now there is (or vice versa).
 *
 * Therefore, we just contain plain values and not a PropertyDifference<any>.
 */
export interface PropertyChange {
  /**
   * Logical ID of the resource where this property change was found
   */
  resourceLogicalId: string;

  /**
   * Type of the resource
   */
  resourceType: string;

  /**
   * Scrutiny type for this property change
   */
  scrutinyType: PropertyScrutinyType;

  /**
   * Name of the property that is changing
   */
  propertyName: string;

  /**
   * The old property value
   */
  oldValue?: any;

  /**
   * The new property value
   */
  newValue?: any;
}

/**
 * A resource change
 *
 * Either a creation, deletion or update.
 */
export interface ResourceChange {
  /**
   * Logical ID of the resource where this property change was found
   */
  resourceLogicalId: string;

  /**
   * Scrutiny type for this resource change
   */
  scrutinyType: ResourceScrutinyType;

  /**
   * The type of the resource
   */
  resourceType: string;

  /**
   * The old properties value (might be undefined in case of creation)
   */
  oldProperties?: PropertyMap;

  /**
   * The new properties value (might be undefined in case of deletion)
   */
  newProperties?: PropertyMap;
}

export interface IDifference<ValueType> {
  readonly oldValue: ValueType | undefined;
  readonly newValue: ValueType | undefined;
  readonly isDifferent: boolean;
  readonly isAddition: boolean;
  readonly isRemoval: boolean;
  readonly isUpdate: boolean;
}

/**
 * Models an entity that changed between two versions of a CloudFormation template.
 */
export class Difference<ValueType> implements IDifference<ValueType> {
  /**
   * Whether this is an actual different or the values are actually the same
   *
   * isDifferent => (isUpdate | isRemoved | isUpdate)
   */
  public isDifferent: boolean;

  /**
   * @param oldValue - the old value, cannot be equal (to the sense of +deepEqual+) to +newValue+.
   * @param newValue - the new value, cannot be equal (to the sense of +deepEqual+) to +oldValue+.
   */
  constructor(public readonly oldValue: ValueType | undefined, public readonly newValue: ValueType | undefined) {
    if (oldValue === undefined && newValue === undefined) {
      throw new AssertionError({ message: 'oldValue and newValue are both undefined!' });
    }
    this.isDifferent = !deepEqual(oldValue, newValue);
  }

  /** @returns +true+ if the element is new to the template. */
  public get isAddition(): boolean {
    return this.oldValue === undefined;
  }

  /** @returns +true+ if the element was removed from the template. */
  public get isRemoval(): boolean {
    return this.newValue === undefined;
  }

  /** @returns +true+ if the element was already in the template and is updated. */
  public get isUpdate(): boolean {
    return this.oldValue !== undefined
      && this.newValue !== undefined;
  }
}

export class PropertyDifference<ValueType> extends Difference<ValueType> {
  public changeImpact?: ResourceImpact;

  constructor(oldValue: ValueType | undefined, newValue: ValueType | undefined, args: { changeImpact?: ResourceImpact }) {
    super(oldValue, newValue);
    this.changeImpact = args.changeImpact;
  }
}

export class DifferenceCollection<V, T extends IDifference<V>> {
  constructor(private readonly diffs: { [logicalId: string]: T }) {
  }

  public get changes(): { [logicalId: string]: T } {
    return onlyChanges(this.diffs);
  }

  public get differenceCount(): number {
    return Object.values(this.changes).length;
  }

  public get(logicalId: string): T {
    const ret = this.diffs[logicalId];
    if (!ret) {
      throw new Error(`No object with logical ID '${logicalId}'`);
    }
    return ret;
  }

  public remove(logicalId: string): void {
    delete this.diffs[logicalId];
  }

  public get logicalIds(): string[] {
    return Object.keys(this.changes);
  }

  /**
   * Returns a new TemplateDiff which only contains changes for which `predicate`
   * returns `true`.
   */
  public filter(predicate: (diff: T | undefined) => boolean): DifferenceCollection<V, T> {
    const newChanges: { [logicalId: string]: T } = { };
    for (const id of Object.keys(this.changes)) {
      const diff = this.changes[id];

      if (predicate(diff)) {
        newChanges[id] = diff;
      }
    }

    return new DifferenceCollection<V, T>(newChanges);
  }

  /**
   * Invokes `cb` for all changes in this collection.
   *
   * Changes will be sorted as follows:
   *  - Removed
   *  - Added
   *  - Updated
   *  - Others
   *
   */
  public forEachDifference(cb: (logicalId: string, change: T) => any): void {
    const removed = new Array<{ logicalId: string; change: T }>();
    const added = new Array<{ logicalId: string; change: T }>();
    const updated = new Array<{ logicalId: string; change: T }>();
    const others = new Array<{ logicalId: string; change: T }>();

    for (const logicalId of this.logicalIds) {
      const change: T = this.changes[logicalId]!;
      if (change.isAddition) {
        added.push({ logicalId, change });
      } else if (change.isRemoval) {
        removed.push({ logicalId, change });
      } else if (change.isUpdate) {
        updated.push({ logicalId, change });
      } else if (change.isDifferent) {
        others.push({ logicalId, change });
      }
    }

    removed.forEach(v => cb(v.logicalId, v.change));
    added.forEach(v => cb(v.logicalId, v.change));
    updated.forEach(v => cb(v.logicalId, v.change));
    others.forEach(v => cb(v.logicalId, v.change));
  }
}

/**
 * Arguments expected by the constructor of +TemplateDiff+, extracted as an interface for the sake
 * of (relative) conciseness of the constructor's signature.
 */
export interface ITemplateDiff {
  awsTemplateFormatVersion?: IDifference<string>;
  description?: IDifference<string>;
  transform?: IDifference<string>;

  conditions?: DifferenceCollection<Condition, ConditionDifference>;
  mappings?: DifferenceCollection<Mapping, MappingDifference>;
  metadata?: DifferenceCollection<Metadata, MetadataDifference>;
  outputs?: DifferenceCollection<Output, OutputDifference>;
  parameters?: DifferenceCollection<Parameter, ParameterDifference>;
  resources?: DifferenceCollection<Resource, ResourceDifference>;

  unknown?: DifferenceCollection<any, IDifference<any>>;
}

export type Condition = any;
export class ConditionDifference extends Difference<Condition> {
  // TODO: define specific difference attributes
}

export type Mapping = any;
export class MappingDifference extends Difference<Mapping> {
  // TODO: define specific difference attributes
}

export type Metadata = any;
export class MetadataDifference extends Difference<Metadata> {
  // TODO: define specific difference attributes
}

export type Output = any;
export class OutputDifference extends Difference<Output> {
  // TODO: define specific difference attributes
}

export type Parameter = any;
export class ParameterDifference extends Difference<Parameter> {
  // TODO: define specific difference attributes
}

export enum ResourceImpact {
  /** The existing physical resource will be updated */
  WILL_UPDATE = 'WILL_UPDATE',
  /** A new physical resource will be created */
  WILL_CREATE = 'WILL_CREATE',
  /** The existing physical resource will be replaced */
  WILL_REPLACE = 'WILL_REPLACE',
  /** The existing physical resource may be replaced */
  MAY_REPLACE = 'MAY_REPLACE',
  /** The existing physical resource will be destroyed */
  WILL_DESTROY = 'WILL_DESTROY',
  /** The existing physical resource will be removed from CloudFormation supervision */
  WILL_ORPHAN = 'WILL_ORPHAN',
  /** The existing physical resource will be added to CloudFormation supervision */
  WILL_IMPORT = 'WILL_IMPORT',
  /** There is no change in this resource */
  NO_CHANGE = 'NO_CHANGE',
}

/**
 * This function can be used as a reducer to obtain the resource-level impact of a list
 * of property-level impacts.
 * @param one - the current worst impact so far.
 * @param two - the new impact being considered (can be undefined, as we may not always be
 *      able to determine some properties impact).
 */
function worstImpact(one: ResourceImpact, two?: ResourceImpact): ResourceImpact {
  if (!two) {
    return one;
  }
  const badness = {
    [ResourceImpact.NO_CHANGE]: 0,
    [ResourceImpact.WILL_IMPORT]: 0,
    [ResourceImpact.WILL_UPDATE]: 1,
    [ResourceImpact.WILL_CREATE]: 2,
    [ResourceImpact.WILL_ORPHAN]: 3,
    [ResourceImpact.MAY_REPLACE]: 4,
    [ResourceImpact.WILL_REPLACE]: 5,
    [ResourceImpact.WILL_DESTROY]: 6,
  };
  return badness[one] > badness[two] ? one : two;
}

export interface Resource {
  Type: string;
  Properties?: { [name: string]: any };

  [key: string]: any;
}

export interface Move {
  readonly direction: 'from' | 'to';
  readonly stackName: string;
  readonly resourceLogicalId: string;
}

/**
 * Change to a single resource between two CloudFormation templates
 *
 * This class can be mutated after construction.
 */
export class ResourceDifference implements IDifference<Resource> {
  /**
   * Whether this resource was added
   */
  public readonly isAddition: boolean;

  /**
   * Whether this resource was removed
   */
  public readonly isRemoval: boolean;

  /**
   * Whether this resource was imported
   */
  public isImport?: boolean;

  public move?: Move;

  /** Property-level changes on the resource */
  private readonly propertyDiffs: { [key: string]: PropertyDifference<any> };

  /** Changes to non-property level attributes of the resource */
  private readonly otherDiffs: { [key: string]: Difference<any> };

  /** The resource type (or old and new type if it has changed) */
  private readonly resourceTypes: { readonly oldType?: string; readonly newType?: string };

  constructor(
    public readonly oldValue: Resource | undefined,
    public readonly newValue: Resource | undefined,
    args: {
      resourceType: { oldType?: string; newType?: string };
      propertyDiffs: { [key: string]: PropertyDifference<any> };
      otherDiffs: { [key: string]: Difference<any> };
    },
  ) {
    this.resourceTypes = args.resourceType;
    this.propertyDiffs = args.propertyDiffs;
    this.otherDiffs = args.otherDiffs;

    this.isAddition = oldValue === undefined;
    this.isRemoval = newValue === undefined;
    this.isImport = undefined;
  }

  public get oldProperties(): PropertyMap | undefined {
    return this.oldValue && this.oldValue.Properties;
  }

  public get newProperties(): PropertyMap | undefined {
    return this.newValue && this.newValue.Properties;
  }

  /**
   * Whether this resource was modified at all
   */
  public get isDifferent(): boolean {
    return this.differenceCount > 0 || this.oldResourceType !== this.newResourceType;
  }

  /**
   * Whether the resource was updated in-place
   */
  public get isUpdate(): boolean {
    return this.isDifferent && !this.isAddition && !this.isRemoval;
  }

  public get oldResourceType(): string | undefined {
    return this.resourceTypes.oldType;
  }

  public get newResourceType(): string | undefined {
    return this.resourceTypes.newType;
  }

  /**
   * All actual property updates
   */
  public get propertyUpdates(): { [key: string]: PropertyDifference<any> } {
    return onlyChanges(this.propertyDiffs);
  }

  /**
   * All actual "other" updates
   */
  public get otherChanges(): { [key: string]: Difference<any> } {
    return onlyChanges(this.otherDiffs);
  }

  /**
   * Return whether the resource type was changed in this diff
   *
   * This is not a valid operation in CloudFormation but to be defensive we're going
   * to be aware of it anyway.
   */
  public get resourceTypeChanged(): boolean {
    return (this.resourceTypes.oldType !== undefined
        && this.resourceTypes.newType !== undefined
        && this.resourceTypes.oldType !== this.resourceTypes.newType);
  }

  /**
   * Return the resource type if it was unchanged
   *
   * If the resource type was changed, it's an error to call this.
   */
  public get resourceType(): string | undefined {
    if (this.resourceTypeChanged) {
      throw new Error('Cannot get .resourceType, because the type was changed');
    }
    return this.resourceTypes.oldType || this.resourceTypes.newType;
  }

  /**
   * Replace a PropertyChange in this object
   *
   * This affects the property diff as it is summarized to users, but it DOES
   * NOT affect either the "oldValue" or "newValue" values; those still contain
   * the actual template values as provided by the user (they might still be
   * used for downstream processing).
   */
  public setPropertyChange(propertyName: string, change: PropertyDifference<any>) {
    this.propertyDiffs[propertyName] = change;
  }

  /**
   * Replace a OtherChange in this object
   *
   * This affects the property diff as it is summarized to users, but it DOES
   * NOT affect either the "oldValue" or "newValue" values; those still contain
   * the actual template values as provided by the user (they might still be
   * used for downstream processing).
   */
  public setOtherChange(otherName: string, change: PropertyDifference<any>) {
    this.otherDiffs[otherName] = change;
  }

  public get changeImpact(): ResourceImpact {
    if (this.isImport) {
      return ResourceImpact.WILL_IMPORT;
    }
    // Check the Type first
    if (this.resourceTypes.oldType !== this.resourceTypes.newType) {
      if (this.resourceTypes.oldType === undefined) {
        return ResourceImpact.WILL_CREATE;
      }
      if (this.resourceTypes.newType === undefined) {
        return this.oldValue!.DeletionPolicy === 'Retain'
          ? ResourceImpact.WILL_ORPHAN
          : ResourceImpact.WILL_DESTROY;
      }
      return ResourceImpact.WILL_REPLACE;
    }

    // Base impact (before we mix in the worst of the property impacts);
    // WILL_UPDATE if we have "other" changes, NO_CHANGE if there are no "other" changes.
    const baseImpact = Object.keys(this.otherChanges).length > 0 ? ResourceImpact.WILL_UPDATE : ResourceImpact.NO_CHANGE;

    return Object.values(this.propertyDiffs)
      .map(elt => elt.changeImpact)
      .reduce(worstImpact, baseImpact);
  }

  /**
   * Count of actual differences (not of elements)
   */
  public get differenceCount(): number {
    return Object.values(this.propertyUpdates).length
      + Object.values(this.otherChanges).length;
  }

  /**
   * Invoke a callback for each actual difference
   */
  public forEachDifference(cb: (type: 'Property' | 'Other', name: string, value: Difference<any> | PropertyDifference<any>) => any) {
    for (const key of Object.keys(this.propertyUpdates).sort()) {
      cb('Property', key, this.propertyUpdates[key]);
    }
    for (const key of Object.keys(this.otherChanges).sort()) {
      cb('Other', key, this.otherDiffs[key]);
    }
  }
}

export function isPropertyDifference<T>(diff: Difference<T>): diff is PropertyDifference<T> {
  return (diff as PropertyDifference<T>).changeImpact !== undefined;
}

/**
 * Filter a map of IDifferences down to only retain the actual changes
 */
function onlyChanges<V, T extends IDifference<V>>(xs: { [key: string]: T }): { [key: string]: T } {
  const ret: { [key: string]: T } = {};
  for (const [key, diff] of Object.entries(xs)) {
    if (diff.isDifferent) {
      ret[key] = diff;
    }
  }
  return ret;
}
