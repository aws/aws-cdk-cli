import { once } from 'node:events';
import * as net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import * as chalk from 'chalk';
import type { LeakedHandleTracker } from '../../lib/cli/debug-handles';
import { trackLeakedHandles } from '../../lib/cli/debug-handles';
import { TestIoHost, expectIoMsg } from '../_helpers/io-host';

// What the report prints when it finds nothing. It still says something: the
// report only runs because the process was alive, so "no leaks" means the cause
// is outside what we track.
const NOTHING_FOUND = [
  'The CLI process is still alive, but no tracked handle explains it.',
  'The cause may be a handle opened before tracking started, or a type this build does not track.',
];

let ioHost: TestIoHost;
let tracker: LeakedHandleTracker;

beforeEach(() => {
  // The report is debug detail, which the host filters out at its default of
  // 'info'. In the real CLI `--debug-cli` raises the level to match.
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
 * Some report branches cannot be reached by creating real handles: the state (a
 * garbage collected handle, an unreadable source file) can't be forced from a
 * test.
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

test('captures deep enough to reach application code behind Node internals', async () => {
  const server = net.createServer();
  await once(server.listen(0), 'listening');
  const { port } = server.address() as net.AddressInfo;

  tracker = trackLeakedHandles();

  // A socket is created ~9 frames deep inside node:net, node:_http_agent and
  // node:tls before any application frame appears. At Node's default
  // stackTraceLimit of 10 every captured frame is an internal one, so the report
  // has nothing actionable to show. Nesting the call proves we capture past that.
  const openDeep = (depth: number): net.Socket =>
    depth === 0 ? net.connect(port, '127.0.0.1') : openDeep(depth - 1);
  const client = openDeep(12);

  try {
    await once(client, 'connect');
    await tracker.report(ioHost.asHelper());

    // All 13 nesting frames, so the capture reached well past the default of 10.
    const ourFrames = reportedLines().filter((l) => l.includes('openDeep'));
    expect(ourFrames.length).toBeGreaterThan(10);
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

  expect(reportedLines()).toEqual(NOTHING_FOUND);
});

test('says so explicitly when no tracked handle explains the hang', async () => {
  tracker = trackLeakedHandles();

  // Nothing is created after tracking starts, so nothing should be holding the
  // loop open. Printing nothing at all would read as a broken flag, so the report
  // has to say that it looked and came up empty.
  await tracker.report(ioHost.asHelper());

  expect(reportedLines()).toEqual(NOTHING_FOUND);
});

test('does not report promises or tick objects, which are pure noise', async () => {
  tracker = trackLeakedHandles();

  // Every await creates promises and tick objects, tens of thousands of them in a
  // real synth. Capturing a stack for each would dominate the flag's cost and
  // bury the actual leak.
  for (let i = 0; i < 50; i++) {
    await delay(1);
  }
  await tracker.report(ioHost.asHelper());

  const lines = reportedLines();
  expect(lines.some((l) => l.includes('PROMISE'))).toBe(false);
  expect(lines.some((l) => l.includes('TickObject'))).toBe(false);
});

test('emits the report at debug level, not info', async () => {
  tracker = trackLeakedHandles();

  // The whole report is debug output. At info it would print during ordinary runs
  // of any command that happens to leave a handle open.
  await tracker.report(ioHost.asHelper());

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

  expect(reportedLines()).toEqual(NOTHING_FOUND);
});

test('excludes handles that have already been garbage collected', async () => {
  tracker = trackLeakedHandles();

  // We hold handles weakly so tracking doesn't keep them alive. A collected
  // handle is by definition no longer keeping the loop open.
  injectWatched(tracker, { type: 'TCPWRAP', deref: () => undefined });
  await tracker.report(ioHost.asHelper());

  expect(reportedLines()).toEqual(NOTHING_FOUND);
});

test('says so when a handle was opened entirely inside Node internals', async () => {
  tracker = trackLeakedHandles();

  // With no application frames there is no location to print, so the report has
  // to explain the absence rather than leave an empty stack behind a heading.
  injectWatched(tracker, { type: 'TCPWRAP' });
  await tracker.report(ioHost.asHelper());

  const lines = reportedLines();
  expect(lines).toContainEqual(chalk.bold('# TCPWRAP (open network connection)'));
  expect(lines).toContain('  (opened entirely inside Node internals, no CLI frames to show)');
  expect(lines).not.toContain('  call stack:');
});

test('still prints the location of a frame whose source file cannot be read', async () => {
  tracker = trackLeakedHandles();

  // Bundled and eval'd frames have file names that don't exist on disk. The
  // location identifies the frame, so it must appear even with no line of code
  // to show beneath it.
  injectWatched(tracker, {
    type: 'TCPWRAP',
    creationStack: [{ func: 'openSocket', file: '/does/not/exist.ts', line: 1 }],
  });
  await tracker.report(ioHost.asHelper());

  const lines = reportedLines();
  expect(lines).toContain('  created in openSocket()');
  expect(lines).toContain('  call stack:');
  expect(lines).toContain('    openSocket (/does/not/exist.ts:1)');
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

    expect(reportedLines().length).toBeGreaterThan(0);
  } finally {
    jest.useRealTimers();
  }
});
