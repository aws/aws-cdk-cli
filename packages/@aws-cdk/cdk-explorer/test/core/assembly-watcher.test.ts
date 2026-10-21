import { MANIFEST_FILE } from '@aws-cdk/cloud-assembly-api';
import { VALIDATION_REPORT_FILE } from '@aws-cdk/cloud-assembly-schema';
import { startAssemblyWatcher, TREE_FILE, type FileWatcher } from '../../lib/core/assembly-watcher';

// `any[]` rather than `unknown[]`: the stored listeners are invoked with
// whatever the emitting helper passes, and `unknown[]` params are not
// contravariantly compatible with FileWatcher's typed overloads.
type AnyListener = (...args: any[]) => void;

/** A controllable in-memory stand-in for chokidar's FSWatcher. */
class FakeWatcher implements FileWatcher {
  public closed = false;
  private readonly listeners: Record<string, AnyListener[]> = {};

  // Mirror FileWatcher's overloads so the class satisfies the interface; the
  // implementation signature stays permissive because the registry is untyped.
  public on(event: 'all', listener: (eventName: string, filePath: string) => void): FileWatcher;
  public on(event: 'error', listener: (error: unknown) => void): FileWatcher;
  public on(event: string, listener: AnyListener): FileWatcher {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }

  /** Simulate a chokidar 'all' event for the given file. */
  public emitFile(eventName: string, filePath: string): void {
    for (const listener of this.listeners.all ?? []) {
      listener(eventName, filePath);
    }
  }

  /** Simulate any emitted event (e.g. 'error'). */
  public emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners[event] ?? []) {
      listener(...args);
    }
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

function setup() {
  const fake = new FakeWatcher();
  const onChange = jest.fn();
  const onError = jest.fn();
  const onSynthActivity = jest.fn();
  const watcher = startAssemblyWatcher({
    assemblyDir: '/p/cdk.out',
    onChange,
    onError,
    onSynthStart: onSynthActivity,
    createWatcher: () => fake,
  });
  return { fake, onChange, onError, onSynthActivity, watcher };
}

describe('Assembly Watcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('coalesces a burst of assembly file changes into a single onChange', () => {
    const { fake, onChange } = setup();

    fake.emitFile('change', `/p/cdk.out/${MANIFEST_FILE}`);
    fake.emitFile('change', `/p/cdk.out/${TREE_FILE}`);
    fake.emitFile('change', `/p/cdk.out/${VALIDATION_REPORT_FILE}`);
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('ignores RWLock marker files', () => {
    const { fake, onChange } = setup();

    fake.emitFile('add', '/p/cdk.out/synth.lock');
    fake.emitFile('add', '/p/cdk.out/read.12345.1.lock');
    fake.emitFile('unlink', '/p/cdk.out/synth.lock');

    jest.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('reports the write lock (synth.lock) appearing as synth activity', () => {
    const { fake, onChange, onSynthActivity } = setup();

    fake.emitFile('add', '/p/cdk.out/synth.lock');

    expect(onSynthActivity).toHaveBeenCalledTimes(1);
    expect(onSynthActivity).toHaveBeenCalledWith(expect.any(Number));
    // The write lock is never an assembly refresh.
    jest.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('does not report synth activity for a read lock or a lock removal', () => {
    const { fake, onSynthActivity } = setup();

    fake.emitFile('add', '/p/cdk.out/read.12345.1.lock');
    fake.emitFile('unlink', '/p/cdk.out/synth.lock');

    expect(onSynthActivity).not.toHaveBeenCalled();
  });

  test('reports a throwing onSynthActivity through onError', () => {
    const { fake, onError, onSynthActivity } = setup();
    onSynthActivity.mockImplementation(() => {
      throw new Error('boom');
    });

    fake.emitFile('add', '/p/cdk.out/synth.lock');

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });

  test('ignores non-signal files such as templates', () => {
    const { fake, onChange } = setup();

    fake.emitFile('change', '/p/cdk.out/MyStack.template.json');

    jest.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('reacts to nested stage assembly manifests', () => {
    const { fake, onChange } = setup();

    fake.emitFile('add', `/p/cdk.out/assembly-Prod/${MANIFEST_FILE}`);

    jest.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('close stops a pending onChange and closes the underlying watcher', async () => {
    const { fake, onChange, watcher } = setup();

    fake.emitFile('change', `/p/cdk.out/${MANIFEST_FILE}`);
    await watcher.close();

    jest.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
    expect(fake.closed).toBe(true);
  });

  test('forwards watcher errors to onError', () => {
    const fake = new FakeWatcher();
    const onError = jest.fn();
    startAssemblyWatcher({
      assemblyDir: '/p/cdk.out',
      onChange: jest.fn(),
      createWatcher: () => fake,
      onError,
    });

    fake.emit('error', new Error('boom'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  test('forwards an onChange throw to onError instead of leaking from the timer', () => {
    const fake = new FakeWatcher();
    const onError = jest.fn();
    const failure = new Error('refresh blew up');
    startAssemblyWatcher({
      assemblyDir: '/p/cdk.out',
      onChange: () => {
        throw failure;
      },
      createWatcher: () => fake,
      onError,
    });

    fake.emitFile('change', `/p/cdk.out/${MANIFEST_FILE}`);
    expect(() => jest.advanceTimersByTime(200)).not.toThrow();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});
