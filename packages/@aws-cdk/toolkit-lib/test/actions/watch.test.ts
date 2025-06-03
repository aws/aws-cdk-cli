// We need to mock the chokidar library, used by 'cdk watch'
// This needs to happen ABOVE the import statements due to quirks with how jest works
// Apparently, they hoist jest.mock commands just below the import statements so we
// need to make sure that the constants they access are initialized before the imports.
const mockChokidarWatcherOn = jest.fn();
const mockChokidarWatcherClose = jest.fn();
const mockChokidarWatcherUnref = jest.fn();
const fakeChokidarWatcher = {
  on: mockChokidarWatcherOn,
  close: mockChokidarWatcherClose,
  unref: mockChokidarWatcherUnref,
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
} satisfies Partial<ReturnType<typeof import('chokidar')['watch']>>;
const fakeChokidarWatcherOn = {
  get readyCallback(): () => Promise<void> {
    expect(mockChokidarWatcherOn.mock.calls.length).toBeGreaterThanOrEqual(1);
    // The call to the first 'watcher.on()' in the production code is the one we actually want here.
    // This is a pretty fragile, but at least with this helper class,
    // we would have to change it only in one place if it ever breaks
    const firstCall = mockChokidarWatcherOn.mock.calls[0];
    // let's make sure the first argument is the 'ready' event,
    // just to be double safe
    expect(firstCall[0]).toBe('ready');
    // the second argument is the callback
    return firstCall[1];
  },

  get fileEventCallback(): (
  event: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir',
  path: string,
  ) => Promise<void> {
    expect(mockChokidarWatcherOn.mock.calls.length).toBeGreaterThanOrEqual(2);
    const secondCall = mockChokidarWatcherOn.mock.calls[1];
    // let's make sure the first argument is not the 'ready' event,
    // just to be double safe
    expect(secondCall[0]).not.toBe('ready');
    // the second argument is the callback
    return secondCall[1];
  },
};

const mockChokidarWatch = jest.fn();
jest.mock('chokidar', () => ({
  watch: mockChokidarWatch,
}));

import * as path from 'node:path';
import type { DeploymentMethod } from '../../lib/actions/deploy';
import { Toolkit } from '../../lib/toolkit';
import { builderFixture, disposableCloudAssemblySource, TestIoHost } from '../_helpers';

const ioHost = new TestIoHost();
const toolkit = new Toolkit({ ioHost });
const deploySpy = jest.spyOn(toolkit as any, '_deploy').mockResolvedValue({});

beforeEach(() => {
  ioHost.notifySpy.mockClear();
  ioHost.requestSpy.mockClear();
  jest.clearAllMocks();

  mockChokidarWatch.mockReturnValue(fakeChokidarWatcher);
  // on() in chokidar's Watcher returns 'this'
  mockChokidarWatcherOn.mockReturnValue(fakeChokidarWatcher);
});

describe('watch', () => {
  test('no include & no exclude results in error', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    await expect(async () => toolkit.watch(cx, {})).rejects.toThrow(/Cannot use the 'watch' command without specifying at least one directory to monitor. Make sure to add a \"watch\" key to your cdk.json/);
  });

  test('observes cwd as default rootdir', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    ioHost.level = 'debug';
    await toolkit.watch(cx, {
      include: [],
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'watch',
      level: 'debug',
      message: expect.stringContaining(`root directory used for 'watch' is: ${process.cwd()}`),
    }));
  });

  test('dot files, dot directories, node_modules by default', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    ioHost.level = 'debug';
    await toolkit.watch(cx, {
      exclude: [],
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'watch',
      level: 'debug',
      code: 'CDK_TOOLKIT_I5310',
      message: expect.stringContaining('\'exclude\' patterns for \'watch\': ["**/.*","**/.*/**","**/node_modules/**"]'),
    }));
  });

  test('ignores outdir when under the watch dir', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    const assembly = await toolkit.synth(cx);
    const outdir = (await assembly.produce()).cloudAssembly.directory;
    const watchDir = path.normalize(outdir + path.sep + '..');

    ioHost.level = 'debug';
    await toolkit.watch(assembly, {
      watchDir,
      exclude: [],
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'watch',
      level: 'debug',
      code: 'CDK_TOOLKIT_I5310',
      message: expect.stringContaining(`'exclude' patterns for 'watch': ["${path.basename(outdir)}/**","**/.*","**/.*/**","**/node_modules/**"]`),
    }));
  });

  test('can include specific files', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    ioHost.level = 'debug';
    await toolkit.watch(cx, {
      include: ['index.ts'],
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'watch',
      level: 'debug',
      message: expect.stringContaining('\'include\' patterns for \'watch\': ["index.ts"]'),
    }));
  });

  test('can exclude specific files', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    ioHost.level = 'debug';
    await toolkit.watch(cx, {
      exclude: ['index.ts'],
    });

    // THEN
    expect(ioHost.notifySpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'watch',
      level: 'debug',
      message: expect.stringContaining('\'exclude\' patterns for \'watch\': ["index.ts"'),
    }));
  });

  test('can trace logs', async () => {
    // GIVEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    ioHost.level = 'debug';
    const watcher = await toolkit.watch(cx, {
      include: [],
      traceLogs: true,
    });

    // WHEN
    await fakeChokidarWatcherOn.readyCallback();

    // THEN
    expect(deploySpy).toHaveBeenCalledWith(expect.anything(), 'watch', expect.objectContaining({
      cloudWatchLogMonitor: expect.anything(), // Not undefined
    }));

    const logMonitorSpy = jest.spyOn((deploySpy.mock.calls[0]?.[2] as any).cloudWatchLogMonitor, 'deactivate');

    // Deactivate the watcher and cloudWatchLogMonitor that we created, otherwise the tests won't exit
    await watcher.dispose();

    // ensure the log monitor has been closed
    expect(logMonitorSpy).toHaveBeenCalled();
  });

  test('watch returns an object that can be used to stop the watch', async () => {
    const cx = await builderFixture(toolkit, 'stack-with-role');

    const watcher = await toolkit.watch(cx, { include: [] });

    expect(mockChokidarWatcherClose).not.toHaveBeenCalled();
    expect(mockChokidarWatcherUnref).not.toHaveBeenCalled();

    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    await Promise.all([
      watcher.waitForEnd(),
      watcher.dispose(),
    ]);

    expect(mockChokidarWatcherClose).toHaveBeenCalled();
    expect(mockChokidarWatcherUnref).toHaveBeenCalled();
  });

  describe.each<[DeploymentMethod, string]>([
    [{ method: 'hotswap', fallback: { method: 'change-set' } }, 'on'],
    [{ method: 'hotswap' }, 'on'],
    [{ method: 'change-set' }, 'off'],
  ])('%p mode', (deploymentMethod, userAgent) => {
    test('passes through the correct hotswap mode to deployStack()', async () => {
      // GIVEN
      const cx = await builderFixture(toolkit, 'stack-with-role');
      ioHost.level = 'warn';
      await toolkit.watch(cx, {
        include: [],
        deploymentMethod,
      });

      // WHEN
      await fakeChokidarWatcherOn.readyCallback();

      // THEN
      expect(deploySpy).toHaveBeenCalledWith(expect.anything(), 'watch', expect.objectContaining({
        deploymentMethod: deploymentMethod,
        extraUserAgent: `cdk-watch/hotswap-${userAgent}`,
      }));
    });
  });

  test('defaults hotswap to hotswap only deployment', async () => {
    // WHEN
    const cx = await builderFixture(toolkit, 'stack-with-role');
    ioHost.level = 'warn';
    await toolkit.watch(cx, {
      include: [],
      deploymentMethod: undefined,
    });

    await fakeChokidarWatcherOn.readyCallback();

    // THEN
    expect(deploySpy).toHaveBeenCalledWith(expect.anything(), 'watch', expect.objectContaining({
      deploymentMethod: { method: 'hotswap' },
      extraUserAgent: 'cdk-watch/hotswap-on',
    }));
  });

  test('action disposes of assembly produced by source', async () => {
    // GIVEN
    const [assemblySource, mockDispose, realDispose] = await disposableCloudAssemblySource(toolkit);

    // WHEN
    const watcher = await toolkit.watch(assemblySource, {
      include: [],
      deploymentMethod: undefined,
    });
    await watcher.dispose();

    // THEN
    expect(mockDispose).toHaveBeenCalled();
    await realDispose();
  });
});

// @todo unit test watch with file events
