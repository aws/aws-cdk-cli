import * as chokidar from 'chokidar';
import { WATCH_EXCLUDE_DEFAULTS, createIgnoreMatcher } from '../api-private';
import type { FileWatcher } from './assembly-watcher';

// Coalesce an editor's burst of writes (e.g. save-all) into a single signal.
const DEBOUNCE_MS = 200;

/**
 * Paths under the app dir that never count as a source change: toolkit-lib's
 * own watch exclusions, dependencies, our synth output (`cdk.out`), and
 * dotfiles (editor configs, `.git`). Applied both at the chokidar level (so the
 * tree is never traversed) and re-checked in the handler.
 */
const SOURCE_WATCH_EXCLUDES = [
  ...WATCH_EXCLUDE_DEFAULTS,
  '**/node_modules/**',
  '**/cdk.out/**',
  '.*',
  '**/.*',
  '**/.*/**',
];

/** A running source-tree watcher. */
export interface SourceWatcher {
  /** Stop watching and release the underlying file handles. */
  close(): Promise<void>;
}

export interface SourceWatcherOptions {
  /** The application directory whose source tree is watched. */
  readonly appDir: string;
  /** Invoked (debounced) when a non-ignored source file changes. */
  readonly onChange: () => void;
  /** Receives non-fatal watcher errors. */
  readonly onError: (error: unknown) => void;
  /**
   * Factory for the underlying file watcher. Defaults to chokidar; overridden
   * in tests with a fake so behavior is verified without real file IO.
   */
  readonly createWatcher?: (appDir: string) => FileWatcher;
}

// Thin wrapper over real chokidar; exercised via integration, not unit tests.
/* c8 ignore start */
function defaultCreateWatcher(appDir: string): FileWatcher {
  // chokidar applies the same ignore policy while traversing, so excluded paths
  // (node_modules, cdk.out, dotfiles) are skipped at the source instead of
  // streamed to the handler. It emits absolute paths, which the handler
  // re-checks against the same policy.
  return chokidar.watch(appDir, {
    ignored: createIgnoreMatcher({ exclude: SOURCE_WATCH_EXCLUDES, rootDir: appDir }),
    ignoreInitial: true,
  }) as unknown as FileWatcher;
}
/* c8 ignore stop */

/**
 * Watch a CDK app's source tree and fire `onChange` (debounced) when a
 * non-ignored file changes.
 */
export function startSourceWatcher(options: SourceWatcherOptions): SourceWatcher {
  const createWatcher = options.createWatcher ?? defaultCreateWatcher;
  // Drop changes to ignored paths so they never raise a spurious signal. chokidar
  // emits absolute paths, which the matcher's rootDir resolves before matching.
  const shouldIgnore = createIgnoreMatcher({ exclude: SOURCE_WATCH_EXCLUDES, rootDir: options.appDir });

  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const watcher = createWatcher(options.appDir);

  watcher.on('all', (_eventName, filePath) => {
    if (closed) return;
    if (shouldIgnore(filePath)) return;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      try {
        options.onChange();
      } catch (error) {
        options.onError(error);
      }
    }, DEBOUNCE_MS);
  });

  watcher.on('error', (error) => {
    options.onError(error);
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
