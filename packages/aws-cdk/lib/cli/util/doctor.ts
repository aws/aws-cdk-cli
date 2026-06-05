import { createHook } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IoHelper } from '../../../lib/api-private';

/**
 * Async resource types that are too noisy to be useful in a hang report.
 * Promises and timer wrappers in particular are created in vast quantities
 * and rarely correspond to a leaked handle the user can act on.
 */
const IGNORED_TYPES = new Set([
  'TIMERWRAP',
  'PROMISE',
  'PerformanceObserver',
  'RANDOMBYTESREQUEST',
]);

/** A single frame in a captured stack trace. */
interface StackFrame {
  readonly fileName: string | null;
  readonly lineNumber: number | null;
}

/** A tracked async resource and where it was created. */
interface TrackedResource {
  readonly type: string;
  readonly resource: { hasRef?: () => boolean };
  readonly creationStack: StackFrame[];
}

const trackedResources = new Map<number, TrackedResource>();

const asyncHook = createHook({
  init(asyncId, type, _triggerAsyncId, resource) {
    if (IGNORED_TYPES.has(type)) {
      return;
    }
    // Skip the first frame (this init callback itself).
    const creationStack = captureStackFrames().slice(1);
    trackedResources.set(asyncId, {
      type,
      resource: resource as { hasRef?: () => boolean },
      creationStack,
    });
  },
  destroy(asyncId) {
    trackedResources.delete(asyncId);
  },
});

/**
 * Start tracking async resources so we can later report which ones are still
 * keeping the Node event loop alive. Must be called before any async resource
 * we care about is created (so as early as possible during CLI startup).
 *
 * Only call this when the user has opted in via the --doctor flag; the hook
 * adds a small per-resource cost.
 */
export function enableHandleTracking(): void {
  asyncHook.enable();
}

/**
 * Report any async resources still keeping the event loop alive, with the
 * source location where each one was created.
 *
 * Should be called at the very end of CLI execution. By the time the CLI's
 * work is logically done, only leaked handles should remain in the registry.
 */
export async function reportLeakedHandles(ioHelper: IoHelper): Promise<void> {
  asyncHook.disable();

  const stillAlive = Array.from(trackedResources.values()).filter(({ resource }) => {
    // Resources with a hasRef() of false have been .unref()'d and are NOT
    // keeping the loop alive. Resources without a hasRef() default to "yes".
    return resource.hasRef?.() ?? true;
  });

  await ioHelper.defaults.warn(`[cdk doctor] ${stillAlive.length} handle(s) keeping the process running.`);

  for (const resource of stillAlive) {
    await reportResource(resource, ioHelper);
  }
}

async function reportResource(resource: TrackedResource, ioHelper: IoHelper): Promise<void> {
  // Drop frames that are inside Node internals; the user can't act on those.
  const userFrames = resource.creationStack.filter((frame) => {
    return frame.fileName !== null && !frame.fileName.startsWith('node:');
  });

  await ioHelper.defaults.warn('');
  await ioHelper.defaults.warn(`# ${resource.type}`);

  if (userFrames.length === 0) {
    await ioHelper.defaults.warn('(no user-code frames found)');
    return;
  }

  // Pad locations to a uniform width so the source-line annotations line up.
  const locations = userFrames.map(formatLocation);
  const maxLocationWidth = Math.max(...locations.map((s) => s.length));

  for (let i = 0; i < userFrames.length; i++) {
    const frame = userFrames[i];
    const location = locations[i];
    const padding = ' '.repeat(maxLocationWidth - location.length);

    const sourceLine = readSourceLine(frame);
    if (sourceLine !== undefined) {
      await ioHelper.defaults.warn(`${location}${padding} - ${sourceLine}`);
    } else {
      await ioHelper.defaults.warn(location);
    }
  }
}

function formatLocation(frame: StackFrame): string {
  const absolutePath = normalizeFilePath(frame.fileName ?? '');
  const cwdRelative = relative(process.cwd(), absolutePath);
  // If the file is outside cwd, relative() yields a leading '..' which is
  // less readable than the absolute path.
  const displayPath = cwdRelative.startsWith('..') ? absolutePath : cwdRelative;
  return `${displayPath}:${frame.lineNumber}`;
}

function readSourceLine(frame: StackFrame): string | undefined {
  if (frame.fileName === null || frame.lineNumber === null) {
    return undefined;
  }
  try {
    const lines = readFileSync(normalizeFilePath(frame.fileName), 'utf-8').split(/\r?\n/);
    return lines[frame.lineNumber - 1]?.trim();
  } catch {
    return undefined;
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
}

/**
 * Capture the current stack as a list of frames, using V8's structured stack
 * trace API (Error.prepareStackTrace). The default formatter is restored
 * before returning.
 */
function captureStackFrames(): StackFrame[] {
  const target: { stack?: StackFrame[] } = {};
  const original = Error.prepareStackTrace;

  Error.prepareStackTrace = (_error, callSites) => {
    return callSites.map((site) => ({
      fileName: site.getFileName(),
      lineNumber: site.getLineNumber(),
    }));
  };

  // Walk the stack starting from the caller of captureStackFrames.
  Error.captureStackTrace(target, captureStackFrames);
  const frames = (target.stack as unknown as StackFrame[]) ?? [];

  Error.prepareStackTrace = original;
  return frames;
}
