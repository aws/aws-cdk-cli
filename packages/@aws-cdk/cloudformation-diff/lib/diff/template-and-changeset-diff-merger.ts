// The SDK is only used to reference `DescribeChangeSetOutput`, so the SDK is added as a devDependency.
// The SDK should not make network calls here
import type { DescribeChangeSetOutput as DescribeChangeSet, ResourceChange as RC, ResourceChangeDetail as RCD } from '@aws-sdk/client-cloudformation';
import { diffResource } from '../diff';
import * as types from '../diff/types';

export type DescribeChangeSetOutput = DescribeChangeSet;
type ChangeSetResourceChangeDetail = RCD;
type ChangeSetResourceChange = RC;

interface TemplateAndChangeSetDiffMergerOptions {
  /*
   * Only specifiable for testing. Otherwise, this is the datastructure that the changeSet is converted into so
   * that we only pay attention to the subset of changeSet properties that are relevant for computing the diff.
   *
   * @default - the changeSet is converted into this datastructure.
  */
  readonly changeSetResources?: types.ChangeSetResources;
}

export interface TemplateAndChangeSetDiffMergerProps extends TemplateAndChangeSetDiffMergerOptions {
  /*
   * The changeset that will be read and merged into the template diff.
  */
  readonly changeSet: DescribeChangeSetOutput;
}

/**
 * The purpose of this class is to include differences from the ChangeSet to differences in the TemplateDiff.
 */
export class TemplateAndChangeSetDiffMerger {
  public static determineChangeSetReplacementMode(propertyChange: ChangeSetResourceChangeDetail): types.ReplacementModes {
    if (propertyChange.Target?.RequiresRecreation === undefined) {
      // We can't determine if the resource will be replaced or not. That's what conditionally means.
      return 'Conditionally';
    }

    if (propertyChange.Target.RequiresRecreation === 'Always') {
      switch (propertyChange.Evaluation) {
        case 'Static':
          return 'Always';
        case 'Dynamic':
          // If Evaluation is 'Dynamic', then this may cause replacement, or it may not.
          // see 'Replacement': https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ResourceChange.html
          return 'Conditionally';
      }
    }

    return propertyChange.Target.RequiresRecreation as types.ReplacementModes;
  }

  // If we somehow cannot find the resourceType, then we'll mark it as UNKNOWN, so that can be seen in the diff.
  private static UNKNOWN_RESOURCE_TYPE = 'UNKNOWN_RESOURCE_TYPE';

  public changeSet: DescribeChangeSetOutput | undefined;
  public changeSetResources: types.ChangeSetResources;

  constructor(props: TemplateAndChangeSetDiffMergerProps) {
    this.changeSet = props.changeSet;
    this.changeSetResources = props.changeSetResources ?? this.convertDescribeChangeSetOutputToChangeSetResources(this.changeSet);
  }

  /**
   * Read resources from the changeSet, extracting information into ChangeSetResources.
   */
  private convertDescribeChangeSetOutputToChangeSetResources(changeSet: DescribeChangeSetOutput): types.ChangeSetResources {
    const changeSetResources: types.ChangeSetResources = {};
    for (const resourceChange of changeSet.Changes ?? []) {
      if (resourceChange.ResourceChange?.LogicalResourceId === undefined) {
        continue; // Being defensive, here.
      }

      const propertyReplacementModes: types.PropertyReplacementModeMap = {};
      for (const propertyChange of resourceChange.ResourceChange.Details ?? []) { // Details is only included if resourceChange.Action === 'Modify'
        if (propertyChange.Target?.Attribute === 'Properties' && propertyChange.Target.Name) {
          propertyReplacementModes[propertyChange.Target.Name] = {
            replacementMode: TemplateAndChangeSetDiffMerger.determineChangeSetReplacementMode(propertyChange),
          };
        }
      }

      changeSetResources[resourceChange.ResourceChange.LogicalResourceId] = {
        resourceWasReplaced: resourceChange.ResourceChange.Replacement === 'True',
        resourceType: resourceChange.ResourceChange.ResourceType ?? TemplateAndChangeSetDiffMerger.UNKNOWN_RESOURCE_TYPE, // DescribeChangeSet doesn't promise to have the ResourceType...
        propertyReplacementModes: propertyReplacementModes,
      };
    }

    return changeSetResources;
  }

  /**
   * This is writing over the "ChangeImpact" that was computed from the template difference, and instead using the ChangeImpact that is included from the ChangeSet.
   * Using the ChangeSet ChangeImpact is more accurate. The ChangeImpact tells us what the consequence is of changing the field. If changing the field causes resource
   * replacement (e.g., changing the name of an IAM role requires deleting and replacing the role), then ChangeImpact is "Always".
   */
  public overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId: string, change: types.ResourceDifference) {
    // resourceType getter throws an error if resourceTypeChanged
    if ((change.resourceTypeChanged === true) || change.resourceType?.includes('AWS::Serverless')) {
      // CFN applies the SAM transform before creating the changeset, so the changeset contains no information about SAM resources
      return;
    }
    change.forEachDifference((type: 'Property' | 'Other', name: string, value: types.Difference<any> | types.PropertyDifference<any>) => {
      if (type === 'Property') {
        if (!this.changeSetResources[logicalId]) {
          (value as types.PropertyDifference<any>).changeImpact = types.ResourceImpact.NO_CHANGE;
          (value as types.PropertyDifference<any>).isDifferent = false;
          return;
        }

        const changingPropertyCausesResourceReplacement = (this.changeSetResources[logicalId].propertyReplacementModes ?? {})[name]?.replacementMode;
        switch (changingPropertyCausesResourceReplacement) {
          case 'Always':
            (value as types.PropertyDifference<any>).changeImpact = types.ResourceImpact.WILL_REPLACE;
            break;
          case 'Never':
            (value as types.PropertyDifference<any>).changeImpact = types.ResourceImpact.WILL_UPDATE;
            break;
          case 'Conditionally':
            (value as types.PropertyDifference<any>).changeImpact = types.ResourceImpact.MAY_REPLACE;
            break;
          case undefined:
            (value as types.PropertyDifference<any>).changeImpact = types.ResourceImpact.NO_CHANGE;
            (value as types.PropertyDifference<any>).isDifferent = false;
            break;
          // otherwise, defer to the changeImpact from the template diff
        }
      } else if (type === 'Other') {
        switch (name) {
          case 'Metadata':
            // we want to ignore metadata changes in the diff, so compare newValue against newValue.
            change.setOtherChange('Metadata', new types.Difference<string>(value.newValue, value.newValue));
            break;
        }
      }
    });
  }

  /**
   * Adds property changes that the change set reports for a resource that the template diff already
   * surfaced, but that the template diff did not pick up on its own.
   *
   * Without this, a resource that has an ordinary (textual) change to one property would hide a
   * second change to a *different* property that is only resolved at deploy time (e.g. a property
   * whose value comes from an SSM parameter or a CloudFormation dynamic reference). That hidden
   * change might even be a replacement, so silently dropping it is exactly the class of bug that
   * issue #641 is about - just on a resource that happens to also have a visible change.
   *
   * This complements `addChangeSetResourcesNotInTemplateDiff`, which handles resources that are
   * entirely absent from the template diff.
   *
   * @param logicalId - the logical ID of the resource (already present in the template diff)
   * @param change - the resource difference to augment (mutated in place)
   */
  public addChangeSetPropertiesNotInTemplateDiff(logicalId: string, change: types.ResourceDifference) {
    // Same guard as the impact-refinement path: the change set describes the post-transform
    // resource for SAM, so its property information does not line up with the template.
    // `resourceType` getter throws if the type changed, so check that first.
    if ((change.resourceTypeChanged === true) || change.resourceType?.includes('AWS::Serverless')) {
      return;
    }

    const propertyReplacementModes = this.changeSetResources[logicalId]?.propertyReplacementModes;
    if (!propertyReplacementModes) {
      return;
    }

    const resourceChange = this.findResourceChange(logicalId);

    for (const [propertyName, { replacementMode }] of Object.entries(propertyReplacementModes)) {
      // Properties the template diff already flagged are owned by the impact-refinement path.
      if (propertyName in change.propertyUpdates) {
        continue;
      }

      const changeImpact = changeImpactForReplacementMode(replacementMode);
      if (changeImpact === undefined) {
        // The change set does not actually consider this a (meaningful) change.
        continue;
      }

      const { oldValue, newValue } = this.changeSetPropertyValues(resourceChange, propertyName);
      const propertyDiff = new types.PropertyDifference<any>(oldValue, newValue, { changeImpact });
      propertyDiff.isDifferent = true;
      change.setPropertyChange(propertyName, propertyDiff);
    }
  }

  /**
   * Adds resources to the template diff that the change set reports as changing, but that the
   * template diff did not surface on its own.
   *
   * This happens when the local template is byte-for-byte identical between the current and
   * target state, yet a value that is only resolved at deploy time changes - for example an
   * SSM parameter referenced through `AWS::SSM::Parameter::Value<...>` or a CloudFormation
   * dynamic reference (`{{resolve:ssm:...}}`). CloudFormation detects these in the change set
   * even though a pure template diff cannot, so we synthesize a `ResourceDifference` from the
   * change set's before/after data.
   *
   * @param resourceDiffs - the resource differences to add to (mutated in place)
   * @param resourcesInTemplateDiff - the logical IDs that the template diff already reported as
   *   changed, captured *before* any change-set overrides were applied. Those resources are
   *   owned by the override path and are skipped here so we never clobber more accurate
   *   template-derived information with change-set-only data.
   */
  public addChangeSetResourcesNotInTemplateDiff(
    resourceDiffs: types.DifferenceCollection<types.Resource, types.ResourceDifference>,
    resourcesInTemplateDiff: Set<string>,
  ) {
    for (const resourceChange of this.changeSet?.Changes ?? []) {
      const rc = resourceChange.ResourceChange;
      const logicalId = rc?.LogicalResourceId;
      if (!rc || !logicalId) {
        continue;
      }

      // Additions, removals and imports are already reflected in the template diff (a new or
      // deleted resource shows up textually), or are handled by the dedicated import path. We
      // only need to synthesize changes for modifications that are invisible to a textual diff.
      if (rc.Action !== 'Modify') {
        continue;
      }

      // The template diff already produced a difference for this resource, so the override path
      // is responsible for it. Don't replace it with change-set-only data.
      if (resourcesInTemplateDiff.has(logicalId)) {
        continue;
      }

      // CFN applies the SAM transform before creating the changeset, so changeset entries for
      // SAM resources describe the transformed (e.g. Lambda) resource and won't line up with the
      // SAM resource in the template. Skip them to avoid rendering a bogus diff.
      if (rc.ResourceType?.includes('AWS::Serverless')) {
        continue;
      }

      const resourceDiff = this.resourceDifferenceFromChangeSetResource(rc);
      if (resourceDiff?.isDifferent) {
        resourceDiffs.set(logicalId, resourceDiff);
      }
    }
  }

  /**
   * Build a `ResourceDifference` purely from a change set's `ResourceChange`.
   *
   * Prefers the rich `BeforeContext`/`AfterContext` (the full resource definition before and
   * after the change, included when the change set is described with `IncludePropertyValues`),
   * and falls back to the per-property `BeforeValue`/`AfterValue` carried in the change details.
   *
   * @returns the synthesized difference, or `undefined` if there is not enough information to
   *   build a meaningful before/after comparison.
   */
  private resourceDifferenceFromChangeSetResource(rc: ChangeSetResourceChange): types.ResourceDifference | undefined {
    const resourceType = rc.ResourceType;

    let oldResource: types.Resource | undefined;
    let newResource: types.Resource | undefined;

    const oldFromContext = this.parseResourceContext(rc.BeforeContext, resourceType);
    const newFromContext = this.parseResourceContext(rc.AfterContext, resourceType);
    if (oldFromContext !== undefined && newFromContext !== undefined) {
      oldResource = oldFromContext;
      newResource = newFromContext;
    } else {
      // The full before/after context was not requested/returned; reconstruct the resource
      // from the individual property changes instead.
      const fromDetails = this.resourcesFromChangeDetails(rc, resourceType);
      oldResource = fromDetails.oldResource;
      newResource = fromDetails.newResource;
    }

    if (oldResource === undefined || newResource === undefined) {
      return undefined;
    }

    const resourceDiff = diffResource(oldResource, newResource, rc.LogicalResourceId);

    // Refine the change impact (replacement vs. update) using the change set, exactly like we do
    // for resources that originate from the template diff.
    this.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(rc.LogicalResourceId!, resourceDiff);

    return resourceDiff;
  }

  /**
   * Parse a change set `BeforeContext`/`AfterContext` into a resource object.
   *
   * The context is the resource's definition (Properties, Metadata, etc.) but does *not* include
   * the resource `Type`, so we splice it back in (using the change set's reported type) to allow
   * the diff machinery to compare like-for-like and look up replacement information.
   */
  private parseResourceContext(context: string | object | undefined, resourceType: string | undefined): types.Resource | undefined {
    if (context === undefined || context === null) {
      return undefined;
    }

    let parsed: any;
    if (typeof context === 'string') {
      try {
        parsed = JSON.parse(context);
      } catch {
        return undefined;
      }
    } else {
      parsed = context;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }

    return {
      Type: resourceType ?? TemplateAndChangeSetDiffMerger.UNKNOWN_RESOURCE_TYPE,
      ...parsed,
    };
  }

  /**
   * Reconstruct (partial) before/after resource definitions from the per-property change details.
   *
   * This is the fallback used when `BeforeContext`/`AfterContext` are not available (for example
   * when the change set was described without `IncludePropertyValues`). Only properties that
   * carry a before or after value contribute to the reconstructed resources.
   */
  private resourcesFromChangeDetails(
    rc: ChangeSetResourceChange,
    resourceType: string | undefined,
  ): { oldResource: types.Resource | undefined; newResource: types.Resource | undefined } {
    const oldProperties: types.PropertyMap = {};
    const newProperties: types.PropertyMap = {};
    let hasData = false;

    for (const detail of rc.Details ?? []) {
      const target = detail.Target;
      if (target?.Attribute !== 'Properties' || !target.Name) {
        continue;
      }
      if (target.BeforeValue !== undefined) {
        oldProperties[target.Name] = tryJsonParse(target.BeforeValue);
        hasData = true;
      }
      if (target.AfterValue !== undefined) {
        newProperties[target.Name] = tryJsonParse(target.AfterValue);
        hasData = true;
      }
    }

    if (!hasData) {
      return { oldResource: undefined, newResource: undefined };
    }

    const type = resourceType ?? TemplateAndChangeSetDiffMerger.UNKNOWN_RESOURCE_TYPE;
    return {
      oldResource: { Type: type, Properties: oldProperties },
      newResource: { Type: type, Properties: newProperties },
    };
  }

  /**
   * Find the raw `ResourceChange` for a given logical ID in the change set.
   */
  private findResourceChange(logicalId: string): ChangeSetResourceChange | undefined {
    for (const resourceChange of this.changeSet?.Changes ?? []) {
      if (resourceChange.ResourceChange?.LogicalResourceId === logicalId) {
        return resourceChange.ResourceChange;
      }
    }
    return undefined;
  }

  /**
   * Determine the before/after value of a single property from the change set.
   *
   * Prefers the per-property `BeforeValue`/`AfterValue` carried in the change details, then the
   * `BeforeContext`/`AfterContext` resource snapshots, and finally falls back to empty-object
   * placeholders so the property still renders as a change (with the impact derived from the
   * change set) even when no concrete values were returned.
   */
  private changeSetPropertyValues(
    resourceChange: ChangeSetResourceChange | undefined,
    propertyName: string,
  ): { oldValue: any; newValue: any } {
    let oldValue: any;
    let newValue: any;

    for (const detail of resourceChange?.Details ?? []) {
      const target = detail.Target;
      if (target?.Attribute === 'Properties' && target.Name === propertyName) {
        if (target.BeforeValue !== undefined) {
          oldValue = tryJsonParse(target.BeforeValue);
        }
        if (target.AfterValue !== undefined) {
          newValue = tryJsonParse(target.AfterValue);
        }
      }
    }

    if (oldValue === undefined) {
      oldValue = contextProperties(resourceChange?.BeforeContext)?.[propertyName];
    }
    if (newValue === undefined) {
      newValue = contextProperties(resourceChange?.AfterContext)?.[propertyName];
    }

    // PropertyDifference requires at least one defined side; use a placeholder otherwise.
    return {
      oldValue: oldValue !== undefined ? oldValue : {},
      newValue: newValue !== undefined ? newValue : {},
    };
  }

  public addImportInformationFromChangeset(resourceDiffs: types.DifferenceCollection<types.Resource, types.ResourceDifference>) {
    const imports = this.findResourceImports();
    resourceDiffs.forEachDifference((logicalId: string, change: types.ResourceDifference) => {
      if (imports.includes(logicalId)) {
        change.isImport = true;
      }
    });
  }

  public findResourceImports(): (string | undefined)[] {
    const importedResourceLogicalIds = [];
    for (const resourceChange of this.changeSet?.Changes ?? []) {
      if (resourceChange.ResourceChange?.Action === 'Import') {
        importedResourceLogicalIds.push(resourceChange.ResourceChange.LogicalResourceId);
      }
    }

    return importedResourceLogicalIds;
  }
}

/**
 * Parse a change set property value as JSON, falling back to the raw value.
 *
 * Change set property values (e.g. `BeforeValue`/`AfterValue`) are always strings. Some of them
 * are serialized JSON (such as an IAM `PolicyDocument`), while others are plain scalars. Parsing
 * lets us compare structured values structurally; if parsing fails we keep the original string.
 */
function tryJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Map a change set replacement mode to the corresponding diff `ResourceImpact`.
 *
 * Returns `undefined` when the change set does not consider the property a (meaningful) change.
 */
function changeImpactForReplacementMode(replacementMode: types.ReplacementModes | undefined): types.ResourceImpact | undefined {
  switch (replacementMode) {
    case 'Always':
      return types.ResourceImpact.WILL_REPLACE;
    case 'Never':
      return types.ResourceImpact.WILL_UPDATE;
    case 'Conditionally':
      return types.ResourceImpact.MAY_REPLACE;
    default:
      return undefined;
  }
}

/**
 * Parse the `Properties` block out of a change set `BeforeContext`/`AfterContext` snapshot.
 */
function contextProperties(context: string | object | undefined): { [name: string]: any } | undefined {
  if (context === undefined || context === null) {
    return undefined;
  }
  let parsed: any;
  if (typeof context === 'string') {
    try {
      parsed = JSON.parse(context);
    } catch {
      return undefined;
    }
  } else {
    parsed = context;
  }
  return parsed && typeof parsed === 'object' ? parsed.Properties : undefined;
}
