import type { IManifestEntry } from '@aws-cdk/cdk-assets-lib';
import type { StackSelector } from '../../api/cloud-assembly';

export interface PublishOptions {
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
   * Whether to build/publish assets in parallel
   *
   * @default true
   */
  readonly assetParallelism?: boolean;

  /**
   * Maximum number of simultaneous asset publishing operations
   *
   * @default 1
   */
  readonly concurrency?: number;

  /**
   * Role to pass to CloudFormation for asset operations
   *
   * @default - Current role
   */
  readonly roleArn?: string;
}

export interface PublishResult {
  /**
   * List of assets that were published
   */
  readonly publishedAssets: IManifestEntry[];
}
