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
  sdk: SDK,
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

  const identifier = await resolveCloudControlIdentifier(logicalId, resourceType, change, evaluateCfnTemplate, sdk);
  if (!identifier) {
    ret.push(nonHotswappableChange(
      change,
      NonHotswappableReason.RESOURCE_UNSUPPORTED,
      'Could not determine the physical name or primary id of the resource, so Cloud Control API cannot hotswap it',
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
    apply: async () => {
      const cloudControl = sdk.cloudControl();
      const currentResource = await cloudControl.getResource({
        TypeName: resourceType,
        Identifier: identifier,
      });

      const currentProps: Record<string, any> = JSON.parse(
        currentResource.ResourceDescription?.Properties ?? '{}',
      );

      const patchOps: Array<{ op: string; path: string; value: any }> = [];
      for (const propName of classifiedChanges.namesOfHotswappableProps) {
        const newValue = evaluatedProps[propName];
        if (JSON.stringify(currentProps[propName]) !== JSON.stringify(newValue)) {
          const op = propName in currentProps ? 'replace' : 'add';
          patchOps.push({ op, path: `/${propName}`, value: newValue });
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
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  sdk: SDK,
): Promise<string | undefined> {
  const cfnPhysicalId = await evaluateCfnTemplate.findPhysicalNameFor(logicalId);
  if (!cfnPhysicalId) {
    return undefined;
  }

  // Try to get the resource type schema to check for compound identifiers
  let primaryIdentifier: string[];
  const typeInfo = await sdk.cloudFormation().describeType({
    Type: 'RESOURCE',
    TypeName: resourceType,
  });
  const schema = JSON.parse(typeInfo.Schema ?? '{}');
  if (!schema || !schema.primaryIdentifier) {
    return cfnPhysicalId;
  }
  primaryIdentifier = schema.primaryIdentifier;

  // if there is a primary identifier in the array, we resolve it
  if (primaryIdentifier.length > 0) {
    const parts: string[] = [];
    for (const propPath of primaryIdentifier) {
      const propName = propPath.replace('/properties/', '');
      const propValue = change.newValue.Properties?.[propName];
      if (!propValue) {
        return cfnPhysicalId;
      }
      try {
        const resolvedValue = await evaluateCfnTemplate.evaluateCfnExpression(propValue);
        parts.push(resolvedValue);
      } catch {
        return cfnPhysicalId;
      }
    }
    // compound primary identifiers are joined together with |
    return parts.join('|');
  }
  return cfnPhysicalId;
}
