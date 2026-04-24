import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';

/**
 * A bidirectional map between logical IDs and construct paths for a single stack.
 *
 * Only includes entries that belong to this stack's own template — resources of
 * nested stacks are excluded. Nested stacks themselves appear as a single entry
 * (the `AWS::CloudFormation::Stack` resource).
 */
export interface LogicalIdMap {
  /** Map from logical ID to construct path */
  readonly toPath: Record<string, string>;
  /** Map from construct path to logical ID */
  readonly toLogicalId: Record<string, string>;
}

/**
 * Build a bidirectional map of logical ID <-> construct path for a stack artifact.
 *
 * For resources, the path is read from the template's own `aws:cdk:path` metadata,
 * which is authoritative and unambiguous. For non-resource entries (Parameters,
 * Conditions, etc.), the cloud assembly metadata is used, filtered to only include
 * logical IDs present in this stack's template.
 */
export function buildLogicalToPathMap(stack: cxapi.CloudFormationStackArtifact): LogicalIdMap {
  const toPath: Record<string, string> = {};
  const toLogicalId: Record<string, string> = {};
  const template = stack.template ?? {};

  // Resources: use the template's own aws:cdk:path metadata as the authoritative source.
  for (const [logicalId, resource] of Object.entries((template.Resources ?? {}) as Record<string, any>)) {
    const path = resource?.Metadata?.['aws:cdk:path'];
    if (path) {
      toPath[logicalId] = path;
      toLogicalId[path] = logicalId;
    }
  }

  // Non-resource entries: use cloud assembly metadata, filtered to this stack's template.
  const ownNonResourceIds = new Set<string>();
  for (const section of ['Parameters', 'Conditions', 'Outputs', 'Rules', 'Mappings']) {
    for (const id of Object.keys(template[section] ?? {})) {
      ownNonResourceIds.add(id);
    }
  }
  for (const md of stack.findMetadataByType(cxschema.ArtifactMetadataEntryType.LOGICAL_ID)) {
    const logicalId = md.data as string;
    if (logicalId in toPath) {
      continue;
    }
    if (!ownNonResourceIds.has(logicalId)) {
      continue;
    }
    toPath[logicalId] = md.path;
    toLogicalId[md.path] = logicalId;
  }

  return { toPath, toLogicalId };
}
