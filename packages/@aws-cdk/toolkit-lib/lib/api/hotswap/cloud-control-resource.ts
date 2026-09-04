import type { HotswapChange } from './common';
import { classifyChanges, nonHotswappableChange } from './common';
import { NonHotswappableReason } from '../../payloads';
import type { ResourceChange } from '../../payloads/hotswap';
import { ToolkitError } from '../../toolkit/toolkit-error';
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
        const newValue = evaluatedProps[propName];
        if (diff.isRemoval) {
          patchOps.push({ op: 'remove', path: `/${propName}` });
        } else if (diff.isAddition) {
          patchOps.push({ op: 'add', path: `/${propName}`, value: newValue });
        } else if (propName === 'Tags' && newValue && typeof newValue === 'object') {
          patchOps.push(...await buildTagPatchOps(cloudControl, resourceType, identifier, newValue));
        } else {
          patchOps.push({ op: 'replace', path: `/${propName}`, value: newValue });
        }
      }

      // nothing to hotswap
      if (patchOps.length === 0) {
        return;
      }

      try {
        await cloudControl.updateResource({
          TypeName: resourceType,
          Identifier: identifier,
          PatchDocument: JSON.stringify(patchOps),
        });
      } catch (e) {
        throw ToolkitError.withCause('HotswapFailed', `Failed to update ${identifier} (${resourceType})`, e);
      }
    },
  });

  return ret;
}

/**
 * Tag keys beginning with `aws:` are reserved for AWS-managed tags.
 * They are read-only: a service rejects any external attempt to
 * create, update or delete them.
 */
function isReservedTagKey(key: unknown): boolean {
  return typeof key === 'string' && key.toLowerCase().startsWith('aws:');
}

/**
 * Escape a single JSON Pointer reference token (RFC 6901): `~` becomes `~0` and `/` becomes
 * `~1`. Required because AWS tag keys may legally contain `/`, which would otherwise be read
 * as a path separator.
 */
function escapeJsonPointerToken(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Build the patch operations for a changed `Tags` property.
 *
 * Address tags individually so reserved tags are never named by the patch and the
 * service sees no change to them. That needs the current state, which is read via Cloud
 * Control `GetResource`.
 *
 * CloudFormation models `Tags` either as a list of `{ Key, Value }` (addressed by index) or as
 * a `{ key: value }` map (addressed by key). Both are handled.
 */
async function buildTagPatchOps(
  cloudControl: ReturnType<SDK['cloudControl']>,
  resourceType: string,
  identifier: string,
  desiredTags: any,
): Promise<Array<{ op: string; path: string; value?: any }>> {
  const readTags = await currentResourceTags(cloudControl, resourceType, identifier);
  const desiredIsList = Array.isArray(desiredTags);
  const currentTags = readTags ?? (desiredIsList ? [] : {});

  if (desiredIsList && Array.isArray(currentTags)) {
    return buildListTagPatchOps(currentTags, desiredTags);
  }
  if (!desiredIsList && !Array.isArray(currentTags) && typeof currentTags === 'object') {
    return buildMapTagPatchOps(currentTags as Record<string, any>, desiredTags);
  }

  // The live resource reports `Tags` in a shape the template does not declare. A
  // resource type does not change its tag shape, so this is not expected to happen.
  throw new ToolkitError(
    'HotswapTagReadFailed',
    `could not interpret the current tags of ${identifier} (${resourceType}): the resource reports Tags as ${describeTagsShape(currentTags)} but the template declares ${describeTagsShape(desiredTags)}`,
  );
}

/**
 * Describe the shape of a `Tags` value, for error messages.
 */
function describeTagsShape(tags: unknown): string {
  if (Array.isArray(tags)) {
    return 'a list';
  }
  if (tags === null) {
    return 'null';
  }
  if (typeof tags === 'object') {
    return 'a map';
  }
  return typeof tags; // "string", "number", "undefined", etc.
}
/**
 * `Tags` as a `{ key: value }` map: address each tag by its key. Object members have no
 * position, so unlike the list form there is no ordering constraint between operations.
 */
function buildMapTagPatchOps(
  currentTags: Record<string, any>,
  desiredTags: Record<string, any>,
): Array<{ op: string; path: string; value?: any }> {
  const ops: Array<{ op: string; path: string; value?: any }> = [];

  for (const [key, value] of Object.entries(desiredTags)) {
    const path = `/Tags/${escapeJsonPointerToken(key)}`;
    if (!Object.hasOwn(currentTags, key)) {
      ops.push({ op: 'add', path, value });
    } else if (JSON.stringify(currentTags[key]) !== JSON.stringify(value)) {
      ops.push({ op: 'replace', path, value });
    }
  }

  // Drop tags the template no longer defines — but never the reserved ones.
  for (const key of Object.keys(currentTags)) {
    if (!Object.hasOwn(desiredTags, key) && !isReservedTagKey(key)) {
      ops.push({ op: 'remove', path: `/Tags/${escapeJsonPointerToken(key)}` });
    }
  }

  return ops;
}

/**
 * `Tags` as a list of `{ Key, Value }`: address each tag by its index in the resource's
 * current list.
 */
function buildListTagPatchOps(
  currentTags: any[],
  desiredTags: any[],
): Array<{ op: string; path: string; value?: any }> {
  const isTag = (tag: any): boolean => tag && typeof tag === 'object' && typeof tag.Key === 'string';

  const indexByKey = new Map<string, number>();
  currentTags.forEach((tag, i) => {
    if (isTag(tag) && !indexByKey.has(tag.Key)) {
      indexByKey.set(tag.Key, i);
    }
  });

  // Update tags that already exist (addressed by index); append the ones that don't.
  const replacements: Array<{ op: string; path: string; value?: any }> = [];
  const additions: Array<{ op: string; path: string; value?: any }> = [];
  for (const tag of desiredTags) {
    if (!isTag(tag)) {
      continue;
    }
    const index = indexByKey.get(tag.Key);
    if (index === undefined) {
      additions.push({ op: 'add', path: '/Tags/-', value: tag });
    } else if (JSON.stringify(currentTags[index]) !== JSON.stringify(tag)) {
      replacements.push({ op: 'replace', path: `/Tags/${index}`, value: tag });
    }
  }

  // Drop tags the template no longer defines — but never the reserved ones.
  const desiredKeys = new Set(desiredTags.filter(isTag).map((tag) => tag.Key));
  const removals = currentTags
    .map((tag, i) => ({ tag, i }))
    .filter(({ tag }) => isTag(tag) && !desiredKeys.has(tag.Key) && !isReservedTagKey(tag.Key))
    // Descending, so removing one does not shift the indices of the others.
    .sort((a, b) => b.i - a.i)
    .map(({ i }) => ({ op: 'remove', path: `/Tags/${i}` }));

  // Replacements first (their indices refer to the unmodified list), then removals, then
  // appends, which only ever touch the end of the list.
  return [...replacements, ...removals, ...additions];
}

/**
 * Read the current `Tags` value of a resource via Cloud Control `GetResource`, which returns
 * the resource model as a JSON string in `ResourceDescription.Properties`.
 *
 * Returns `undefined` when the resource simply has no tags. Throws when the current tags
 * cannot be determined at all
 */
async function currentResourceTags(
  cloudControl: ReturnType<SDK['cloudControl']>,
  resourceType: string,
  identifier: string,
): Promise<unknown> {
  const unreadable = (cause: unknown) => ToolkitError.withCause(
    'HotswapTagReadFailed',
    `could not read the current tags of ${identifier} (${resourceType}), which are needed to update tags without removing the reserved aws: tags that AWS manages - ensure the deployment role is allowed to call cloudcontrolapi:GetResource for this resource type`,
    cause,
  );

  let current;
  try {
    current = await cloudControl.getResource({ TypeName: resourceType, Identifier: identifier });
  } catch (e) {
    throw unreadable(e);
  }

  const properties = current.ResourceDescription?.Properties;
  if (!properties) {
    throw unreadable(new Error('GetResource returned no resource properties'));
  }

  try {
    return JSON.parse(properties).Tags;
  } catch (e) {
    throw unreadable(e);
  }
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
