import { ArtifactMetadataEntryType, type MetadataEntry } from '@aws-cdk/cloud-assembly-schema';
import type { CloudFormationStackArtifact } from '@aws-cdk/cx-api';

/**
 * Metadata entry for a resource within a CloudFormation stack
 */
export interface ResourceMetadata {
  /**
   * The resource's metadata as declared in the cloud assembly
   */
  readonly entry: MetadataEntry;
  /**
   * The construct path of the resource
   */
  readonly constructPath: string;
}

/**
 * Attempts to read metadata for resources from a CloudFormation stack artifact
 *
 * @param stack - The CloudFormation stack to read from
 * @param logicalId - The logical ID of the resource to read
 *
 * @returns The resource metadata, or undefined if the resource was not found
 */
export function resourceMetadata(stack: CloudFormationStackArtifact, logicalId: string): ResourceMetadata | undefined {
  const metadata = stack.manifest?.metadata;
  if (!metadata) {
    return undefined;
  }

  for (const path of Object.keys(metadata)) {
    const entry = metadata[path]
      .filter((e) => e.type === ArtifactMetadataEntryType.LOGICAL_ID)
      .find((e) => e.data === logicalId);
    if (entry) {
      return {
        entry,
        constructPath: simplifyConstructPath(path, stack.stackName),
      };
    }
  }
  return undefined;
}

function simplifyConstructPath(path: string, stackName: string) {
  path = path.replace(/\/Resource$/, '');
  path = path.replace(/^\//, ''); // remove "/" prefix

  // remove "<stack-name>/" prefix
  if (stackName) {
    if (path.startsWith(stackName + '/')) {
      path = path.slice(stackName.length + 1);
    }
  }
  return path;
}
