import type { HotswapChange } from './common';
import { classifyChanges, nonHotswappableChange } from './common';
import { NonHotswappableReason } from '../../payloads';
import type { ResourceChange } from '../../payloads/hotswap';
import type { SDK } from '../aws-auth/private';
import { CfnEvaluationException, type EvaluateCloudFormationTemplate } from '../cloudformation';

export async function isHotswappableCloudControlChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  _hotswapPropertyOverrides: unknown,
): Promise<HotswapChange[]> {
  const ret: HotswapChange[] = [];

  const changedPropNames = Object.keys(change.propertyUpdates);
  if (changedPropNames.length === 0) {
    return ret;
  }
  const classifiedChanges = classifyChanges(change, changedPropNames);
  classifiedChanges.reportNonHotswappablePropertyChanges(ret);

  if (classifiedChanges.namesOfHotswappableProps.length === 0) {
    return ret;
  }

  const resourceType = change.newValue.Type;

  const identifier = await resolveCloudControlIdentifier(logicalId, resourceType, evaluateCfnTemplate);
  if (!identifier) {
    ret.push(nonHotswappableChange(
      change,
      NonHotswappableReason.RESOURCE_UNSUPPORTED,
      'Could not determine the physical name or primary identifier of the resource, so Cloud Control API cannot hotswap it.',
    ));
    return ret;
  }

  // Eagerly evaluate property values so that unresolvable references
  // are caught here and the resource is classified as non-hotswappable
  // instead of failing at apply time. This is for resources that depend
  // on resources where an update means replacement.
  const evaluatedProps: Record<string, any> = {};
  for (const propName of classifiedChanges.namesOfHotswappableProps) {
    try {
      evaluatedProps[propName] = await evaluateCfnTemplate.evaluateCfnExpression(
        change.propertyUpdates[propName].newValue,
      );
    } catch (e) {
      if (e instanceof CfnEvaluationException) {
        ret.push(nonHotswappableChange(
          change,
          NonHotswappableReason.RESOURCE_UNSUPPORTED,
          `Property '${propName}' of resource '${logicalId}' has been replaced and could not be resolved: ${e.message}`,
        ));
        return ret;
      }
      throw e;
    }
  }

  ret.push({
    change: {
      cause: change,
      resources: [{
        logicalId,
        resourceType,
        physicalName: identifier,
        metadata: evaluateCfnTemplate.metadataFor(logicalId),
      }],
    },
    hotswappable: true,
    service: 'cloudcontrol',
    apply: async (sdk: SDK) => {
      const cloudControl = sdk.cloudControl();

      const patchOps: Array<{ op: string; path: string; value?: any }> = [];
      for (const propName of classifiedChanges.namesOfHotswappableProps) {
        const diff = change.propertyUpdates[propName];
        let newValue = evaluatedProps[propName];

        // A `replace /Tags` sets the resource's tags to exactly the template-defined
        // set. Resources created by CloudFormation also carry reserved AWS-managed
        // tags (keys prefixed with `aws:`, e.g. `aws:cloudformation:stack-name`).
        // Omitting those from the desired set makes Cloud Control try to remove them,
        // which the service rejects with
        // "aws: prefixed tag key names are not allowed for external use", failing the
        // whole hotswap. Read the current tags and carry the reserved ones over so
        // Cloud Control sees no change to them.
        if (propName === 'Tags' && !diff.isRemoval) {
          newValue = withPreservedReservedTags(newValue, await currentResourceTags(cloudControl, resourceType, identifier));
        }

        if (diff.isRemoval) {
          patchOps.push({ op: 'remove', path: `/${propName}` });
        } else if (diff.isAddition) {
          patchOps.push({ op: 'add', path: `/${propName}`, value: newValue });
        } else {
          patchOps.push({ op: 'replace', path: `/${propName}`, value: newValue });
        }
      }

      // nothing to hotswap
      if (patchOps.length === 0) {
        return;
      }

      await cloudControl.updateResource({
        TypeName: resourceType,
        Identifier: identifier,
        PatchDocument: JSON.stringify(patchOps),
      });
    },
  });

  return ret;
}

/**
 * Read the current `Tags` value of a resource via Cloud Control `GetResource`.
 *
 * Best-effort: returns `undefined` if the resource or its tags can't be read, in
 * which case the caller proceeds without preserving reserved tags (i.e. the
 * previous behaviour). `GetResource` returns the resource model as a JSON string
 * in `ResourceDescription.Properties`.
 */
async function currentResourceTags(
  cloudControl: ReturnType<SDK['cloudControl']>,
  resourceType: string,
  identifier: string,
): Promise<unknown> {
  try {
    const current = await cloudControl.getResource({ TypeName: resourceType, Identifier: identifier });
    const properties = current.ResourceDescription?.Properties;
    return properties ? JSON.parse(properties).Tags : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Merge reserved AWS-managed tags (keys prefixed with `aws:`) from a resource's
 * current tags into the new `Tags` value, so a Cloud Control `replace /Tags` does
 * not drop them. Reserved keys already present in `newTags` are left untouched
 * (the template wins). Matching is case-insensitive.
 *
 * `Tags` appears in two shapes across CloudFormation resource types: a list of
 * `{ Key, Value }` objects (most resources, including `AWS::SQS::Queue`) and a
 * plain `{ key: value }` map. Both are handled; any other shape is returned
 * unchanged.
 */
function withPreservedReservedTags(newTags: any, currentTags: unknown): any {
  const isReserved = (key: unknown): boolean => typeof key === 'string' && key.toLowerCase().startsWith('aws:');

  // list of { Key, Value }
  if (Array.isArray(newTags)) {
    const currentList = Array.isArray(currentTags) ? currentTags : [];
    const presentKeys = new Set(
      newTags.filter((tag) => tag && typeof tag === 'object').map((tag) => tag.Key),
    );
    const preserved = currentList.filter(
      (tag) => tag && typeof tag === 'object' && isReserved(tag.Key) && !presentKeys.has(tag.Key),
    );
    return [...newTags, ...preserved];
  }

  // { key: value } map
  if (newTags && typeof newTags === 'object') {
    const currentMap = currentTags && typeof currentTags === 'object' && !Array.isArray(currentTags)
      ? currentTags as Record<string, any>
      : {};
    const preserved: Record<string, any> = {};
    for (const [key, value] of Object.entries(currentMap)) {
      if (isReserved(key) && !(key in newTags)) {
        preserved[key] = value;
      }
    }
    return { ...preserved, ...newTags };
  }

  return newTags;
}

/**
 * Resolves the Cloud Control API identifier for a resource.
 *
 * CCAPI resources with compound primary identifiers need their identifiers to be
 * built by joining each component with "|". CloudFormation's PhysicalResourceId
 * only returns a single value, which doesn't work for compound keys.
 *
 * Falls back to the CloudFormation physical resource ID for when the schema cannot be retrieved.
 */
async function resolveCloudControlIdentifier(
  logicalId: string,
  resourceType: string,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
): Promise<string | undefined> {
  const cfnPhysicalId = await evaluateCfnTemplate.findPhysicalNameFor(logicalId);
  if (!cfnPhysicalId) {
    return undefined;
  }

  return evaluateCfnTemplate.evaluateCloudControlIdentifier(logicalId, resourceType, cfnPhysicalId);
}
