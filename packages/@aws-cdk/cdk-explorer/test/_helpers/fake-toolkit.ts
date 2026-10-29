import * as fs from 'fs';
import * as path from 'path';
import { AssemblyError, LockError, NonInteractiveIoHost, Toolkit, ToolkitError } from '@aws-cdk/toolkit-lib';
import type { ICloudAssemblySource, IReadableCloudAssembly } from '@aws-cdk/toolkit-lib';

/**
 * A `Toolkit` stand-in that scripts the app-synth path while keeping the
 * assembly-read path real.
 *
 * `createLspHandlers` takes a `Toolkit` and calls `runSynth` directly, so there
 * is no synth seam to inject. To drive synth outcomes without spawning a CDK app
 * subprocess, this delegates `fromAssemblyDirectory` (and any synth of the
 * source it returns) to a genuine Toolkit, so the construct index is still built
 * from the fixture on disk, and intercepts only `fromCdkAppDirectory` + the synth
 * of *that* source.
 */

/** Marks the assembly source `fromCdkAppDirectory` hands back, so `synth` can recognise it. */
const APP_SOURCE = Symbol('fake-app-source');

/**
 * Stands in for `Toolkit.fromCdkAppDirectory`: reads `cdk.json` from disk and
 * raises the same error codes it does when there is no app to synth.
 */
export async function fakeFromCdkAppDirectory(appDirectory: string): Promise<ICloudAssemblySource> {
  const cdkJsonPath = path.join(appDirectory, 'cdk.json');
  let cdkJson: Record<string, unknown>;
  try {
    cdkJson = JSON.parse(await fs.promises.readFile(cdkJsonPath, 'utf-8'));
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw new ToolkitError('CdkJsonMissing', `fromCdkAppDirectory: cdk.json not found at ${cdkJsonPath}`);
    }
    throw e;
  }
  if (!cdkJson.app) {
    throw new ToolkitError('CdkJsonIncomplete', `fromCdkAppDirectory: missing "app" field in ${cdkJsonPath}`);
  }
  return { [APP_SOURCE]: true, appDirectory } as unknown as ICloudAssemblySource;
}

/** One scripted outcome of synthesizing the app. */
export type SynthOutcome =
  | { readonly kind: 'success' }
  /** A failing CDK app; `details` becomes the error's cause, which carries the compiler output. */
  | { readonly kind: 'app-failure'; readonly message: string; readonly details?: string }
  /**
   * An external writer (a terminal `cdk synth`) holding the cdk.out write lock.
   * Raises a `LockError`, which `retryOnLock` retries rather than surfacing, so
   * this is not a `SynthRunResult` status.
   */
  | { readonly kind: 'locked' }
  | { readonly kind: 'error'; readonly message: string };

export class FakeToolkit {
  /** Project dirs passed to `fromCdkAppDirectory`, in call order. */
  public readonly appSynthCalls: string[] = [];

  private readonly real = new Toolkit({ ioHost: new NonInteractiveIoHost() });
  private readonly outcomes: SynthOutcome[] = [];
  /** Repeated once `outcomes` runs out, so a test need only script what it cares about. */
  private trailing: SynthOutcome = { kind: 'success' };
  private gate: Promise<void> | undefined;
  private openGate: (() => void) | undefined;

  /** Script the next outcomes; the last one repeats for any further synth. */
  public willSynth(...outcomes: SynthOutcome[]): this {
    this.outcomes.push(...outcomes);
    if (outcomes.length > 0) {
      this.trailing = outcomes[outcomes.length - 1];
    }
    return this;
  }

  /**
   * Hold the next app synth open until {@link releaseSynth}, so a test can
   * observe what happens while one is in flight (the concurrency latch).
   */
  public blockSynth(): this {
    this.gate = new Promise((resolve) => {
      this.openGate = resolve;
    });
    return this;
  }

  public releaseSynth(): void {
    this.openGate?.();
    this.gate = undefined;
    this.openGate = undefined;
  }

  /** The number of app synths attempted (each lock retry counts as one). */
  public get synthCount(): number {
    return this.appSynthCalls.length;
  }

  /** Cast to the type `createLspHandlers` expects. */
  public asToolkit(): Toolkit {
    return this as unknown as Toolkit;
  }

  public async fromAssemblyDirectory(directory: string, props?: unknown): Promise<ICloudAssemblySource> {
    return (this.real as any).fromAssemblyDirectory(directory, props);
  }

  public async fromCdkAppDirectory(appDirectory: string): Promise<ICloudAssemblySource> {
    return fakeFromCdkAppDirectory(appDirectory);
  }

  public async synth(source: any, props?: unknown): Promise<IReadableCloudAssembly> {
    if (!source?.[APP_SOURCE]) {
      // A real assembly source: let the genuine Toolkit read it.
      return (this.real as any).synth(source, props);
    }

    this.appSynthCalls.push(source.appDirectory);
    if (this.gate) {
      await this.gate;
    }

    const outcome = this.outcomes.shift() ?? this.trailing;
    switch (outcome.kind) {
      case 'success':
        return fakeReadableAssembly();
      case 'app-failure':
        throw AssemblyError.withCause(outcome.message, new Error(outcome.details ?? ''));
      case 'locked':
        throw new LockError('ConcurrentWriteLock', 'a synth is writing');
      case 'error':
        throw new Error(outcome.message);
    }
  }
}

/** The handle `runSynth` disposes after a successful synth. */
function fakeReadableAssembly(): IReadableCloudAssembly {
  return {
    cloudAssembly: undefined,
    dispose: async () => undefined,
    _unlock: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as IReadableCloudAssembly;
}
