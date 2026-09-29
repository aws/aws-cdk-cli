import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWrite } from '../lib/integ-test';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-write-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

test('atomicWrite writes the file contents', async () => {
  const target = path.join(dir, 'out.txt');
  await atomicWrite(target, 'hello');
  expect(await fs.readFile(target, 'utf-8')).toBe('hello');
});

test('atomicWrite retries a Windows-style EPERM on rename and still writes the file', async () => {
  // On Windows, renaming onto a destination another worker has open fails with
  // EPERM. When several workers rewrite the same shared log file concurrently
  // this is transient, so atomicWrite must retry rather than propagate it (which
  // is what failed the migrate test on the Windows integ runner).
  const target = path.join(dir, 'shared.md');

  const realRename = fs.rename.bind(fs);
  let epermInjected = 0;
  const spy = jest.spyOn(fs, 'rename').mockImplementation((async (...args: any[]) => {
    // Fail the first rename attempt once, as Windows would under contention.
    if (epermInjected < 1) {
      epermInjected++;
      const e: any = new Error('EPERM: operation not permitted, rename');
      e.code = 'EPERM';
      throw e;
    }
    return realRename(...(args as Parameters<typeof realRename>));
  }) as unknown as typeof fs.rename);

  try {
    await atomicWrite(target, 'body'); // would throw before the fix
    expect(epermInjected).toBe(1);
    expect(await fs.readFile(target, 'utf-8')).toBe('body');
  } finally {
    spy.mockRestore();
  }
});

test('atomicWrite rethrows a non-retryable error', async () => {
  const target = path.join(dir, 'nope.txt');
  const spy = jest.spyOn(fs, 'rename').mockImplementation((async () => {
    const e: any = new Error('ENOSPC: no space left on device');
    e.code = 'ENOSPC';
    throw e;
  }) as unknown as typeof fs.rename);

  try {
    await expect(atomicWrite(target, 'x')).rejects.toThrow('ENOSPC');
  } finally {
    spy.mockRestore();
  }
});
