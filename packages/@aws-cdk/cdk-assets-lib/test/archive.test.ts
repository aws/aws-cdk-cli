import { exec as _exec } from 'child_process';
import * as crypto from 'crypto';
import { constants, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as jszip from 'jszip';
import { zipDirectory } from '../lib/private/archive';
import { rmRfSync } from '../lib/private/fs-extra';
const exec = promisify(_exec);

function eventEmitter(x: string) {
  // eslint-disable-next-line no-console
  console.log(x);
}

test('zipDirectory can take a directory and produce a zip from it', async () => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test.archive'));
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test.archive.extract'));
  try {
    const zipFile = path.join(stagingDir, 'output.zip');
    const originalDir = path.join(__dirname, 'test-archive');
    await zipDirectory(originalDir, zipFile, { eventEmitter });

    // unzip and verify that the resulting tree is the same
    await exec(`unzip ${zipFile}`, { cwd: extractDir });

    await expect(exec(`diff -bur ${originalDir} ${extractDir}`)).resolves.toBeTruthy();

    // inspect the zip file to check that dates are reset
    const zip = await fs.readFile(zipFile);
    const zipData = await jszip.loadAsync(zip);
    const dates = Object.values(zipData.files).map((file) => file.date.toISOString());
    expect(dates[0]).toBe('1980-01-01T00:00:00.000Z');
    expect(new Set(dates).size).toBe(1);

    // check that mode is preserved
    const stat = await fs.stat(path.join(extractDir, 'executable.txt'));
    const isExec =
      // eslint-disable-next-line no-bitwise
      stat.mode & constants.S_IXUSR ||
      // eslint-disable-next-line no-bitwise
      stat.mode & constants.S_IXGRP ||
      // eslint-disable-next-line no-bitwise
      stat.mode & constants.S_IXOTH;
    expect(isExec).toBeTruthy();
  } finally {
    rmRfSync(stagingDir);
    rmRfSync(extractDir);
  }
});

test('md5 hash of a zip stays consistent across invocations', async () => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test.archive'));
  const zipFile1 = path.join(stagingDir, 'output.zip');
  const zipFile2 = path.join(stagingDir, 'output.zip');
  const originalDir = path.join(__dirname, 'test-archive');
  await zipDirectory(originalDir, zipFile1, { eventEmitter });
  await new Promise((ok) => setTimeout(ok, 2000)); // wait 2s
  await zipDirectory(originalDir, zipFile2, { eventEmitter });

  const hash1 = contentHash(await fs.readFile(zipFile1));
  const hash2 = contentHash(await fs.readFile(zipFile2));

  expect(hash1).toEqual(hash2);
});

test('zipDirectory follows symlinks', async () => {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test.archive'));
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test.archive.symlink'));
  try {
    const originalDir = path.join(stagingDir, 'data');
    await fs.mkdir(path.join(originalDir, 'dir'), { recursive: true });
    await fs.writeFile(path.join(originalDir, 'dir', 'one.txt'), 'one');
    await fs.symlink('dir', path.join(originalDir, 'dirlink'));
    await fs.symlink('dir/one.txt', path.join(originalDir, 'filelink'));
    const zipFile = path.join(stagingDir, 'output.zip');

    await zipDirectory(originalDir, zipFile, { eventEmitter });
    await exec(`unzip ${zipFile}`, { cwd: extractDir });

    expect((await fs.lstat(path.join(extractDir, 'filelink'))).isFile()).toBe(true);
    expect(await fs.readFile(path.join(extractDir, 'filelink'), 'utf-8')).toBe('one');
    expect((await fs.lstat(path.join(extractDir, 'dirlink'))).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(extractDir, 'dirlink', 'one.txt'), 'utf-8')).toBe('one');
  } finally {
    rmRfSync(stagingDir);
    rmRfSync(extractDir);
  }
});

function contentHash(data: string | Buffer | DataView) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
