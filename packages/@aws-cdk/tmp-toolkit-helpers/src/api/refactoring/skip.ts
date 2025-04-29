import * as fs from 'node:fs';
import type { AssemblyManifest } from '@aws-cdk/cloud-assembly-schema';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import type { ResourceLocation as CfnResourceLocation } from '@aws-sdk/client-cloudformation';
import { ToolkitError } from '../toolkit-error';
import type { ResourceLocation } from './cloudformation';

export interface SkipList {
  isSkipped(location: ResourceLocation): boolean;
}

export class ManifestSkipList implements SkipList {
  private readonly skippedLocations: CfnResourceLocation[];

  constructor(manifest: AssemblyManifest) {
    this.skippedLocations = this.getSkippedLocations(manifest);
  }

  private getSkippedLocations(asmManifest: AssemblyManifest): CfnResourceLocation[] {
    // First, we need to filter the artifacts to only include CloudFormation stacks
    const stackManifests = Object.entries(asmManifest.artifacts ?? {}).filter(
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

  isSkipped(location: ResourceLocation): boolean {
    return this.skippedLocations.some(
      (loc) => loc.StackName === location.stack.stackName && loc.LogicalResourceId === location.logicalResourceId,
    );
  }
}

export class SkipFile implements SkipList {
  private readonly skippedLocations: CfnResourceLocation[];
  private readonly skippedPaths: string[];

  constructor(private readonly filePath?: string) {
    this.skippedLocations = [];
    this.skippedPaths = [];

    if (!this.filePath) {
      return;
    }

    const parsedData = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    if (!isValidSkipFileContent(parsedData)) {
      throw new ToolkitError('The content of a skip file must be a JSON array of strings');
    }

    const locationRegex = /^[A-Za-z0-9]+\.[A-Za-z0-9]+$/;
    const pathRegex = /^\w*(\/.*)*$/;

    parsedData.forEach((item: string) => {
      if (locationRegex.test(item)) {
        const [stackName, logicalId] = item.split('.');
        this.skippedLocations.push({
          StackName: stackName,
          LogicalResourceId: logicalId,
        });
      } else if (pathRegex.test(item)) {
        this.skippedPaths.push(item);
      } else {
        throw new ToolkitError(
          `Invalid resource location format: ${item}. Expected formats: stackName.logicalId or a construct path`,
        );
      }
    });
  }

  isSkipped(location: ResourceLocation): boolean {
    const containsLocation = this.skippedLocations.some((loc) => {
      return loc.StackName === location.stack.stackName && loc.LogicalResourceId === location.logicalResourceId;
    });

    const containsPath = this.skippedPaths.some((path) => location.toPath() === path);
    return containsLocation || containsPath;
  }
}

function isValidSkipFileContent(data: any): data is string[] {
  return Array.isArray(data) && data.every((item: any) => typeof item === 'string');
}

export class UnionSkipList implements SkipList {
  constructor(private readonly skipLists: SkipList[]) {
  }

  isSkipped(location: ResourceLocation): boolean {
    return this.skipLists.some((skipList) => skipList.isSkipped(location));
  }
}

export class NeverSkipList implements SkipList {
  isSkipped(_location: ResourceLocation): boolean {
    return false;
  }
}

export class AlwaysSkipList implements SkipList {
  isSkipped(_location: ResourceLocation): boolean {
    return true;
  }
}

export function fromManifestAndSkipFile(manifest: AssemblyManifest, skipFile?: string): SkipList {
  return new UnionSkipList([new ManifestSkipList(manifest), new SkipFile(skipFile)]);
}
