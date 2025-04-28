import * as fs from 'node:fs';
import type { AssemblyManifest } from '@aws-cdk/cloud-assembly-schema';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import type { ResourceLocation as CfnResourceLocation } from '@aws-sdk/client-cloudformation';
import { ToolkitError } from '../toolkit-error';

export interface SkipList {
  resourceLocations: CfnResourceLocation[];
}

export class ManifestSkipList implements SkipList {
  constructor(private readonly manifest: AssemblyManifest) {
  }

  get resourceLocations(): CfnResourceLocation[] {
    // First, we need to filter the artifacts to only include CloudFormation stacks
    const stackManifests = Object.entries(this.manifest.artifacts ?? {}).filter(
      ([_, manifest]) => manifest.type === ArtifactType.AWS_CLOUDFORMATION_STACK,
    );

    const result: CfnResourceLocation[] = [];
    for (let [stackName, manifest] of stackManifests) {
      const locations = Object.values(manifest.metadata ?? {})
        // Then pick only the resources in each stack marked with SKIP_REFACTOR
        .filter((entries) =>
          entries.some((entry) => entry.type === ArtifactMetadataEntryType.SKIP_REFACTOR && entry.data === true),
        )
        // Finally, get the logical ID of each resource
        .map((entries) => {
          const logicalIdEntry = entries.find((entry) => entry.type === ArtifactMetadataEntryType.LOGICAL_ID);
          const location: CfnResourceLocation = {
            StackName: stackName,
            LogicalResourceId: logicalIdEntry!.data! as string,
          };
          return location;
        });
      result.push(...locations);
    }
    return result;
  }
}

export class SkipFile implements SkipList {
  constructor(private readonly filePath?: string) {
  }

  get resourceLocations(): CfnResourceLocation[] {
    if (!this.filePath) {
      return [];
    }
    const parsedData = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    if (!isValidSkipFileContent(parsedData)) {
      throw new ToolkitError('The content of a skip file must be a JSON array of strings');
    }

    const result: CfnResourceLocation[] = [];
    parsedData.forEach((item: string) => {
      const parts = item.split('.');
      if (parts.length !== 2) {
        throw new ToolkitError(`Invalid resource location format: ${item}. Expected format: stackName.logicalId`);
      }
      const [stackName, logicalId] = parts;
      result.push({
        StackName: stackName,
        LogicalResourceId: logicalId,
      });
    });
    return result;
  }
}

function isValidSkipFileContent(data: any): data is string[] {
  return Array.isArray(data) && data.every((item: any) => typeof item === 'string');
}

export class UnionSkipList implements SkipList {
  constructor(private readonly skipLists: SkipList[]) {
  }

  get resourceLocations(): CfnResourceLocation[] {
    return this.skipLists.flatMap((skipList) => skipList.resourceLocations);
  }
}
