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

describe('lock files left behind by an earlier process with the same PID', () => {
  // In containers the CLI often gets the same PID on every run, so a lock file
  // from a killed run looks like it belongs to a live process: this one.
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rwlock-stale-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('a stale writer lock does not block', async () => {
    // GIVEN
    await fs.writeFile(path.join(dir, 'synth.lock'), `${process.pid}`);
    const lock = new RWLock(dir);

    // WHEN
    const w = await lock.acquireWrite();
    await w.release();

    // THEN
    await expect(fs.readdir(dir)).resolves.toEqual([]);
  });

  test('a stale reader lock does not block', async () => {
    // GIVEN
    await fs.writeFile(path.join(dir, `read.${process.pid}.1.lock`), `${process.pid}`);
    const lock = new RWLock(dir);

    // WHEN
    const w = await lock.acquireWrite();
    await w.release();

    // THEN
    await expect(fs.readdir(dir)).resolves.toEqual([]);
  });

  test('locks held by this process still block', async () => {
    // GIVEN
    const r = await new RWLock(dir).acquireRead();

    // WHEN
    try {
      await expect(new RWLock(dir).acquireWrite()).rejects.toThrow(/currently reading/);
    } finally {
      await r.release();
    }
  });
});

test('reader locks from two lock objects for the same directory are independent', async () => {
  // GIVEN
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rwlock-readers-'));
  try {
    const r1 = await new RWLock(dir).acquireRead();
    const r2 = await new RWLock(dir).acquireRead();

    // WHEN
    await r2.release();

    // THEN
    await expect(new RWLock(dir).acquireWrite()).rejects.toThrow(/currently reading/);
    await r1.release();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
