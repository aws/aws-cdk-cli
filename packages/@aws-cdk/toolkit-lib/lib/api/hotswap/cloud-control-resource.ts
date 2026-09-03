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
        } else if (propName === 'Tags' && Array.isArray(newValue)) {
          patchOps.push(...await tagPatchOps(cloudControl, resourceType, identifier, newValue));
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
 * Tag keys beginning with `aws:` are reserved for AWS-managed tags, for example the
 * `aws:cloudformation:stack-name` / `stack-id` / `logical-id` tags that CloudFormation puts
 * on the resources it creates. They are read-only: a service rejects any external attempt to
 * create, update or delete them.
 */
function isReservedTagKey(key: unknown): boolean {
  return typeof key === 'string' && key.toLowerCase().startsWith('aws:');
}

/**
 * Build the patch operations for a changed `Tags` list.
 *
 * A wholesale `replace /Tags` declares the resource's *complete* desired tag set. On a
 * resource created by CloudFormation that set also contains reserved `aws:`-prefixed tags,
 * which are never in the template — so the service reconciles by deleting them and rejects
 * the whole request:
 *
 * ```
 * ValidationException: aws: prefixed tag key names are not allowed for external use
 * ```
 *
 * Instead, address individual tags by their index in the resource's *current* `Tags` list.
 * Reserved tags are then never named by the patch, so the service sees no change to them.
 *
 * This needs the current state, so it is read via Cloud Control `GetResource`. If that read
 * fails we throw rather than silently falling back to a wholesale replace: on a
 * CloudFormation-created resource that fallback is precisely the request the service
 * rejects, so degrading to it would resurface the original failure with a misleading cause.
 */
async function tagPatchOps(
  cloudControl: ReturnType<SDK['cloudControl']>,
  resourceType: string,
  identifier: string,
  desiredTags: any[],
): Promise<Array<{ op: string; path: string; value?: any }>> {
  const readTags = await currentResourceTags(cloudControl, resourceType, identifier);

  // A few resource types model `Tags` as a `{ key: value }` map instead of a list. There is no
  // index to address there, so keep the previous wholesale replace for that shape. Untested
  // against a service that also carries reserved tags on a map-shaped property.
  if (readTags !== undefined && !Array.isArray(readTags)) {
    return [{ op: 'replace', path: '/Tags', value: desiredTags }];
  }

  // No `Tags` on the resource yet is legitimate: every desired tag is simply an addition.
  const currentTags: any[] = readTags ?? [];

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
 * cannot be determined at all, because guessing would mean sending a patch that removes the
 * resource's reserved `aws:` tags.
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
