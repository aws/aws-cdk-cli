import type { IManifestEntry } from '@aws-cdk/cdk-assets-lib';

export interface AssetsPayload {
  /**
   * List of assets
   */
  readonly assets: IManifestEntry[];
}
