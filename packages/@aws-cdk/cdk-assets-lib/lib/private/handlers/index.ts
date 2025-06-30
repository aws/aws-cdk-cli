import { ContainerImageAssetHandler } from './container-images';
import { FileAssetHandler } from './files';
import {
  type AssetManifest,
  DockerImageManifestEntry,
  FileManifestEntry,
  type IManifestEntry,
} from '../../asset-manifest';
import type { IAssetHandler, IHandlerHost, IHandlerOptions } from '../asset-handler';

export function makeAssetHandler(
  manifest: AssetManifest,
  asset: IManifestEntry,
  host: IHandlerHost,
  options: IHandlerOptions,
): IAssetHandler {
  if (asset instanceof FileManifestEntry) {
    return new FileAssetHandler(manifest.directory, asset, host);
  }
  if (asset instanceof DockerImageManifestEntry) {
    return new ContainerImageAssetHandler(manifest.directory, asset, host, options);
  }

  throw new Error(`Unrecognized asset type: '${asset}'`);
}
