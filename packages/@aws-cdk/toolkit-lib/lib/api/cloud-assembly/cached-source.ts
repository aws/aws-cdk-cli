import '../../private/dispose-polyfill';
import type * as cxapi from '@aws-cdk/cx-api';
import { BorrowedAssembly } from './private/borrowed-assembly';
import type { ICloudAssemblySource, IReadableCloudAssembly } from './types';

/**
 * A CloudAssemblySource that is caching its result once produced.
 *
 * Most Toolkit interactions should use a cached source. Not caching is
 * relevant when the source changes frequently and it is to expensive to predict
 * if the source has changed.
 *
 * The `CachedCloudAssembly` is both itself a readable CloudAssembly, as well as
 * a Cloud Assembly Source. The lifetimes of cloud assemblies produced by this
 * source are coupled to the lifetime of the `CachedCloudAssembly`. In other
 * words: the `dispose()` functions of those cloud assemblies don't do anything;
 * only the `dispose()` function of the `CachedCloudAssembly` will be used.
 *
 * NOTE: if we are concerned about borrowed assemblies outliving the parent
 * (i.e. the parent getting disposed while someone is still working with the
 * borrowed copies), we could consider referencing counting here. That seems
 * unnecessarily complicated for now, we will just assume that everyone is
 * being a good citizen an borrowed copies are only used by the toolkit and
 * immediately disposed of.
 *
 * Because `dispose()` is a no-op on the borrowed assembly, you can omit it
 * without changing behavior, but that would turn into a leak if we ever introduced
 * reference counting. Failing to dispose the result if a `produce()` call of a
 * `CachedCloudAssembly` is considered a bug.
 */
export class CachedCloudAssembly implements ICloudAssemblySource, IReadableCloudAssembly {
  private asm: IReadableCloudAssembly;

  public constructor(asm: IReadableCloudAssembly) {
    this.asm = asm;
  }

  public get cloudAssembly(): cxapi.CloudAssembly {
    return this.asm.cloudAssembly;
  }

  public async produce(): Promise<IReadableCloudAssembly> {
    return new BorrowedAssembly(this.asm.cloudAssembly);
  }

  public _unlock() {
    return this.asm._unlock();
  }

  public dispose(): Promise<void> {
    return this.asm.dispose();
  }

  public [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}
