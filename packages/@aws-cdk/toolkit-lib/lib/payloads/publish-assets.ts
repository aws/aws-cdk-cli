import type { IManifestEntry } from '@aws-cdk/cdk-assets-lib';
import type { PublishAssetsResult } from '../actions';

export interface PublishAssetsPayload {
  /**
   * List of assets to be published
   */
  readonly assets: IManifestEntry[];
}

export interface PublishAssetsResultPayload {
  /**
   * The publish assets result
   */
  readonly result: PublishAssetsResult;
}
