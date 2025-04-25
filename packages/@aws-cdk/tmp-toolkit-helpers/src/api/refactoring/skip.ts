import * as fs from 'node:fs';
import type { AssemblyManifest } from '@aws-cdk/cloud-assembly-schema';
import { ArtifactMetadataEntryType, ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import { ToolkitError } from '../toolkit-error';

export interface SkipList {
  resourceIds: string[];
}

export class ManifestSkipList implements SkipList {
  constructor(private readonly manifest: AssemblyManifest) {
  }

  get resourceIds(): string[] {
    return Object.values(this.manifest.artifacts ?? {})
      .filter((manifest) => manifest.type === ArtifactType.AWS_CLOUDFORMATION_STACK)
      .flatMap((manifest) => Object.entries(manifest.metadata ?? {}))
      .filter(([_, entries]) =>
        entries.some((entry) => entry.type === ArtifactMetadataEntryType.SKIP_REFACTOR && entry.data === true),
      )
      .map(([_, entries]) => {
        return entries.find((entry) => entry.type === ArtifactMetadataEntryType.LOGICAL_ID)!.data! as string;
      });
  }
}

export class FileSkipList implements SkipList {
  constructor(private readonly filePath?: string) {
  }

  get resourceIds(): string[] {
    if (!this.filePath) {
      return [];
    }
    const parsedData = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    if (!Array.isArray(parsedData) || !parsedData.every((item) => typeof item === 'string')) {
      throw new ToolkitError('The content of a skip file must be a JSON array of strings');
    }
    return parsedData;
  }
}

export class UnionSkipList implements SkipList {
  constructor(private readonly skipLists: SkipList[]) {
  }

  get resourceIds(): string[] {
    return this.skipLists.flatMap((skipList) => skipList.resourceIds);
  }
}
