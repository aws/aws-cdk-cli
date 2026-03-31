import type { IManifestEntry } from '@aws-cdk/cdk-assets-lib';
import type { PublishResult } from '../actions';

export interface PublishAssetsPayload {
  /**
   * List of assets to be published
   */
  readonly assets: IManifestEntry[];
}

export interface PublishResultPayload {
  /**
   * The publish result
   */
  readonly result: PublishResult;
}
