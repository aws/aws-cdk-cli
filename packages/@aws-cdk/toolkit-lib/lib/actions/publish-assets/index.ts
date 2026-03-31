import type { IManifestEntry } from '@aws-cdk/cdk-assets-lib';
import type { StackSelector } from '../../api/cloud-assembly';

export interface PublishAssetsOptions {
  /**
   * Select stacks to publish assets for
   *
   * @default - All stacks
   */
  readonly stacks?: StackSelector;

  /**
   * Always publish assets, even if they are already published
   *
   * @default false
   */
  readonly force?: boolean;

  /**
   * Maximum number of simultaneous asset operations (building and publishing)
   *
   * @default 1
   */
  readonly concurrency?: number;
}

export interface PublishAssetsResult {
  /**
   * List of assets that were published
   */
  readonly publishedAssets: IManifestEntry[];
}
