// We need to mock the chokidar library, used by 'cdk watch'
// This needs to happen ABOVE the import statements due to quirks with how jest works
// Apparently, they hoist jest.mock commands just below the import statements so we
// need to make sure that the constants they access are initialized before the imports.
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
const validateSpy = jest.spyOn(toolkit, 'validate').mockResolvedValue({
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
    expect(validateSpy).toHaveBeenCalledWith(cx, expect.objectContaining({
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

    // Simulate a slow validation so subsequent changes queue up
    let resolveValidation!: () => void;
    validateSpy.mockImplementationOnce(() => new Promise((resolve) => {
      resolveValidation = () => resolve({ conclusion: 'success', pluginReports: [] });
    }));

    // WHEN: a file change starts the slow validation ...
    const firstEvent = fakeChokidarWatcherOn.fileEventCallback('change', 'file1.ts');
    await new Promise((r) => setTimeout(r, 10));

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
});
