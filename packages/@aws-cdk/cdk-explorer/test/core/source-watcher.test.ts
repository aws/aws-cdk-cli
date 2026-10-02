import type { FileWatcher } from '../../lib/core/assembly-watcher';
import { startSourceWatcher } from '../../lib/core/source-watcher';

type AnyListener = (...args: unknown[]) => void;

/** A controllable in-memory stand-in for chokidar's FSWatcher. */
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
    appDir: '/proj',
    onChange,
    onError,
    createWatcher: () => fake,
  });
  return { fake, onChange, onError, watcher };
}

describe('Source Watcher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('fires a single debounced onChange for a burst of source edits', () => {
    const { fake, onChange } = setup();

    fake.emitFile('change', '/proj/lib/stack.ts');
    fake.emitFile('change', '/proj/app.ts');
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('ignores dependencies, synth output, and dotfiles', () => {
    const { fake, onChange } = setup();

    fake.emitFile('change', '/proj/node_modules/pkg/index.js');
    fake.emitFile('change', '/proj/cdk.out/tree.json');
    fake.emitFile('change', '/proj/.git/HEAD');

    jest.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('close stops a pending onChange and closes the underlying watcher', async () => {
    const { fake, onChange, watcher } = setup();

    fake.emitFile('change', '/proj/lib/stack.ts');
    await watcher.close();

    jest.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
    expect(fake.closed).toBe(true);
  });

  test('forwards watcher errors to onError', () => {
    const { fake, onError } = setup();

    fake.emit('error', new Error('boom'));

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  test('forwards an onChange throw to onError instead of leaking from the timer', () => {
    const fake = new FakeWatcher();
    const failure = new Error('handler blew up');
    const onError = jest.fn();
    startSourceWatcher({
      appDir: '/proj',
      onChange: () => {
        throw failure;
      },
      onError,
      createWatcher: () => fake,
    });

    fake.emitFile('change', '/proj/lib/stack.ts');
    expect(() => jest.advanceTimersByTime(200)).not.toThrow();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});
