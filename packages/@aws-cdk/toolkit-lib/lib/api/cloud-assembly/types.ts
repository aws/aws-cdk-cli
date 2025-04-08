import type * as cxapi from '@aws-cdk/cx-api';

export interface ICloudAssemblySource {
  /**
   * Produce a CloudAssembly from the current source
   */
  produce(): Promise<IReadableCloudAssembly>;
}

/**
 * A version of the CloudAssembly that is safe to read from
 *
 * In practice, this means it holds a lock which prevents other
 * producers from overwriting the contents of the backing cloud
 * assembly directory.
 *
 * The receiver of an `IReadableCloudAssembly` must always dispose of the
 * object!
 */
export interface IReadableCloudAssembly {
  /**
   * The underlying Cloud Assembly
   */
  readonly cloudAssembly: cxapi.CloudAssembly;

  /**
   * Release the lock on the Cloud Assembly directory only.
   *
   * Consumer code should never call this. This method only exists for the
   * benefit of `ContextAwareCloudAssemblySource`, so that it can unlock a
   * produced but incomplete Cloud Assembly directory with the goal of
   * synthesizing into it again.
   *
   * @internal
   */
  _unlock(): Promise<void>;

  /**
   * Dispose of the Cloud Assembly
   *
   * This does 2 things:
   *
   * - Release the lock on the Cloud Assembly directory
   * - Delete the backing directory, if it is a temporary directory.
   */
  dispose(): Promise<void>;

  /**
   * Async dispose cleanup function
   *
   * An alias for `dispose` that can be used with `await using`.
   */
  [Symbol.asyncDispose](): Promise<void>;
}
