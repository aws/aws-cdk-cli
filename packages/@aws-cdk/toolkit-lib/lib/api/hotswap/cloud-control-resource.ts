import type { HotswapChange } from './common';
import { classifyChanges, nonHotswappableChange } from './common';
import { NonHotswappableReason } from '../../payloads';
import type { ResourceChange } from '../../payloads/hotswap';
import type { SDK } from '../aws-auth/private';
import type { EvaluateCloudFormationTemplate } from '../cloudformation';

/**
 * A generalized hotswap detector that uses Cloud Control API (CCAPI) to update
 * any resource type that CCAPI supports. Used as a fallback for resource types
 * that don't have a dedicated hotswap detector.
 *
 * If the CCAPI update fails (e.g. the resource type isn't supported by CCAPI,
 * or the property requires replacement), the error is swallowed and the change
 * is reported as non-hotswappable instead.
 */
export async function isHotswappableCloudControlChange(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
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
      'Could not determine the physical name of the resource, so Cloud Control API cannot hotswap it',
    ));
    return ret;
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
        const newValue = await evaluateCfnTemplate.evaluateCfnExpression(
          change.propertyUpdates[propName].newValue,
        );
        if (JSON.stringify(currentProps[propName]) !== JSON.stringify(newValue)) {
          const op = propName in currentProps ? 'replace' : 'add';
          patchOps.push({ op, path: `/${propName}`, value: newValue });
        }
      }

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
 * Wraps the CCAPI hotswap detector so that failures during apply are caught
 * and converted into non-hotswappable rejections rather than hard errors.
 */
export async function tryCloudControlHotswap(
  logicalId: string,
  change: ResourceChange,
  evaluateCfnTemplate: EvaluateCloudFormationTemplate,
  sdk: SDK,
): Promise<HotswapChange[]> {
  const results = await isHotswappableCloudControlChange(logicalId, change, evaluateCfnTemplate, sdk);

  return results.map((result) => {
    if (!result.hotswappable) {
      return result;
    }

    // Wrap the apply function to catch CCAPI errors and convert them to rejections
    const originalApply = result.apply;
    return {
      ...result,
      apply: async () => {
        try {
          await originalApply(sdk);
        } catch (e: any) {
          throw new CloudControlHotswapError(change, e);
        }
      },
    };
  });
}

/**
 * Resolves the Cloud Control API identifier for a resource.
 *
 * CCAPI resources with compound primary identifiers (e.g. AWS::ApiGateway::Stage
 * uses ["/properties/RestApiId", "/properties/StageName"]) need their identifier
 * built by joining each component with "|". CloudFormation's PhysicalResourceId
 * only returns a single value, which doesn't work for compound keys.
 *
 * Falls back to the CloudFormation physical resource ID for simple identifiers
 * or when the schema cannot be retrieved.
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
  try {
    const typeInfo = await sdk.cloudFormation().describeType({
      Type: 'RESOURCE',
      TypeName: resourceType,
    });
    const schema = JSON.parse(typeInfo.Schema ?? '{}');
    primaryIdentifier = schema.primaryIdentifier ?? [];
  } catch {
    // If we can't get the schema, fall back to the CFN physical ID
    return cfnPhysicalId;
  }

  // Single-property identifier — CFN physical ID is sufficient
  if (primaryIdentifier.length <= 1) {
    return cfnPhysicalId;
  }

  // Compound identifier — resolve each property from the template
  const parts: string[] = [];
  for (const propPath of primaryIdentifier) {
    // propPath is like "/properties/RestApiId"
    const propName = propPath.replace('/properties/', '');
    const propValue = change.newValue.Properties?.[propName];
    if (propValue === undefined) {
      return cfnPhysicalId; // can't resolve, fall back
    }
    try {
      const resolved = await evaluateCfnTemplate.evaluateCfnExpression(propValue);
      parts.push(String(resolved));
    } catch {
      return cfnPhysicalId; // can't evaluate, fall back
    }
  }

  return parts.join('|');
}

/**
 * Sentinel error thrown when a CCAPI hotswap apply fails. The caller in
 * hotswap-deployments can catch this and demote the change to non-hotswappable.
 */
export class CloudControlHotswapError extends Error {
  public readonly change: ResourceChange;
  public readonly cause: Error;

  constructor(change: ResourceChange, cause: Error) {
    super(`Cloud Control API hotswap failed for ${change.newValue.Type}: ${cause.message}`);
    this.change = change;
    this.cause = cause;
  }

  public toRejectedChange(): HotswapChange {
    return nonHotswappableChange(
      this.change,
      NonHotswappableReason.RESOURCE_UNSUPPORTED,
      `Cloud Control API could not hotswap this resource: ${this.cause.message}`,
    );
  }
}
