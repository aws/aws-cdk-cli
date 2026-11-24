import { exec as _exec } from 'child_process';
import * as crypto from 'crypto';
import { constants, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { globSync } from 'fast-glob';
import * as jszip from 'jszip';
import * as timezoneMock from 'timezone-mock';
import { zipDirectory, zipString } from '../../lib/zip';

const exec = promisify(_exec);

jest.mock('fast-glob', () => {
  const actual = jest.requireActual('fast-glob');
  return { ...actual, globSync: jest.fn(actual.globSync) };
});

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

  test('follows a symlink to a file', async () => {
    if (os.platform() === 'win32') return;

    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'target.txt'), 'target-content');
    await fs.symlink('target.txt', path.join(srcDir, 'link.txt'));

    const zipFile = path.join(stagingDir, 'out.zip');
    await zipDirectory(srcDir, zipFile);

    await exec(`unzip ${zipFile}`, { cwd: extractDir });
    const link = path.join(extractDir, 'link.txt');
    expect((await fs.lstat(link)).isFile()).toBe(true);
    expect(await fs.readFile(link, 'utf-8')).toBe('target-content');
  });

  test('follows a symlink to a directory', async () => {
    if (os.platform() === 'win32') return;

    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(path.join(srcDir, 'dir'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'dir', 'inner.txt'), 'inner-content');
    await fs.symlink('dir', path.join(srcDir, 'dirlink'));

    const zipFile = path.join(stagingDir, 'out.zip');
    await zipDirectory(srcDir, zipFile);

    const zipData = await jszip.loadAsync(await fs.readFile(zipFile));
    expect(Object.keys(zipData.files).sort()).toEqual(['dir/inner.txt', 'dirlink/inner.txt']);
  });

  test('follows symlinks pointing outside the directory by default', async () => {
    if (os.platform() === 'win32') return;

    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(stagingDir, 'outside.txt'), 'outside-content');
    await fs.symlink(path.join(stagingDir, 'outside.txt'), path.join(srcDir, 'link.txt'));

    const zipFile = path.join(stagingDir, 'out.zip');
    await zipDirectory(srcDir, zipFile);

    const zipData = await jszip.loadAsync(await fs.readFile(zipFile));
    expect(await zipData.files['link.txt'].async('string')).toBe('outside-content');
  });

  describe('rejectExternalSymlinks', () => {
    test('accepts symlinks to files and directories inside the directory', async () => {
      if (os.platform() === 'win32') return;

      const srcDir = path.join(stagingDir, 'src');
      await fs.mkdir(path.join(srcDir, 'dir'), { recursive: true });
      await fs.writeFile(path.join(srcDir, 'dir', 'inner.txt'), 'inner-content');
      await fs.symlink('dir', path.join(srcDir, 'dirlink'));
      await fs.symlink('dir/inner.txt', path.join(srcDir, 'filelink'));

      const zipFile = path.join(stagingDir, 'out.zip');
      await zipDirectory(srcDir, zipFile, { rejectExternalSymlinks: true });

      const zipData = await jszip.loadAsync(await fs.readFile(zipFile));
      expect(Object.keys(zipData.files).sort()).toEqual(['dir/inner.txt', 'dirlink/inner.txt', 'filelink']);
    });

    test('accepts internal symlinks when the directory itself is reached through a symlink', async () => {
      if (os.platform() === 'win32') return;

      const realDir = path.join(stagingDir, 'real');
      await fs.mkdir(path.join(realDir, 'asset'), { recursive: true });
      await fs.writeFile(path.join(realDir, 'asset', 'file.txt'), 'content');
      await fs.symlink('file.txt', path.join(realDir, 'asset', 'link.txt'));
      // Both a symlinked parent and a symlinked asset directory
      await fs.symlink(realDir, path.join(stagingDir, 'parentlink'));
      await fs.symlink(path.join(stagingDir, 'parentlink', 'asset'), path.join(stagingDir, 'assetlink'));

      for (const dir of [path.join(stagingDir, 'parentlink', 'asset'), path.join(stagingDir, 'assetlink')]) {
        const zipFile = path.join(stagingDir, 'out.zip');
        await zipDirectory(dir, zipFile, { rejectExternalSymlinks: true });

        const zipData = await jszip.loadAsync(await fs.readFile(zipFile));
        expect(Object.keys(zipData.files).sort()).toEqual(['file.txt', 'link.txt']);
      }
    });

    test('accepts a file whose name starts with ".."', async () => {
      const srcDir = path.join(stagingDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.writeFile(path.join(srcDir, '..dotted'), 'x');

      await expect(zipDirectory(srcDir, path.join(stagingDir, 'out.zip'), { rejectExternalSymlinks: true })).resolves.toBeUndefined();
    });

    test.each([
      ['file', 'outside.txt'],
      ['directory', 'outside-dir'],
    ])('rejects a symlink to a %s outside the directory and cleans up', async (_, target) => {
      if (os.platform() === 'win32') return;

      const srcDir = path.join(stagingDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      await fs.mkdir(path.join(stagingDir, 'outside-dir'));
      await fs.writeFile(path.join(stagingDir, 'outside-dir', 'f.txt'), 'x');
      await fs.writeFile(path.join(stagingDir, 'outside.txt'), 'x');
      await fs.symlink(`../${target}`, path.join(srcDir, 'link'));

      const zipFile = path.join(stagingDir, 'out.zip');
      await expect(zipDirectory(srcDir, zipFile, { rejectExternalSymlinks: true })).rejects.toThrow(/points outside it: link/);
      expect((await fs.readdir(stagingDir)).sort()).toEqual(['outside-dir', 'outside.txt', 'src']);
    });
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
      await zipDirectory(srcDir, zipFile, { eventEmitter: (m) => events.push(m) });
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

    expect(await fs.readdir(stagingDir)).toEqual(['src']);
  });

  test.each(['readFile', 'stat'] as const)('rejects and cleans up when %s fails', async (method) => {
    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'a.txt'), 'a');
    await fs.writeFile(path.join(srcDir, 'secret'), 's');
    const zipFile = path.join(stagingDir, 'out.zip');

    const real = fs[method] as (...args: any[]) => Promise<any>;
    const spy = jest.spyOn(fs, method).mockImplementation(async (file: any, ...rest: any[]) => {
      if (String(file).endsWith('secret')) {
        const err: NodeJS.ErrnoException = new Error('permission denied');
        err.code = 'EACCES';
        throw err;
      }
      return real(file, ...rest);
    });

    try {
      await expect(zipDirectory(srcDir, zipFile)).rejects.toThrow('permission denied');
    } finally {
      spy.mockRestore();
    }

    expect(await fs.readdir(stagingDir)).toEqual(['src']);
  });

  test('rejects when listing the directory fails', async () => {
    const zipFile = path.join(stagingDir, 'out.zip');
    jest.mocked(globSync).mockImplementationOnce(() => {
      throw new Error('cannot list');
    });

    await expect(zipDirectory(stagingDir, zipFile)).rejects.toThrow('cannot list');

    expect(await fs.readdir(stagingDir)).toEqual([]);
  });

  test('rejects when the output file cannot be written', async () => {
    const srcDir = path.join(stagingDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'a.txt'), 'a');

    await expect(zipDirectory(srcDir, path.join(stagingDir, 'missing', 'out.zip'))).rejects.toThrow(/ENOENT/);
    expect(await fs.readdir(stagingDir)).toEqual(['src']);
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
