import type { AssemblyManifest } from '@aws-cdk/cloud-assembly-schema';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import type { ResourceLocation as CfnResourceLocation } from '@aws-sdk/client-cloudformation';
import type { ResourceLocation } from './cloudformation';

export interface ExcludeList {
  isExcluded(location: ResourceLocation): boolean;
}

export class ManifestExcludeList implements ExcludeList {
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
          entries.some((entry) => entry.type === ArtifactMetadataEntryType.DO_NOT_REFACTOR && entry.data === true),
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

  isExcluded(location: ResourceLocation): boolean {
    return this.skippedLocations.some(
      (loc) => loc.StackName === location.stack.stackName && loc.LogicalResourceId === location.logicalResourceId,
    );
  }
}

export class InMemoryExcludeList implements ExcludeList {
  private readonly skippedLocations: CfnResourceLocation[];
  private readonly skippedPaths: string[];

  constructor(items: string[]) {
    this.skippedLocations = [];
    this.skippedPaths = [];

    if (items.length === 0) {
      return;
    }

    const locationRegex = /^[A-Za-z0-9]+\.[A-Za-z0-9]+$/;

    items.forEach((item: string) => {
      if (locationRegex.test(item)) {
        const [stackName, logicalId] = item.split('.');
        this.skippedLocations.push({
          StackName: stackName,
          LogicalResourceId: logicalId,
        });
      } else {
        this.skippedPaths.push(item);
      }
    });
  }

  isExcluded(location: ResourceLocation): boolean {
    const containsLocation = this.skippedLocations.some((loc) => {
      return loc.StackName === location.stack.stackName && loc.LogicalResourceId === location.logicalResourceId;
    });

    const containsPath = this.skippedPaths.some((path) => location.toPath() === path);
    return containsLocation || containsPath;
  }
}

export class UnionExcludeList implements ExcludeList {
  constructor(private readonly skipLists: ExcludeList[]) {
  }

  isExcluded(location: ResourceLocation): boolean {
    return this.skipLists.some((skipList) => skipList.isExcluded(location));
  }
}

export class NeverExclude implements ExcludeList {
  isExcluded(_location: ResourceLocation): boolean {
    return false;
  }
}

export class AlwaysExclude implements ExcludeList {
  isExcluded(_location: ResourceLocation): boolean {
    return true;
  }
}

export function fromManifestAndExclusionList(manifest: AssemblyManifest, exclude?: string[]): ExcludeList {
  return new UnionExcludeList([new ManifestExcludeList(manifest), new InMemoryExcludeList(exclude ?? [])]);
}

