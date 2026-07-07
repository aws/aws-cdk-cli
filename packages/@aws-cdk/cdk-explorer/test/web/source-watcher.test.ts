import type { FileWatcher } from '../../lib/core/assembly-watcher';
import { startSourceWatcher } from '../../lib/web/source-watcher';

type AnyListener = (...args: unknown[]) => void;

class FakeWatcher implements FileWatcher {
  public closed = false;
  private readonly listeners: Record<string, AnyListener[]> = {};

  public on(event: string, listener: AnyListener): FileWatcher {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }

  public emitFile(eventName: string, filePath: string): void {
    for (const listener of this.listeners.all ?? []) {
      listener(eventName, filePath);
    }
  }

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
  const watcher = startSourceWatcher({
    appDir: '/project',
    onChange,
    onError,
    createWatcher: () => fake,
  });
  return { fake, onChange, onError, watcher };
}

describe('Source Watcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('debounces rapid file changes into a single onChange', () => {
    const { fake, onChange } = setup();

    fake.emitFile('change', '/project/src/app.ts');
    fake.emitFile('change', '/project/src/stack.ts');
    fake.emitFile('change', '/project/lib/construct.ts');
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('ignores excluded paths but triggers on real source changes', () => {
    const { fake, onChange } = setup();

    // node_modules, cdk.out, and dotfiles must never trigger a synth. cdk.out is
    // the critical one: firing on it would loop, since synth writes cdk.out.
    fake.emitFile('add', '/project/node_modules/foo/index.js');
    fake.emitFile('change', '/project/cdk.out/manifest.json');
    fake.emitFile('add', '/project/.git/HEAD');
    jest.advanceTimersByTime(200);
    expect(onChange).not.toHaveBeenCalled();

    fake.emitFile('change', '/project/src/app.ts');
    jest.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('resets debounce timer on each new event', () => {
    const { fake, onChange } = setup();

    fake.emitFile('change', '/project/src/app.ts');
    jest.advanceTimersByTime(150);
    expect(onChange).not.toHaveBeenCalled();

    fake.emitFile('change', '/project/src/stack.ts');
    jest.advanceTimersByTime(150);
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('close cancels pending onChange and closes the underlying watcher', async () => {
    const { fake, onChange, watcher } = setup();

    fake.emitFile('change', '/project/src/app.ts');
    await watcher.close();

    jest.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
    expect(fake.closed).toBe(true);
  });

  test('ignores events after close', async () => {
    const { fake, onChange, watcher } = setup();

    await watcher.close();
    fake.emitFile('change', '/project/src/app.ts');

    jest.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('forwards watcher errors to onError', () => {
    const { fake, onError } = setup();

    fake.emit('error', new Error('watch failed'));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  test('forwards onChange throw to onError', () => {
    const fake = new FakeWatcher();
    const failure = new Error('handler blew up');
    const onError = jest.fn();
    startSourceWatcher({
      appDir: '/project',
      onChange: () => {
        throw failure;
      },
      onError,
      createWatcher: () => fake,
    });

    fake.emitFile('change', '/project/src/app.ts');
    expect(() => jest.advanceTimersByTime(200)).not.toThrow();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});
