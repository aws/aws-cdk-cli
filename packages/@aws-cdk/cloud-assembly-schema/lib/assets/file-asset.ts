import type { AwsDestination } from './aws-destination';

/**
 * A file asset
 */
export interface FileAsset {
  /**
   * A display name for this asset
   *
   * @default - The identifier will be used as the display name
   */
  readonly displayName?: string;

  /**
   * Source description for file assets
   */
  readonly source: FileSource;

  /**
   * Destinations for this file asset
   */
  readonly destinations: { [id: string]: FileDestination };
}

/**
 * Packaging strategy for file assets
 */
export enum FileAssetPackaging {
  /**
   * Upload the given path as a file
   */
  FILE = 'file',

  /**
   * The given path is a directory, zip it and upload
   */
  ZIP_DIRECTORY = 'zip',
}

/**
 * Symlink following strategy for file assets
 */
export enum FileAssetSymlinks {
  /**
   * Follow symlinks when processing the given path
   *
   * For asset bundles that are extracted into S3, symlinks must be followed because there is
   * otherwise no meaningful way to represent symlinks in S3.
   */
  FOLLOW_ALL = 'FOLLOW_ALL',

  /**
   * Follow symlinks that point inside the base directory, but throw if any symlinks pointing outside it are encountered.
   */
  FOLLOW_INTERNAL_REJECT_EXTERNAL = 'FOLLOW_INTERNAL_REJECT_EXTERNAL',
}

/**
 * Describe the source of a file asset
 */
export interface FileSource {
  /**
   * External command which will produce the file asset to upload.
   *
   * @default - Exactly one of `executable` and `path` is required.
   */
  readonly executable?: string[];

  /**
   * The filesystem object to upload
   *
   * This path is relative to the asset manifest location.
   *
   * @default - Exactly one of `executable` and `path` is required.
   */
  readonly path?: string;

  /**
   * Packaging method
   *
   * Only allowed when `path` is specified.
   *
   * @default FILE
   */
  readonly packaging?: FileAssetPackaging;

  /**
   * How to handle symlinks when processing the given path
   *
   * Only allowed when `path` is specified and `packaging` is set to `ZIP_DIRECTORY`.
   *
   * @default FOLLOW_ALL
   */
  readonly symlinks?: FileAssetSymlinks;
}

/**
 * Where in S3 a file asset needs to be published
 */
export interface FileDestination extends AwsDestination {
  /**
   * The name of the bucket
   */
  readonly bucketName: string;

  /**
   * The destination object key
   */
  readonly objectKey: string;
}
