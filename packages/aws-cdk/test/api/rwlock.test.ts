/* eslint-disable import/order */
import { promises as fs } from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import { RWLock } from '../../lib/api/rwlock';

function testDir() {
  return path.join(os.tmpdir(), 'rwlock-tests');
}

test('writer lock excludes other locks', async () => {
  // GIVEN
  const lock = new RWLock(testDir());
  const w = await lock.acquireWrite();

  // WHEN
  try {
    await expect(lock.acquireWrite()).rejects.toThrow(/currently synthing/);
    await expect(lock.acquireRead()).rejects.toThrow(/currently synthing/);
  } finally {
    await w.release();
  }
});

test('reader lock allows other readers but not writers', async () => {
  // GIVEN
  const lock = new RWLock(testDir());
  const r = await lock.acquireRead();

  // WHEN
  try {
    await expect(lock.acquireWrite()).rejects.toThrow(/currently reading/);

    const r2 = await lock.acquireRead();
    await r2.release();
  } finally {
    await r.release();
  }
});

test('can convert writer to reader lock', async () => {
  // GIVEN
  const lock = new RWLock(testDir());
  const w = await lock.acquireWrite();

  // WHEN
  const r = await w.convertToReaderLock();
  try {
    const r2 = await lock.acquireRead();
    await r2.release();
  } finally {
    await r.release();
  }
});

test('can release writer lock more than once, second invocation does nothing', async () => {
  const unlink = jest.spyOn(fs, 'unlink');

  // GIVEN
  const lock = new RWLock(testDir());
  const r = await lock.acquireWrite();

  // WHEN
  await r.release();
  expect(unlink).toHaveBeenCalledTimes(1);

  await r.release();
  expect(unlink).toHaveBeenCalledTimes(1);
});

test('can release reader lock more than once, second invocation does nothing', async () => {
  const unlink = jest.spyOn(fs, 'unlink');

  // GIVEN
  const lock = new RWLock(testDir());
  const r = await lock.acquireRead();

  // WHEN
  await r.release();
  expect(unlink).toHaveBeenCalledTimes(1);

  await r.release();
  expect(unlink).toHaveBeenCalledTimes(1);
});