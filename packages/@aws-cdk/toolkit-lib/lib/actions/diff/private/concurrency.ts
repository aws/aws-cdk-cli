import type { ActionLessMessage } from '../../../api/io/private';
import { IoHelper } from '../../../api/io/private';
import { ToolkitError } from '../../../toolkit/toolkit-error';
import { pLimit } from '../../../util/concurrency';

export function validateDiffConcurrency(value: number | undefined): number {
  const concurrency = value ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new ToolkitError('InvalidDiffConcurrency', 'Diff concurrency must be a positive integer');
  }
  return concurrency;
}

/**
 * Prepare stacks concurrently, but replay their notifications and yield results in input order.
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
  type Result = { value: R; messages: ActionLessMessage<unknown>[] } |
    { error: unknown; messages: ActionLessMessage<unknown>[] } |
    { skipped: true; messages: ActionLessMessage<unknown>[] };
  const preparations = stacks.map(stack => limit(async (): Promise<Result> => {
    const messages: ActionLessMessage<unknown>[] = [];
    if (failed) {
      return { skipped: true, messages };
    }
    const bufferedIo = IoHelper.fromActionAwareIoHost({
      notify: async message => {
        messages.push(message);
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

  let next = 0;
  try {
    while (next < preparations.length) {
      const result = await preparations[next++];
      for (const message of result.messages) {
        await ioHelper.notify(message);
      }
      if ('error' in result) {
        throw result.error;
      }
      if ('value' in result) {
        yield result.value;
      }
    }
  } finally {
    // The consumer may stop early (for example, if formatting fails). Do not start more work.
    failed = true;
    // These promises were already scheduled through p-limit above; this only drains them.
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const remaining = await Promise.all(preparations.slice(next));
    for (const result of remaining) {
      for (const message of result.messages) {
        await ioHelper.notify(message);
      }
    }
  }
}
