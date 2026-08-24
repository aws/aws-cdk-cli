/* eslint-disable @cdklabs/promiseall-no-unbounded-parallelism */
import { pLimit } from '../../lib/private/p-limit';

test('never running more than N jobs at once', async () => {
  const limit = pLimit(5);
  let current = 0;
  let max = 0;

  await Promise.all(
    Array.from({ length: 20 }).map(() =>
      limit(async () => {
        max = Math.max(max, ++current);
        await sleep(1);
        --current;
      }),
    ),
  );

  expect(max).toBeLessThanOrEqual(5);
});

test('new jobs arent started after dispose is called', async () => {
  const limit = pLimit(2);
  let started = 0;

  await expect(() =>
    Promise.all(
      Array.from({ length: 20 }).map(() =>
        limit(async () => {
          started += 1;
          await sleep(0);
          throw new Error('oops');
        }),
      ),
    ),
  ).rejects.toThrow(/oops/);

  limit.dispose();

  await sleep(20);

  // It may be that we started 1 more job here, but definitely not all 20
  expect(started).toBeLessThanOrEqual(3);
});

test('no new job is started once dispose is called, even with a free slot', async () => {
  const limit = pLimit(1);

  limit.dispose();

  let ran = false;
  await expect(
    limit(async () => {
      ran = true;
    }),
  ).rejects.toThrow(/cancelled/);

  // activeCount was 0 and concurrency is 1, so before the fix dispatch()
  // would start this job immediately despite dispose() having been called.
  expect(ran).toBe(false);
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
