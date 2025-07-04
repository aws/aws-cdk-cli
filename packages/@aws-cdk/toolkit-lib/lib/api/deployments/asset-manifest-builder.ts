import { AssetManifest } from '@aws-cdk/cdk-assets-lib';
import * as cxschema from '@aws-cdk/cloud-assembly-schema';

export class AssetManifestBuilder {
  private readonly manifest: cxschema.AssetManifest = {
    version: cxschema.Manifest.version(),
    files: {},
    dockerImages: {},
  };

  public addFileAsset(id: string, source: cxschema.FileSource, destination: cxschema.FileDestination) {
    this.manifest.files![id] = {
      source,
      destinations: {
        current: destination,
      },
    };
  }

  public addDockerImageAsset(id: string, source: cxschema.DockerImageSource, destination: cxschema.DockerImageDestination) {
    this.manifest.dockerImages![id] = {
      source,
      destinations: {
        current: destination,
      },
    };
  }

  public toManifest(directory: string): AssetManifest {
    return new AssetManifest(directory, this.manifest);
  }
}
