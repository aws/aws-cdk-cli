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
