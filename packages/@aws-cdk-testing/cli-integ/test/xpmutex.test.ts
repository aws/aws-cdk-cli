import { promises as fs } from 'fs';
import { XpMutexPool } from '../lib/xpmutex';

const POOL = XpMutexPool.fromName('test-pool');

test('acquire waits', async () => {
  const mux = POOL.mutex('testA');
  let secondLockAcquired = false;

  // Current "process" acquires lock
  const lock = await mux.acquire();

  // Start a second "process" that tries to acquire the lock
  const secondProcess = (async () => {
    const secondLock = await mux.acquire();
    try {
      secondLockAcquired = true;
    } finally {
      await secondLock.release();
    }
  })();

  // Once we release the lock the second process is free to take it
  expect(secondLockAcquired).toBe(false);
  await lock.release();

  // We expect the variable to become true
  await waitFor(() => secondLockAcquired);
  expect(secondLockAcquired).toBe(true);

  await secondProcess;
});

test('a Windows delete-pending EPERM on create is treated as contention, not a fatal error', async () => {
  // On Windows, creating the lock file can transiently fail with EPERM while a
  // just-unlinked file is in "delete pending" state. The mutex must swallow
  // that and retry rather than throwing it up to the caller (which is what
  // took down the shared-install lock on the Windows integ runner).
  const mux = POOL.mutex('windowsEperm');

  const realOpen = fs.open.bind(fs);
  let epermInjected = 0;
  const spy = jest.spyOn(fs, 'open').mockImplementation((async (...args: any[]) => {
    // Fail the first exclusive-create attempt exactly once, as Windows would.
    if (args[1] === 'wx' && epermInjected < 1) {
      epermInjected++;
      const e: any = new Error("EPERM: operation not permitted, open '<lock>'");
      e.code = 'EPERM';
      throw e;
    }
    return realOpen(...(args as Parameters<typeof realOpen>));
  }) as unknown as typeof fs.open);

  try {
    // Would reject with EPERM before the fix; now it retries and succeeds.
    const lock = await mux.acquire();
    expect(epermInjected).toBe(1);
    await lock.release();
  } finally {
    spy.mockRestore();
  }
});

/**
 * Poll for some condition every 10ms
 */
function waitFor(pred: () => boolean): Promise<void> {
  return new Promise((ok) => {
    const timerHandle = setInterval(() => {
      if (pred()) {
        clearInterval(timerHandle);
        ok();
      }
    }, 5);
  });
}
