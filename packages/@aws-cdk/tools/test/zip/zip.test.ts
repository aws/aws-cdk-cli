import { exec as _exec } from 'child_process';
import * as crypto from 'crypto';
import { constants, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as jszip from 'jszip';
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
