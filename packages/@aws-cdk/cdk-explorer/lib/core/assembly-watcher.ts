import * as path from 'path';
import { MANIFEST_FILE } from '@aws-cdk/cloud-assembly-api';
import { VALIDATION_REPORT_FILE } from '@aws-cdk/cloud-assembly-schema';
import * as chokidar from 'chokidar';

/**
 * The name of the construct tree metadata file emitted alongside the manifest.
 * Producer (`aws-cdk-lib`) hard-codes this filename in its `TreeMetadata`
 * synthesizer rather than importing a shared constant, so this is a
 * consumer-side label only.
 */
export const TREE_FILE = 'tree.json';

/**
 * Basenames whose change signals that the cloud assembly was (re)written.
 * The construct tree, manifest, and policy validation report cover everything
 * the explorer reads; other files in cdk.out (templates, asset files, RWLock
 * markers) are intentionally ignored to avoid spurious refreshes.
 */
const ASSEMBLY_SIGNAL_FILES = new Set([
  MANIFEST_FILE,
  TREE_FILE,
  VALIDATION_REPORT_FILE,
]);

const DEBOUNCE_MS = 200;

/** A running assembly watcher. */
export interface AssemblyWatcher {
  /** Stop watching and release the underlying file handles. */
  close(): Promise<void>;
}

/**
 * Minimal file-watcher surface this module depends on, satisfied by chokidar's
 * `FSWatcher`. Declared explicitly so tests can inject a fake emitter and verify
 * debouncing/filtering without real filesystem events.
 */
export interface FileWatcher {
  on(event: 'all', listener: (eventName: string, filePath: string) => void): FileWatcher;
  on(event: 'error', listener: (error: unknown) => void): FileWatcher;
  close(): Promise<void>;
}

export interface AssemblyWatcherOptions {
  /** The cloud assembly directory to watch (e.g. `<project>/cdk.out`). */
  readonly assemblyDir: string;
  /** Invoked (debounced) when the assembly's signal files change. */
  readonly onChange: () => void;
  /** Receives non-fatal watcher errors. */
  readonly onError?: (error: unknown) => void;
  /**
   * Factory for the underlying file watcher. Defaults to chokidar; overridden
   * in tests with a fake so behavior is verified without real file IO.
   */
  readonly createWatcher?: (assemblyDir: string) => FileWatcher;
}

// Thin wrapper over real chokidar; exercised via integration, not unit tests.
/* c8 ignore start */
function defaultCreateWatcher(assemblyDir: string): FileWatcher {
  // Watch the assembly directory itself. chokidar tolerates the directory not
  // existing yet and emits events once synth creates it. `ignoreInitial` skips
  // the synthetic 'add' events for already-present files, because the caller
  // performs its own initial read separately.
  return chokidar.watch(assemblyDir, {
    ignoreInitial: true,
  }) as unknown as FileWatcher;
}
/* c8 ignore stop */

/**
 * Watch a cloud assembly directory and fire `onChange` (debounced) whenever the
 * assembly is rewritten, regardless of which process produced it (an external
 * `cdk synth`/`cdk watch`, or a future in-process synth).
 *
 * Only the assembly signal files trigger a refresh. Template files and, crucially,
 * the RWLock marker files (`synth.lock` / `read.<pid>.lock`) are ignored: their
 * rapid create/delete during a synth would otherwise cause spurious refreshes.
 */
export function startAssemblyWatcher(options: AssemblyWatcherOptions): AssemblyWatcher {
  const createWatcher = options.createWatcher ?? defaultCreateWatcher;

  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const watcher = createWatcher(options.assemblyDir);

  watcher.on('all', (_eventName, filePath) => {
    if (closed) return;
    if (!ASSEMBLY_SIGNAL_FILES.has(path.basename(filePath))) return;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      try {
        options.onChange();
      } catch (error) {
        options.onError?.(error);
      }
    }, DEBOUNCE_MS);
  });

  watcher.on('error', (error) => {
    options.onError?.(error);
  });

  return {
    async close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await watcher.close();
    },
  };
}
