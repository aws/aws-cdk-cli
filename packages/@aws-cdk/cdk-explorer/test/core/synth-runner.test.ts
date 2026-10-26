import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AssemblyError, ContextLookupsDisabledError, LockError, ToolkitError, type Toolkit } from '@aws-cdk/toolkit-lib';
import { runSynth } from '../../lib/core/synth-runner';
import { fakeFromCdkAppDirectory } from '../_helpers/fake-toolkit';

const APP = 'npx tsx bin/app.ts';

interface FakeCachedAssembly {
  dispose: jest.Mock;
}

interface FakeToolkit {
  fromCdkAppDirectory: jest.Mock;
  synth: jest.Mock;
}

function makeToolkit(opts: {
  synthThrow?: unknown;
  disposeThrow?: unknown;
}): { toolkit: FakeToolkit; cached: FakeCachedAssembly } {
  const cached: FakeCachedAssembly = {
    dispose: jest.fn().mockImplementation(() =>
      opts.disposeThrow ? Promise.reject(opts.disposeThrow) : Promise.resolve(),
    ),
  };
  const toolkit: FakeToolkit = {
    fromCdkAppDirectory: jest.fn((appDirectory: string) => fakeFromCdkAppDirectory(appDirectory)),
    synth: jest.fn().mockImplementation(() =>
      opts.synthThrow ? Promise.reject(opts.synthThrow) : Promise.resolve(cached),
    ),
  };
  return { toolkit, cached };
}

const tempDirs: string[] = [];

// Create a throwaway project dir. Pass an object to write its cdk.json
// (`{ app }` for a configured app, `{}` for a cdk.json with no app), or
// `undefined` for no cdk.json at all. runSynth reads the app from this on disk.
function makeProjectDir(cdkJson?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-synth-'));
  tempDirs.push(dir);
  if (cdkJson !== undefined) {
    fs.writeFileSync(path.join(dir, 'cdk.json'), JSON.stringify(cdkJson));
  }
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `abort` cancels the lock-retry wait on shutdown. These tests never abort, but
 * a signal is required, and `retryOnLock` reads it after a failed attempt.
 */
function run(toolkit: FakeToolkit, projectDir: string, abort = new AbortController().signal) {
  return runSynth({ toolkit: toolkit as unknown as Toolkit, projectDir, abort });
}

describe('runSynth', () => {
  test('reads the app from cdk.json, sets the right environment variables, returns success, and disposes the cached assembly', async () => {
    const { toolkit, cached } = makeToolkit({});
    const projectDir = makeProjectDir({ app: APP });

    // WHEN
    await run(toolkit, projectDir);

    // THEN
    expect(cached.dispose).toHaveBeenCalledTimes(1);
  });

  test('returns unavailable when cdk.json has no app', async () => {
    const { toolkit } = makeToolkit({});
    const projectDir = makeProjectDir({});

    const result = await run(toolkit, projectDir);

    expect(result).toEqual({ status: 'unavailable' });
    expect(toolkit.synth).not.toHaveBeenCalled();
  });

  test('returns unavailable when cdk.json is missing entirely', async () => {
    const { toolkit } = makeToolkit({});
    const projectDir = makeProjectDir(undefined);

    const result = await run(toolkit, projectDir);

    expect(result).toEqual({ status: 'unavailable' });
    expect(toolkit.synth).not.toHaveBeenCalled();
  });

  test('classifies AssemblyError as app-failure with the error message', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: AssemblyError.withCause('Assembly builder failed', new Error('TypeError: foo')),
    });

    const result = await run(toolkit, makeProjectDir({ app: APP }));

    expect(result).toEqual({ status: 'app-failure', message: expect.stringContaining('Assembly builder failed'), details: 'TypeError: foo' });
  });

  test.each(['ConcurrentWriteLock', 'ConcurrentReadLock'] as const)('gives up on %s once the caller aborts', async (lockType) => {
    // A lock is transient, so runSynth keeps retrying rather than giving up.
    // An already-aborted signal makes it stop after the first attempt.
    const { toolkit } = makeToolkit({ synthThrow: new LockError(lockType, 'another CLI holding the lock') });
    const aborted = AbortSignal.abort();

    const result = await run(toolkit, makeProjectDir({ app: APP }), aborted);

    expect(result).toEqual({ status: 'error', message: 'This operation was aborted' });
    expect(toolkit.synth).toHaveBeenCalledTimes(0);
  });

  test('retries a lock until it clears, then succeeds', async () => {
    const { toolkit, cached } = makeToolkit({});
    toolkit.synth
      .mockRejectedValueOnce(new LockError('ConcurrentWriteLock', 'another CLI synthing'))
      .mockRejectedValueOnce(new LockError('ConcurrentWriteLock', 'still synthing'))
      .mockResolvedValue(cached);

    const result = await run(toolkit, makeProjectDir({ app: APP }));

    expect(result).toEqual({ status: 'success' });
    expect(toolkit.synth).toHaveBeenCalledTimes(3);
  });

  test('classifies ContextLookupsDisabledError as app-failure with the error message', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: new ContextLookupsDisabledError('Context lookups have been disabled. Run cdk synth in a terminal.'),
    });

    const result = await run(toolkit, makeProjectDir({ app: APP }));

    expect(result).toEqual({ status: 'app-failure', message: expect.stringContaining('cdk.context.json') });
  });

  test('classifies an unknown ToolkitError as error', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: new ToolkitError('SomeUnexpected', 'unexpected'),
    });

    const result = await run(toolkit, makeProjectDir({ app: APP }));

    expect(result).toEqual({ status: 'error', message: 'unexpected' });
  });

  test('classifies a plain Error as error', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: new Error('disk full'),
    });

    const result = await run(toolkit, makeProjectDir({ app: APP }));

    expect(result).toEqual({ status: 'error', message: 'disk full' });
  });

  test('returns error when dispose fails after a successful synth', async () => {
    const { toolkit, cached } = makeToolkit({
      disposeThrow: new Error('lock release failed'),
    });

    const result = await run(toolkit, makeProjectDir({ app: APP }));

    expect(result).toEqual({ status: 'error', message: 'lock release failed' });
    expect(cached.dispose).toHaveBeenCalledTimes(1);
  });
});
