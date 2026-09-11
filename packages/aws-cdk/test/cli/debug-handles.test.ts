import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as tls from 'node:tls';
import * as chalk from 'chalk';
import type { LeakedHandleTracker } from '../../lib/cli/debug-handles';
import { trackLeakedHandles } from '../../lib/cli/debug-handles';
import { TestIoHost, expectIoMsg } from '../_helpers/io-host';

// What the report prints when it finds nothing. It still says something: the
// report only runs because the process was alive, so "no leaks" means the cause
// is outside what we track. The middle line quotes Node's own live-resource list,
// which depends on what the test runner has open, so it is matched loosely.
const NOTHING_FOUND = [
  'The CLI process is still alive, but no tracked handle explains it.',
  expect.stringMatching(/^Node reports these resources still active: /),
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

// The report is emitted as a single multi-line message, so that unrelated output
// cannot interleave into the middle of a stack trace. Split it back up, since
// what the assertions care about is the individual lines.
function reportedLines(): string[] {
  return ioHost.notifySpy.mock.calls.flatMap((call) => (call[0].message as string).split('\n'));
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
  creationStack?: Array<{ func: string; file: string; line: number; column: number }>;
}): void {
  const internals = into as unknown as { watched: Map<number, unknown> };
  internals.watched.set(-1 - internals.watched.size, {
    type: resource.type,
    handleRef: { deref: resource.deref ?? (() => ({ hasRef: () => true })) },
    creationStack: resource.creationStack ?? [],
  });
}

// Let an already-started async report run to completion. The report awaits once
// to emit, then `scheduleReport` chains a `.catch()`, and neither promise is
// returned to the caller, so there is nothing to await directly.
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
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

test('reports the whole thing as one message so nothing can interleave into a stack', async () => {
  tracker = trackLeakedHandles();

  // A stack trace split across hundreds of separate messages is a stack trace
  // that other output can land in the middle of, which is exactly what happens
  // during a hang: this report is competing with whatever else is still running.
  const leaked = setInterval(() => {
  }, 60_000);
  await tracker.report(ioHost.asHelper());
  clearInterval(leaked);

  expect(ioHost.notifySpy).toHaveBeenCalledTimes(1);
  expect(reportedLines().length).toBeGreaterThan(1);
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

test('locates each frame by column as well as line', async () => {
  tracker = trackLeakedHandles();

  // In the published CLI every frame points into one bundled, minified file, so
  // the line number barely discriminates between frames and the column is the
  // only thing that says where on the line the call actually was.
  const noop = () => undefined;
  function openTwoTimersOnOneLine(): NodeJS.Timeout[] {
    return [setInterval(noop, 60_000), setInterval(noop, 60_000)];
  }
  const leaked = openTwoTimersOnOneLine();
  await tracker.report(ioHost.asHelper());
  leaked.forEach(clearInterval);

  const frames = reportedLines().filter((l) => l.includes('openTwoTimersOnOneLine ('));
  expect(frames.length).toBe(2);
  for (const frame of frames) {
    expect(frame).toMatch(/\(.+:\d+:\d+\)$/);
  }
  // Both calls are on one source line, so without the column the two frames would
  // print identically and the report could not tell them apart.
  const lineNumbers = frames.map((f) => f.replace(/:\d+\)$/, ''));
  expect(new Set(lineNumbers).size).toBe(1);
  expect(new Set(frames).size).toBe(2);
});

test('shows a window around the column when the source line is minified', async () => {
  tracker = trackLeakedHandles();

  // The published CLI is bundled with whitespace minified away and no source
  // map, so a "line" can be hundreds of kilobytes. Printing its start would show
  // some unrelated module every time; the column is what makes it useful.
  const dir = mkdtempSync(path.join(tmpdir(), 'cdk-debug-handles-'));
  const file = path.join(dir, 'bundle.js');
  const needle = 'net.connect(HERE)';
  const padding = 'x'.repeat(400);
  writeFileSync(file, `${padding}${needle}${padding}\n`);

  injectWatched(tracker, {
    type: 'TCPWRAP',
    creationStack: [{ func: 'openSocket', file, line: 1, column: padding.length + 1 }],
  });
  await tracker.report(ioHost.asHelper());

  const lines = reportedLines();
  expect(lines.some((l) => l.includes(needle))).toBe(true);
  // Elided on both sides rather than truncated at the end.
  expect(lines.some((l) => l.includes('…') && l.includes(needle))).toBe(true);
  // And the reader is told the locations are bundle positions, not source ones.
  expect(lines).toContain('Locations above are positions in the bundled CLI, not in the original source files.');
});

test('does not claim locations are bundle positions when reading real source', async () => {
  tracker = trackLeakedHandles();

  // The note is only true of a bundled CLI. Printing it against a normal source
  // tree would send the reader looking for a bundle that isn't there.
  const leaked = setInterval(() => {
  }, 60_000);
  await tracker.report(ioHost.asHelper());
  clearInterval(leaked);

  expect(reportedLines().some((l) => l.includes('positions in the bundled CLI'))).toBe(false);
});

test('does not report a handle that cannot confirm it is holding the loop', async () => {
  tracker = trackLeakedHandles();

  // TLSWRAP is the real case: it has no hasRef() to ask and never fires its
  // destroy hook, so treating "cannot tell" as "leaked" reports every completed
  // HTTPS request forever. The CLI makes many of those, so this is the
  // difference between a diagnostic and a page of confident noise.
  injectWatched(tracker, { type: 'TCPWRAP', deref: () => ({}) });
  await tracker.report(ioHost.asHelper());

  expect(reportedLines()).toEqual(NOTHING_FOUND);
});

test('does not report a TLS connection that has finished', async () => {
  const server = net.createServer((s) => s.end());
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const { port } = server.address() as net.AddressInfo;

  tracker = trackLeakedHandles();

  // Creates a real TLSWRAP. No certificate is needed: a failed handshake creates
  // the same resource, and the point is only what survives in the tracker.
  function openTlsThenClose(): tls.TLSSocket {
    const socket = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false });
    socket.on('error', () => undefined);
    return socket;
  }
  const socket = openTlsThenClose();
  socket.destroy();
  // Wait for the teardown to finish. Mid-teardown the TCP socket underneath is
  // still legitimately holding the loop, and the real report has a grace period
  // for exactly that reason.
  await once(socket, 'close');

  try {
    await tracker.report(ioHost.asHelper());

    expect(reportedLines().some((l) => l.includes('TLSWRAP'))).toBe(false);
    expect(reportedLines().some((l) => l.includes('openTlsThenClose'))).toBe(false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('does not report a timer that has already fired', async () => {
  tracker = trackLeakedHandles();

  // A fired one-shot timer is not holding the loop open, and timers are the most
  // common resource in the CLI, so counting them would swamp the report. Other
  // timers (jest's own) are legitimately live, so this pins the assertion to the
  // frame of our own fired one rather than to the type name.
  function scheduleShortLivedTimer(done: () => void) {
    setTimeout(done, 1);
  }
  await new Promise<void>((resolve) => scheduleShortLivedTimer(resolve));
  await tracker.report(ioHost.asHelper());

  expect(reportedLines().some((l) => l.includes('scheduleShortLivedTimer'))).toBe(false);
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
    creationStack: [{ func: 'openSocket', file: '/does/not/exist.ts', line: 1, column: 7 }],
  });
  await tracker.report(ioHost.asHelper());

  const lines = reportedLines();
  expect(lines).toContain('  created in openSocket()');
  expect(lines).toContain('  call stack:');
  expect(lines).toContain('    openSocket (/does/not/exist.ts:1:7)');
});

test('says when it stopped recording, so a capped list is not read as a complete one', async () => {
  tracker = trackLeakedHandles();

  // A long-running command opens handles continuously, so provenance is capped
  // to keep the footprint bounded. A truncated list that looks complete would
  // send the reader after the wrong handle.
  (tracker as unknown as { atCapacity: boolean }).atCapacity = true;
  injectWatched(tracker, { type: 'TCPWRAP' });
  await tracker.report(ioHost.asHelper());

  expect(reportedLines().some((l) => /^Stopped recording after \d+ handles/.test(l))).toBe(true);
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

test('scheduleReport swallows a failure rather than crashing the process it is watching', async () => {
  // The report runs detached, after the command has finished, so a rejection has
  // nowhere to go and would surface as an unhandled rejection — which, on modern
  // Node, terminates the process. A diagnostic must never do that.
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  jest.useFakeTimers();
  try {
    tracker = trackLeakedHandles();
    ioHost.notifySpy.mockImplementation(() => {
      throw new Error('io is gone');
    });

    tracker.scheduleReport(ioHost.asHelper());
    jest.advanceTimersByTime(1000);
    await drainMicrotasks();

    // The emit was attempted and failed, so the catch is what stopped it here.
    expect(ioHost.notifySpy).toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  } finally {
    jest.useRealTimers();
    process.off('unhandledRejection', onUnhandled);
  }
});
