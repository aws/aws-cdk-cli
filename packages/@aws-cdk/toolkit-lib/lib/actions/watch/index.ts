import type { DeploymentMethod, BaseDeployOptions } from '../deploy';

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

  /**
   * Deployment method
   *
   * @default HotswapDeployment
   */
  readonly deploymentMethod?: DeploymentMethod;
}

/**
 * The result of a `cdk.watch()` operation.
 */
export interface IWatcher extends AsyncDisposable {
  /**
   * Stop the watcher and wait for the current watch iteration to complete.
   *
   * An alias for `[Symbol.asyncDispose]`, as a more readable alternative for
   * environments that don't support the Disposable APIs yet.
   */
  dispose(): Promise<void>;

  /**
   * Wait for the watcher to stop.
   *
   * The watcher will only stop if `dispose()` or `[Symbol.asyncDispose]()` are called.
   *
   * If neither of those is called, awaiting this promise will wait forever.
   */
  waitForEnd(): Promise<void>;
}
