import { once } from 'node:events';
import * as net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import * as chalk from 'chalk';
import type { LeakedHandleTracker } from '../../lib/cli/debug-handles';
import { trackLeakedHandles } from '../../lib/cli/debug-handles';
import { TestIoHost, expectIoMsg } from '../_helpers/io-host';

let ioHost: TestIoHost;
let tracker: LeakedHandleTracker;

beforeEach(() => {
  // The report is emitted at debug level, which the host filters out at its
  // default of 'info'.
  ioHost = new TestIoHost('debug');
});

afterEach(() => {
  // Leave no hook enabled behind, even if the test failed before reporting.
  tracker?.stop();
});

// The text of every message the report emitted, in order.
function reportedLines(): string[] {
  return ioHost.notifySpy.mock.calls.map((call) => call[0].message as string);
}

/**
 * Put a resource into the tracker's watch list directly.
 *
 * Some report branches cannot be reached by creating real handles: the resource
 * types are Node internals we can't conjure, or the state (a garbage collected
 * handle, an unreadable source file) can't be forced from a test.
 */
function injectWatched(into: LeakedHandleTracker, resource: {
  type: string;
  deref?: () => { hasRef?(): boolean } | undefined;
  creationStack?: Array<{ func: string; file: string; line: number }>;
}): void {
  const internals = into as unknown as { watched: Map<number, unknown> };
  internals.watched.set(-1 - internals.watched.size, {
    type: resource.type,
    handleRef: { deref: resource.deref ?? (() => ({ hasRef: () => true })) },
    creationStack: resource.creationStack ?? [],
  });
}

// Let an already-started async report run to completion. The report awaits once
// per line emitted, and `scheduleReport` discards the promise, so there is
// nothing to await directly.
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await Promise.resolve();
  }
}

test('reports a leaked timer with its type, plain-language description, and creation site', async () => {
  tracker = trackLeakedHandles();

  const leaked = setInterval(() => {
  }, 60_000);
  await tracker.report(ioHost.asHelper());
  clearInterval(leaked);

  const lines = reportedLines();
  expect(lines[0]).toMatch(/^\d+ handles? still keeping the CLI process alive:$/);
  // The type heading is emitted via chalk.bold, so match it the same way to stay
  // independent of whether color is active in the test environment.
  expect(lines).toContainEqual(chalk.bold('# Timeout (timer from setTimeout or setInterval)'));
  // The report shows a call stack with the line of code that created the handle.
  expect(lines).toContain('  call stack:');
  expect(lines.some((l) => l.includes('setInterval'))).toBe(true);
});

test('reports a leaked TCP connection as an open network connection', async () => {
  const server = net.createServer();
  await once(server.listen(0), 'listening');
  const { port } = server.address() as net.AddressInfo;

  // Tracking must start before the connection is created, otherwise the socket
  // is never seen. This mirrors how the flag is enabled at CLI startup.
  tracker = trackLeakedHandles();
  const client = net.connect(port, '127.0.0.1');
  try {
    await once(client, 'connect');
    await tracker.report(ioHost.asHelper());

    expect(reportedLines().some((l) => l.includes('(open network connection)'))).toBe(true);
  } finally {
    client.destroy();
    server.close();
    await once(server, 'close');
  }
});

test('excludes handles that have been unref()ed', async () => {
  tracker = trackLeakedHandles();

  // unref() means the handle is not keeping the loop alive, so it must be excluded.
  const unrefed = setInterval(() => {
  }, 60_000);
  unrefed.unref();
  await tracker.report(ioHost.asHelper());
  clearInterval(unrefed);

  expect(reportedLines()).toEqual(['0 handles still keeping the CLI process alive:']);
});

test('reports zero handles on a clean exit with nothing left open', async () => {
  tracker = trackLeakedHandles();

  // Nothing is created after tracking starts, so nothing should be holding the
  // loop open: the report is just the header with a count of zero.
  await tracker.report(ioHost.asHelper());

  expect(reportedLines()).toEqual(['0 handles still keeping the CLI process alive:']);
});

test('does not report promises, which are filtered as noise', async () => {
  tracker = trackLeakedHandles();

  // Every await creates promises; none of them should show up in the report.
  for (let i = 0; i < 50; i++) {
    await delay(1);
  }
  await tracker.report(ioHost.asHelper());

  expect(reportedLines().some((l) => l.includes('PROMISE'))).toBe(false);
});

test('emits the report at debug level, not info', async () => {
  tracker = trackLeakedHandles();

  await tracker.report(ioHost.asHelper());

  // The whole report is debug output. Emitting at info would print it during
  // ordinary runs of any command that happens to leave a handle open.
  expect(ioHost.notifySpy).toHaveBeenCalledWith(expectIoMsg(expect.any(String), 'debug'));
  expect(ioHost.notifySpy).not.toHaveBeenCalledWith(expectIoMsg(expect.any(String), 'info'));
});

test('reports nothing until tracking is started', async () => {
  // Importing the module must not enable the hook: a resource created before
  // trackLeakedHandles() runs is invisible to the tracker.
  const before = setInterval(() => {
  }, 60_000);
  tracker = trackLeakedHandles();
  await tracker.report(ioHost.asHelper());
  clearInterval(before);

  expect(reportedLines()).toEqual(['0 handles still keeping the CLI process alive:']);
});

test('describes an unknown resource type without a description', async () => {
  tracker = trackLeakedHandles();

  // Node's set of async resource types grows over time. An unrecognised type
  // must still be reported, just without the plain-language explanation.
  injectWatched(tracker, { type: 'SOMETHINGNEW' });
  await tracker.report(ioHost.asHelper());

  const lines = reportedLines();
  expect(lines).toContainEqual(chalk.bold('# SOMETHINGNEW'));
  expect(lines).toContain('  (no application stack frames)');
});

test('excludes handles that have already been garbage collected', async () => {
  tracker = trackLeakedHandles();

  // We hold handles weakly so tracking doesn't keep them alive. A collected
  // handle is by definition no longer keeping the loop open.
  injectWatched(tracker, { type: 'TCPWRAP', deref: () => undefined });
  await tracker.report(ioHost.asHelper());

  expect(reportedLines()).toEqual(['0 handles still keeping the CLI process alive:']);
});

test('still reports a handle whose source file cannot be read', async () => {
  tracker = trackLeakedHandles();

  // Bundled and eval'd frames have file names that don't exist on disk. The
  // location is worth reporting even when we can't show the line of code.
  injectWatched(tracker, {
    type: 'TCPWRAP',
    creationStack: [{ func: 'openSocket', file: '/does/not/exist.ts', line: 1 }],
  });
  await tracker.report(ioHost.asHelper());

  const lines = reportedLines();
  expect(lines).toContain('  created in openSocket()');
  expect(lines).toContain('  call stack:');
});

test('scheduleReport stays silent until the grace period has passed', async () => {
  jest.useFakeTimers();
  try {
    tracker = trackLeakedHandles();
    tracker.scheduleReport(ioHost.asHelper());

    // A CLI that exits within the grace period must print nothing at all.
    await drainMicrotasks();
    expect(ioHost.notifySpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    await drainMicrotasks();

    expect(reportedLines()[0]).toMatch(/still keeping the CLI process alive:$/);
  } finally {
    jest.useRealTimers();
  }
});
