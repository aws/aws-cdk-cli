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
}
