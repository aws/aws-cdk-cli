import { exec as _exec } from 'child_process';
import * as crypto from 'crypto';
import { constants, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as jszip from 'jszip';
import * as timezoneMock from 'timezone-mock';
import { zipDirectory, zipString } from '../../lib/zip';

const exec = promisify(_exec);

function contentHash(data: string | Buffer | DataView) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

describe('zipDirectory', () => {
  let stagingDir: string;
  let extractDir: string;

  beforeEach(async () => {
    stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-staging-'));
    extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-extract-'));
  });

  afterEach(async () => {
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.rm(extractDir, { recursive: true, force: true });
  });

  test('zips a directory, preserves content, mode, and resets dates', async () => {
    // Arrange
    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(path.join(srcDir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'file1.txt'), 'content1');
    await fs.writeFile(path.join(srcDir, 'sub', 'file2.txt'), 'content2');
    const execFile = path.join(srcDir, 'run.sh');
    await fs.writeFile(execFile, '#!/bin/sh\necho hi');
    await fs.chmod(execFile, 0o755);
    const zipFile = path.join(stagingDir, 'out.zip');

    // Act
    await zipDirectory(srcDir, zipFile);

    // Assert content
    await exec(`unzip ${zipFile}`, { cwd: extractDir });
    await expect(exec(`diff -bur ${srcDir} ${extractDir}`)).resolves.toBeTruthy();

    // Dates reset to deterministic epoch
    const zipData = await jszip.loadAsync(await fs.readFile(zipFile));
    const dates = Object.values(zipData.files).map((f) => f.date.toISOString());
    expect(new Set(dates).size).toBe(1);
    expect(dates[0]).toBe('1980-01-01T00:00:00.000Z');

    // Executable bit preserved
    const stat = await fs.stat(path.join(extractDir, 'run.sh'));
    // eslint-disable-next-line no-bitwise
    expect(!!(stat.mode & (constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH))).toBe(true);
  });

  test('produces the same hash for the same content (deterministic)', async () => {
    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'a.txt'), 'a');
    const zip1 = path.join(stagingDir, '1.zip');
    const zip2 = path.join(stagingDir, '2.zip');

    await zipDirectory(srcDir, zip1);
    await new Promise((ok) => setTimeout(ok, 50));
    await zipDirectory(srcDir, zip2);

    expect(contentHash(await fs.readFile(zip1))).toEqual(contentHash(await fs.readFile(zip2)));
  });

  test('follows symlinks', async () => {
    if (os.platform() === 'win32') return;

    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const target = path.join(stagingDir, 'target.txt');
    await fs.writeFile(target, 'target-content');
    await fs.symlink(target, path.join(srcDir, 'link.txt'));

    const zipFile = path.join(stagingDir, 'out.zip');
    await zipDirectory(srcDir, zipFile);

    await exec(`unzip ${zipFile}`, { cwd: extractDir });
    const content = await fs.readFile(path.join(extractDir, 'link.txt'), 'utf-8');
    expect(content).toBe('target-content');
  });

  test('retries on EPERM and reports via eventEmitter', async () => {
    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'a.txt'), 'a');
    const zipFile = path.join(stagingDir, 'out.zip');
    const events: string[] = [];

    const realRename = fs.rename;
    let calls = 0;
    const spy = jest.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      calls++;
      if (calls === 1) {
        const err: NodeJS.ErrnoException = new Error('permission denied');
        err.code = 'EPERM';
        throw err;
      }
      return realRename(from, to);
    });

    try {
      await zipDirectory(srcDir, zipFile, (m) => events.push(m));
    } finally {
      spy.mockRestore();
    }

    expect(events).toEqual(['permission denied']);
    await expect(fs.stat(zipFile)).resolves.toBeDefined();
  });

  test('rethrows non-EPERM rename errors', async () => {
    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'a.txt'), 'a');
    const zipFile = path.join(stagingDir, 'out.zip');

    const spy = jest.spyOn(fs, 'rename').mockImplementation(async () => {
      const err: NodeJS.ErrnoException = new Error('disk full');
      err.code = 'ENOSPC';
      throw err;
    });

    try {
      await expect(zipDirectory(srcDir, zipFile)).rejects.toThrow('disk full');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('zipString', () => {
  test('produces a zip buffer containing the given file', async () => {
    const buf = await zipString('hello.txt', 'hello world');
    const zip = await jszip.loadAsync(buf);
    const entry = zip.files['hello.txt'];
    expect(entry).toBeDefined();
    expect(await entry.async('string')).toBe('hello world');
    expect(entry.date.toISOString()).toBe('1980-01-01T00:00:00.000Z');
  });

  test('is deterministic for the same input', async () => {
    const a = await zipString('f.txt', 'same');
    const b = await zipString('f.txt', 'same');
    expect(contentHash(a)).toEqual(contentHash(b));
  });
});

describe('timezone independence (regression)', () => {
  // Regression guard: the produced archive must be byte-for-byte identical and
  // its entry dates must reset to the fixed epoch regardless of the machine's
  // timezone. A previous implementation derived the entry timestamp from a UTC
  // instant, which yazl re-encodes using *local* time components, so archives
  // built in a non-UTC timezone (e.g. Australia/Adelaide, +09:30) came out with
  // shifted timestamps and different bytes — breaking cross-machine asset
  // hashing.
  //
  // `timezone-mock` patches the global `Date` to simulate a zone. Because the
  // epoch is built lazily inside `zipString`, simulating the zone around the
  // call is enough — no module reloading is needed (and reloading would crash
  // yazl, which builds out-of-range `Date`s at module load that timezone-mock
  // rejects). Jest fake timers cannot be used here: they mock the clock, not
  // the timezone offset.
  afterEach(() => {
    timezoneMock.unregister();
  });

  async function zipUnderTimezone(zone: timezoneMock.TimeZone): Promise<{ hash: string; date: string }> {
    let buffer: Buffer;
    timezoneMock.register(zone);
    try {
      buffer = await zipString('hello.txt', 'hello world');
    } finally {
      timezoneMock.unregister();
    }
    // Read back with the real Date so the decoded date is interpreted consistently.
    const date = (await jszip.loadAsync(buffer)).files['hello.txt'].date.toISOString();
    return { hash: contentHash(buffer), date };
  }

  test('resets dates and produces identical bytes across timezones', async () => {
    const utc = await zipUnderTimezone('UTC');
    const adelaide = await zipUnderTimezone('Australia/Adelaide'); // +09:30 (half-hour offset)
    const pacific = await zipUnderTimezone('US/Pacific'); // negative offset

    // The readable entry date is always the fixed epoch ...
    for (const result of [utc, adelaide, pacific]) {
      expect(result.date).toBe('1980-01-01T00:00:00.000Z');
    }

    // ... and the raw archive bytes are identical regardless of timezone, so
    // asset hashes stay stable across machines.
    expect(adelaide.hash).toBe(utc.hash);
    expect(pacific.hash).toBe(utc.hash);
  });
});
