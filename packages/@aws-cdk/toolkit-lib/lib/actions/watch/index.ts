import type { BaseDeployOptions } from '../deploy/private';

export interface WatchOptions extends BaseDeployOptions {
  /**
   * The extra string to append to the User-Agent header when performing AWS SDK calls.
   *
   * @default - nothing extra is appended to the User-Agent header
   */
  readonly extraUserAgent?: string;

  /**
   * Watch the files in this list
   *
   * @default - []
   */
  readonly include?: string[];

  /**
   * Ignore watching the files in this list
   *
   * @default - []
   */
  readonly exclude?: string[];

  /**
   * The root directory used for watch.
   *
   * @default process.cwd()
   */
  readonly watchDir?: string;

  /**
   * The output directory to write CloudFormation template to
   *
   * @deprecated this should be grabbed from the cloud assembly itself
   *
   * @default 'cdk.out'
   */
  readonly outdir?: string;
}

/**
 * The computed file watch settings
 */
export interface WatchSettings {
  /**
   * The directory observed for file changes
   */
  readonly watchDir: string;
  /**
   * List of include patterns for watching files
   */
  readonly includes: string[];
  /**
   * List of excludes patterns for watching files
   */
  readonly excludes: string[];
}

export interface FileWatchEvent {
  /**
   * The change to the path
   */
  readonly event: string;
  /**
   * The path that has an observed event
   */
  readonly path?: string;
}
