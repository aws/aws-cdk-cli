import { once } from 'node:events';
import * as net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { enableHandleTracking, reportLeakedHandles, resetHandleTracking } from '../../lib/cli/debug-handles';
import { TestIoHost } from '../_helpers/io-host';

let ioHost: TestIoHost;

beforeEach(() => {
  // The tracker is a module singleton; reset it so each test starts clean.
  resetHandleTracking();
  ioHost = new TestIoHost();
});

afterEach(() => {
  resetHandleTracking();
});

// The text of every message the report emitted, in order.
function reportedLines(): string[] {
  return ioHost.notifySpy.mock.calls.map((call) => call[0].message as string);
}

test('reports a leaked timer with its type, plain-language description, and creation site', async () => {
  enableHandleTracking();

  const leaked = setInterval(() => {
  }, 60_000);
  await reportLeakedHandles(ioHost.asHelper());
  clearInterval(leaked);

  const lines = reportedLines();
  expect(lines[0]).toMatch(/^\d+ handle\(s\) still keeping the CLI process alive:$/);
  expect(lines).toContainEqual('# Timeout (timer from setTimeout or setInterval)');
  // A creation site is reported as `file:line`. Which frame ends up on top of the
  // stack depends on the async call path, so we assert the shape, not the file.
  expect(lines.some((l) => /^ {2}created at .+:\d+$/.test(l))).toBe(true);
});

test('reports a leaked TCP connection as an open network connection', async () => {
  const server = net.createServer();
  await once(server.listen(0), 'listening');
  const { port } = server.address() as net.AddressInfo;

  // Tracking must start before the connection is created, otherwise the socket
  // is never seen — this mirrors how the flag is enabled at CLI startup.
  enableHandleTracking();
  const client = net.connect(port, '127.0.0.1');
  try {
    await once(client, 'connect');
    await reportLeakedHandles(ioHost.asHelper());

    expect(reportedLines().some((l) => l.includes('(open network connection)'))).toBe(true);
  } finally {
    client.destroy();
    server.close();
    await once(server, 'close');
  }
});

test('excludes handles that have been unref()ed', async () => {
  enableHandleTracking();

  // unref() means the handle is not keeping the loop alive, so it must be excluded.
  const unrefed = setInterval(() => {
  }, 60_000);
  unrefed.unref();
  await reportLeakedHandles(ioHost.asHelper());
  clearInterval(unrefed);

  expect(reportedLines()).toEqual(['0 handle(s) still keeping the CLI process alive:']);
});

test('does not report promises, which are filtered as noise', async () => {
  enableHandleTracking();

  // Every await creates promises; none of them should show up in the report.
  for (let i = 0; i < 50; i++) {
    await delay(1);
  }
  await reportLeakedHandles(ioHost.asHelper());

  expect(reportedLines().some((l) => l.includes('PROMISE'))).toBe(false);
});
