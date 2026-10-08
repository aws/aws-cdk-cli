import { prepareStacksConcurrently, validateDiffConcurrency } from '../../lib/actions/diff/private/concurrency';
import { TestIoHost } from '../_helpers';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) {
    result.push(value);
  }
  return result;
}

test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid concurrency %s', value => {
  expect(() => validateDiffConcurrency(value)).toThrow('Diff concurrency must be a positive integer');
});

test('defaults to sequential preparation interleaved with consumption', async () => {
  const io = new TestIoHost();
  const events: string[] = [];
  for await (const value of prepareStacksConcurrently([0, 1], validateDiffConcurrency(undefined), io.asHelper('diff'), async stack => {
    events.push(`prepare ${stack}`);
    return stack;
  })) {
    events.push(`consume ${value}`);
  }
  expect(events).toEqual(['prepare 0', 'consume 0', 'prepare 1', 'consume 1']);
});

test('bounds preparation and emits results and notifications in stack order despite reverse completion', async () => {
  const io = new TestIoHost();
  const gates = [deferred(), deferred(), deferred()];
  const started = [deferred(), deferred(), deferred()];
  let active = 0;
  let peak = 0;
  const result = collect(prepareStacksConcurrently([0, 1, 2], 2, io.asHelper('diff'), async (stack, stackIo) => {
    active++;
    peak = Math.max(peak, active);
    started[stack].resolve();
    await stackIo.defaults.info(`start ${stack}`);
    await gates[stack].promise;
    await stackIo.defaults.info(`done ${stack}`);
    active--;
    return stack;
  }));

  await started[0].promise;
  await started[1].promise;
  expect(active).toBe(2);
  gates[1].resolve();
  await started[2].promise;
  gates[2].resolve();
  gates[0].resolve();

  expect(await result).toEqual([0, 1, 2]);
  expect(peak).toBe(2);
  expect(io.messages.map(m => m.message)).toEqual(['start 0', 'done 0', 'start 1', 'done 1', 'start 2', 'done 2']);
});

test.each([1, 2, 5])('bounds a 125-stack preparation at concurrency %s', async concurrency => {
  const io = new TestIoHost();
  let active = 0;
  let peak = 0;
  const stacks = Array.from({ length: 125 }, (_, i) => i);
  const result = await collect(prepareStacksConcurrently(stacks, concurrency, io.asHelper('diff'), async stack => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return stack;
  }));
  expect(result).toEqual(stacks);
  expect(peak).toBe(concurrency);
  expect(active).toBe(0);
});

test('stops queued stacks and waits for in-flight cleanup after a throttling failure', async () => {
  const io = new TestIoHost();
  const cleanup = deferred();
  const failed = deferred();
  const started: number[] = [];
  let cleaned = false;
  let settled = false;
  const error = new Error('Throttling');
  const result = collect(prepareStacksConcurrently([0, 1, 2, 3], 2, io.asHelper('diff'), async stack => {
    started.push(stack);
    if (stack === 0) {
      failed.resolve();
      throw error;
    }
    try {
      await cleanup.promise;
      return stack;
    } finally {
      cleaned = true;
    }
  })).catch(e => {
    settled = true; return e;
  });

  await failed.promise;
  await Promise.resolve();
  expect(settled).toBe(false);
  cleanup.resolve();
  expect(await result).toBe(error);
  expect(cleaned).toBe(true);
  expect(started).toEqual([0, 1]);
});

test('drains in-flight work without replaying notifications twice when the consumer stops early', async () => {
  const io = new TestIoHost();
  const gate = deferred();
  const started = deferred();
  const iterator = prepareStacksConcurrently([0, 1], 2, io.asHelper('diff'), async (stack, stackIo) => {
    await stackIo.defaults.info(`stack ${stack}`);
    if (stack === 1) {
      started.resolve();
      await gate.promise;
    }
    return stack;
  });
  expect(await iterator.next()).toEqual({ value: 0, done: false });
  await started.promise;
  const stopped = iterator.return(undefined);
  gate.resolve();
  await stopped;
  expect(io.messages.map(m => m.message)).toEqual(['stack 0', 'stack 1']);
});
