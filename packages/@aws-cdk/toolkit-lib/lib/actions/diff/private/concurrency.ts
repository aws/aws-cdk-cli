import type { ActionLessMessage } from '../../../api/io/private';
import { IoHelper } from '../../../api/io/private';
import { ToolkitError } from '../../../toolkit/toolkit-error';
import { pLimit } from '../../../util/concurrency';

export function validateDiffConcurrency(value: number | undefined): number {
  const concurrency = value ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new ToolkitError('InvalidDiffConcurrency', `diff concurrency must be a positive integer, got ${value}`);
  }
  return concurrency;
}

/**
 * Prepare stacks concurrently, replaying notifications sent through the supplied per-stack IoHelper
 * and yielding results in input order. Notifications from shared deployment and credential helpers,
 * including role-resolution warnings and asset-publishing progress, may appear as they occur.
 * Stop starting queued work after failure and drain in-flight work (including change-set cleanup)
 * before returning. Requests are forwarded immediately rather than buffered.
 */
export async function* prepareStacksConcurrently<T, R>(
  stacks: readonly T[],
  concurrency: number,
  ioHelper: IoHelper,
  prepare: (stack: T, io: IoHelper) => Promise<R>,
): AsyncGenerator<R> {
  // Preserve the existing preparation/output interleaving in the default sequential mode.
  if (concurrency === 1) {
    for (const stack of stacks) {
      yield await prepare(stack, ioHelper);
    }
    return;
  }

  const limit = pLimit(concurrency);
  let failed = false;
  let next = 0;
  let notifications = Promise.resolve();
  const buffers: ActionLessMessage<unknown>[][] = stacks.map(() => []);
  function flush(messages: ActionLessMessage<unknown>[]): Promise<void> {
    const pending = messages.splice(0);
    notifications = notifications.then(async () => {
      for (const message of pending) {
        await ioHelper.notify(message);
      }
    });
    return notifications;
  }
  type Result = { value: R; messages: ActionLessMessage<unknown>[] } |
    { error: unknown; messages: ActionLessMessage<unknown>[] } |
    { skipped: true; messages: ActionLessMessage<unknown>[] };
  const preparations = stacks.map((stack, index) => limit(async (): Promise<Result> => {
    const messages = buffers[index];
    if (failed) {
      return { skipped: true, messages };
    }
    const bufferedIo = IoHelper.fromActionAwareIoHost({
      notify: async message => {
        messages.push(message);
        if (index === next) {
          await flush(messages);
        }
      },
      requestResponse: request => ioHelper.requestResponse(request),
    });
    try {
      return { value: await prepare(stack, bufferedIo), messages };
    } catch (error) {
      failed = true;
      return { error, messages };
    }
  }));

  try {
    while (next < preparations.length) {
      await flush(buffers[next]);
      const result = await preparations[next];
      await flush(result.messages);
      if ('error' in result) {
        throw result.error;
      }
      if ('value' in result) {
        yield result.value;
      }
      next++;
    }
  } finally {
    // The consumer may stop early (for example, if formatting fails). Do not start more work.
    failed = true;
    // These promises were already scheduled through p-limit above; this only drains them.
    const remaining: Result[] = [];
    for (const preparation of preparations.slice(next)) {
      remaining.push(await preparation);
    }
    for (const result of remaining) {
      await flush(result.messages);
    }
  }
}
