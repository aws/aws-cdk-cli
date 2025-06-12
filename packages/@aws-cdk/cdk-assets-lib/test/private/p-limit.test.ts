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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
