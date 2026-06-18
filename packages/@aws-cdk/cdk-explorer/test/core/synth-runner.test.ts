import { AssemblyError, ContextLookupsDisabledError, LockError, ToolkitError, type Toolkit } from '@aws-cdk/toolkit-lib';
import { runSynth } from '../../lib/core/synth-runner';

interface FakeCachedAssembly {
  dispose: jest.Mock;
}

interface FakeToolkit {
  fromCdkApp: jest.Mock;
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
    fromCdkApp: jest.fn().mockResolvedValue({}),
    synth: jest.fn().mockImplementation(() =>
      opts.synthThrow ? Promise.reject(opts.synthThrow) : Promise.resolve(cached),
    ),
  };
  return { toolkit, cached };
}

function run(toolkit: FakeToolkit) {
  return runSynth({
    toolkit: toolkit as unknown as Toolkit,
    projectDir: '/p',
    app: 'npx ts-node bin/app.ts',
  });
}

describe('runSynth', () => {
  test('returns success and disposes the cached assembly', async () => {
    const { toolkit, cached } = makeToolkit({});

    const result = await run(toolkit);

    expect(result).toEqual({ status: 'success' });
    expect(toolkit.fromCdkApp).toHaveBeenCalledWith('npx ts-node bin/app.ts', { workingDirectory: '/p', lookups: false });
    expect(cached.dispose).toHaveBeenCalledTimes(1);
  });

  test('classifies AssemblyError as app-failure with the error message', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: AssemblyError.withCause('Assembly builder failed', new Error('TypeError: foo')),
    });

    const result = await run(toolkit);

    expect(result).toEqual({ status: 'app-failure', message: expect.stringContaining('Assembly builder failed'), details: 'TypeError: foo' });
  });

  test('classifies ConcurrentWriteLock as lock-conflict', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: new LockError('ConcurrentWriteLock', 'another CLI synthing'),
    });

    const result = await run(toolkit);

    expect(result).toEqual({ status: 'lock-conflict' });
  });

  test('classifies ConcurrentReadLock as lock-conflict', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: new LockError('ConcurrentReadLock', 'another CLI reading'),
    });

    const result = await run(toolkit);

    expect(result).toEqual({ status: 'lock-conflict' });
  });

  test('classifies ContextLookupsDisabledError as app-failure with the error message', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: new ContextLookupsDisabledError('Context lookups have been disabled. Run cdk synth in a terminal.'),
    });

    const result = await run(toolkit);

    expect(result).toEqual({ status: 'app-failure', message: expect.stringContaining('cdk.context.json') });
  });

  test('classifies an unknown ToolkitError as error', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: new ToolkitError('SomeUnexpected', 'unexpected'),
    });

    const result = await run(toolkit);

    expect(result).toEqual({ status: 'error', message: 'unexpected' });
  });

  test('classifies a plain Error as error', async () => {
    const { toolkit } = makeToolkit({
      synthThrow: new Error('disk full'),
    });

    const result = await run(toolkit);

    expect(result).toEqual({ status: 'error', message: 'disk full' });
  });

  test('returns error when dispose fails after a successful synth', async () => {
    const { toolkit, cached } = makeToolkit({
      disposeThrow: new Error('lock release failed'),
    });

    const result = await run(toolkit);

    expect(result).toEqual({ status: 'error', message: 'lock release failed' });
    expect(cached.dispose).toHaveBeenCalledTimes(1);
  });
});
