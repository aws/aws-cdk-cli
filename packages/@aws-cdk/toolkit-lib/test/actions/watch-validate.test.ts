// We need to mock the chokidar library, used by 'cdk watch'
// This needs to happen ABOVE the import statements because
// jest.mock commands are hoisted just below the import statements,
// which would otherwise bring in the real chokidar.
const mockChokidarWatcherOn = jest.fn();
const mockChokidarWatcherClose = jest.fn();
const fakeChokidarWatcher = {
  on: mockChokidarWatcherOn,
  close: mockChokidarWatcherClose,
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
} satisfies Partial<ReturnType<typeof import('chokidar')['watch']>>;
const fakeChokidarWatcherOn = {
  get readyCallback(): () => Promise<void> {
    expect(mockChokidarWatcherOn.mock.calls.length).toBeGreaterThanOrEqual(1);
    const firstCall = mockChokidarWatcherOn.mock.calls[0];
    expect(firstCall[0]).toBe('ready');
    return firstCall[1];
  },

  get fileEventCallback(): (
  event: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir',
  path: string,
  ) => Promise<void> {
    expect(mockChokidarWatcherOn.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondCall = mockChokidarWatcherOn.mock.calls[1];
    expect(secondCall[0]).not.toBe('ready');
    return secondCall[1];
  },
};

const mockChokidarWatch = jest.fn();
jest.mock('chokidar', () => ({
  watch: mockChokidarWatch,
}));

import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, TestIoHost } from '../_helpers';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });
// watchValidate reuses the assembly produced by the watch loop and calls the
// private `_validate(assembly, options)` directly, so we spy on that.
const validateSpy = jest.spyOn(toolkit as any, '_validate').mockResolvedValue({
  conclusion: 'success',
  pluginReports: [],
});
const deploySpy = jest.spyOn(toolkit as any, '_deploy').mockResolvedValue({});

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
  jest.clearAllMocks();

  mockChokidarWatch.mockReturnValue(fakeChokidarWatcher);
  // on() in chokidar's Watcher returns 'this'
  mockChokidarWatcherOn.mockReturnValue(fakeChokidarWatcher);
});

describe('watchValidate', () => {
  test('runs an initial validation on the ready event', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.watchValidate(cx, { include: [] });

    // WHEN
    await fakeChokidarWatcherOn.readyCallback();

    // THEN
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });

  test('validates again on a file change', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.watchValidate(cx, { include: [] });
    await fakeChokidarWatcherOn.readyCallback();

    // WHEN
    await fakeChokidarWatcherOn.fileEventCallback('change', 'app.ts');

    // THEN
    expect(validateSpy).toHaveBeenCalledTimes(
      1 // from ready event
      + 1, // from file event
    );
  });

  test('never deploys', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.watchValidate(cx, { include: [] });

    // WHEN
    await fakeChokidarWatcherOn.readyCallback();
    await fakeChokidarWatcherOn.fileEventCallback('change', 'app.ts');

    // THEN
    expect(deploySpy).not.toHaveBeenCalled();
  });

  test('passes validate options through to each invocation', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const options = {
      include: [],
      online: false,
      stacks: { patterns: ['Stack1'], strategy: StackSelectionStrategy.PATTERN_MATCH },
    };
    await toolkit.watchValidate(cx, options);

    // WHEN
    await fakeChokidarWatcherOn.readyCallback();

    // THEN
    // match anything but null or undefined, since we are only testing for options here
    expect(validateSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      online: false,
      stacks: { patterns: ['Stack1'], strategy: StackSelectionStrategy.PATTERN_MATCH },
    }));
  });

  test('keeps watching after a validation error', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    validateSpy.mockRejectedValueOnce(new Error('synth failed mid-edit'));
    await toolkit.watchValidate(cx, { include: [] });

    // WHEN: the initial validation fails ...
    await fakeChokidarWatcherOn.readyCallback();

    // THEN: the error is reported ...
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: expect.stringContaining('synth failed mid-edit'),
    }));

    // ... and the loop is still alive: the next file change validates again
    await fakeChokidarWatcherOn.fileEventCallback('change', 'app.ts');
    expect(validateSpy).toHaveBeenCalledTimes(2);
  });

  test('batches file changes that arrive during a validation', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await toolkit.watchValidate(cx, { include: [] });
    await fakeChokidarWatcherOn.readyCallback();

    // Simulate a slow validation so subsequent changes queue up. `started`
    // resolves once the validation is actually running (each iteration first
    // synthesizes, so we cannot rely on a fixed delay), and `resolveValidation`
    // lets us release it on demand.
    let resolveValidation!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    validateSpy.mockImplementationOnce(() => new Promise((resolve) => {
      resolveValidation = () => resolve({ conclusion: 'success', pluginReports: [] });
      signalStarted();
    }));

    // WHEN: a file change starts the slow validation ...
    const firstEvent = fakeChokidarWatcherOn.fileEventCallback('change', 'file1.ts');
    await started;

    // ... and more changes arrive while it is still running
    const queuedEvents = [
      fakeChokidarWatcherOn.fileEventCallback('change', 'file2.ts'),
      fakeChokidarWatcherOn.fileEventCallback('unlink', 'file3.ts'),
    ];

    resolveValidation();
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all([firstEvent, ...queuedEvents]);

    // THEN: the queued changes are batched into a single follow-up validation
    expect(validateSpy).toHaveBeenCalledTimes(
      1 // from ready event
      + 1 // from the first file event
      + 1, // from the batched queued events
    );
  });

  test('returns a watcher that can be disposed', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const watcher = await toolkit.watchValidate(cx, { include: [] });

    expect(mockChokidarWatcherClose).not.toHaveBeenCalled();

    // WHEN
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all([
      watcher.waitForEnd(),
      watcher.dispose(),
    ]);

    // THEN
    expect(mockChokidarWatcherClose).toHaveBeenCalled();
  });

  test('reuses the startup assembly for the initial validation, re-produces on file changes', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const produceSpy = jest.spyOn(cx, 'produce');

    await toolkit.watchValidate(cx, { include: [] });

    // WHEN: initial validation (ready event) ...
    await fakeChokidarWatcherOn.readyCallback();
    const producesAfterReady = produceSpy.mock.calls.length;

    // ... then two file-change iterations
    await fakeChokidarWatcherOn.fileEventCallback('change', 'app.ts');
    await fakeChokidarWatcherOn.fileEventCallback('change', 'lib.ts');
    const producesTotal = produceSpy.mock.calls.length;

    // THEN: the initial validation reuses the assembly produced at watch startup
    // (fresh by definition), so no extra synth happens for it; every file-change
    // iteration re-produces so the changes are picked up.
    expect(validateSpy).toHaveBeenCalledTimes(3);
    expect(producesAfterReady).toBe(1); // startup produce, reused by the initial validation
    expect(producesTotal).toBe(3); // startup + one per file-change iteration
  });
});
