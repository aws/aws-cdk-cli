import * as fs from 'fs';
import * as path from 'path';
import type { ArtifactManifest, MetadataEntry } from '@aws-cdk/cloud-assembly-schema';

/**
 * Read the metadata for the given artifact
 *
 * You must use this instead of accessing `ArtifactManifest.metadata`
 * directly; this can also deal with the case of where the metadata
 * has been written to a file.
 */
export function readArtifactMetadata(assemblyDirectory: string, x: ArtifactManifest): Record<string, MetadataEntry[]> {
  const ret = {};
  if (x.additionalMetadataFile) {
    Object.assign(ret, JSON.parse(fs.readFileSync(path.join(assemblyDirectory, x.additionalMetadataFile), 'utf-8')));
  }
  // FIXME: Conflicting paths
  // FIXME: Rewrite stack tags
  Object.assign(ret, x.metadata);
  return ret;
}
