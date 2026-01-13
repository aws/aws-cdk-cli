import type { AssemblyManifest } from '@aws-cdk/cloud-assembly-schema';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import type { ResourceLocation as CfnResourceLocation } from '@aws-sdk/client-cloudformation';
import type { ResourceLocation } from './cloudformation';

export interface ExcludeList {
  isExcluded(location: ResourceLocation): boolean;

  union(other: ExcludeList): ExcludeList;
}

abstract class AbstractExcludeList implements ExcludeList {
  abstract isExcluded(location: ResourceLocation): boolean;

  union(other: ExcludeList): ExcludeList {
    return new UnionExcludeList([this, other]);
  }
}

export class ManifestExcludeList extends AbstractExcludeList {
  private readonly excludedLocations: CfnResourceLocation[];

  constructor(manifest: AssemblyManifest) {
    super();
    this.excludedLocations = this.getExcludedLocations(manifest);
  }

  private getExcludedLocations(asmManifest: AssemblyManifest): CfnResourceLocation[] {
    // First, we need to filter the artifacts to only include CloudFormation stacks
    const stackManifests = Object.entries(asmManifest.artifacts ?? {}).filter(
      ([_, manifest]) => manifest.type === ArtifactType.AWS_CLOUDFORMATION_STACK,
    );

    const result: CfnResourceLocation[] = [];
    for (let [stackName, manifest] of stackManifests) {
      const locations = Object.values(manifest.metadata ?? {})
        // Then pick only the resources in each stack marked with DO_NOT_REFACTOR
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
    return this.excludedLocations.some(
      (loc) => loc.StackName === location.stack.stackName && loc.LogicalResourceId === location.logicalResourceId,
    );
  }
}

export class InMemoryExcludeList extends AbstractExcludeList {
  private readonly excludedLocations: CfnResourceLocation[];
  private readonly excludedPaths: string[];

  constructor(items: string[]) {
    super();
    this.excludedLocations = [];
    this.excludedPaths = [];

    if (items.length === 0) {
      return;
    }

    const locationRegex = /^[A-Za-z0-9]+\.[A-Za-z0-9]+$/;

    items.forEach((item: string) => {
      if (locationRegex.test(item)) {
        const [stackName, logicalId] = item.split('.');
        this.excludedLocations.push({
          StackName: stackName,
          LogicalResourceId: logicalId,
        });
      } else {
        this.excludedPaths.push(item);
      }
    });
  }

  isExcluded(location: ResourceLocation): boolean {
    const containsLocation = this.excludedLocations.some((loc) => {
      return loc.StackName === location.stack.stackName && loc.LogicalResourceId === location.logicalResourceId;
    });

    const containsPath = this.excludedPaths.some((path) => location.toPath() === path);
    return containsLocation || containsPath;
  }
}

export class UnionExcludeList extends AbstractExcludeList {
  constructor(private readonly excludeLists: ExcludeList[]) {
    super();
  }

  isExcluded(location: ResourceLocation): boolean {
    return this.excludeLists.some((excludeList) => excludeList.isExcluded(location));
  }
}

export class NeverExclude extends AbstractExcludeList {
  isExcluded(_location: ResourceLocation): boolean {
    return false;
  }
}

export class AlwaysExclude extends AbstractExcludeList {
  isExcluded(_location: ResourceLocation): boolean {
    return true;
  }
}
