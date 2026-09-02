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
        const newValue = propName === 'Tags' ? withoutAwsPrefixedTags(evaluatedProps[propName]) : evaluatedProps[propName];
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
 * Remove `aws:`-prefixed tag keys from an evaluated `Tags` property value before
 * it is sent to Cloud Control API.
 *
 * Tags whose key begins with `aws:` are reserved for AWS system tags (e.g.
 * `aws:cloudformation:stack-name`, `aws:cdk:*`). They are applied by the service
 * and are read-only: Cloud Control's `UpdateResource` rejects any request that
 * carries one with `ValidationException: aws: prefixed tag key names are not
 * allowed for external use`. When such a tag ends up in the synthesized template
 * (and therefore in the hotswap patch), a `replace /Tags` would send it verbatim
 * and fail the whole hotswap. Dropping these keys keeps the customer-authored
 * tags — the only ones we can legally set — and leaves the system tags to AWS.
 *
 * `Tags` appears in two shapes across CloudFormation resource types: a list of
 * `{ Key, Value }` objects (most resources, including `AWS::SQS::Queue`) and a
 * plain `{ key: value }` map (a few resources). Both are handled; any other shape
 * is returned unchanged.
 */
function withoutAwsPrefixedTags(tags: any): any {
  const isAwsKey = (key: unknown): boolean => typeof key === 'string' && key.toLowerCase().startsWith('aws:');

  if (Array.isArray(tags)) {
    return tags.filter((tag) => !(tag && typeof tag === 'object' && isAwsKey(tag.Key)));
  }
  if (tags && typeof tags === 'object') {
    return Object.fromEntries(Object.entries(tags).filter(([key]) => !isAwsKey(key)));
  }
  return tags;
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
