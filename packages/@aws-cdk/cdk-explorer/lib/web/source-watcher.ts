/* eslint-disable import/no-relative-packages -- toolkit-lib's glob-matcher is not re-exported from its package index */
import * as chokidar from 'chokidar';
import { createIgnoreMatcher } from '../../../toolkit-lib/lib/util/glob-matcher';
import type { FileWatcher } from '../core/assembly-watcher';
import { SOURCE_WATCH_EXCLUDES } from '../core/synth-runner';

const DEBOUNCE_MS = 200;

export interface SourceWatcher {
  close(): Promise<void>;
}

export interface SourceWatcherOptions {
  /** The application directory to watch. */
  readonly appDir: string;
  /** Invoked (debounced) when a non-ignored source file changes. */
  readonly onChange: () => void;
  /** Receives non-fatal watcher errors. */
  readonly onError?: (error: unknown) => void;
  /** Factory for the underlying file watcher. Defaults to chokidar. */
  readonly createWatcher?: (appDir: string) => FileWatcher;
}

/* c8 ignore start */
function defaultCreateWatcher(appDir: string): FileWatcher {
  // chokidar applies the same ignore policy while traversing, so ignored paths
  // are skipped at the source instead of streamed to the handler. It emits
  // absolute paths on 'all', which the handler re-checks against the same policy.
  return chokidar.watch(appDir, {
    ignored: createIgnoreMatcher({ exclude: SOURCE_WATCH_EXCLUDES, rootDir: appDir }),
    ignoreInitial: true,
  }) as unknown as FileWatcher;
}
/* c8 ignore stop */

/**
 * Watch a CDK app's source tree and fire `onChange` (debounced) when a
 * non-ignored file changes. The ignore filter runs in the handler; the real
 * watcher additionally skips the same paths for performance.
 */
export function startSourceWatcher(options: SourceWatcherOptions): SourceWatcher {
  const createWatcher = options.createWatcher ?? defaultCreateWatcher;

  // drop changes to ignored paths so they never trigger a synth. chokidar emits absolute paths,
  // which the matcher's rootDir resolves before matching.
  const shouldIgnore = createIgnoreMatcher({ exclude: SOURCE_WATCH_EXCLUDES, rootDir: options.appDir });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const watcher = createWatcher(options.appDir);

  watcher.on('all', (_eventName, filePath) => {
    if (closed) return;
    if (shouldIgnore(filePath)) return;
    if (timer) clearTimeout(timer);
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
