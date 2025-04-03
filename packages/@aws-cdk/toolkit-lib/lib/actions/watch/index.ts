import type { BaseDeployOptions } from '../deploy/private';

export interface WatchOptions extends BaseDeployOptions {
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
