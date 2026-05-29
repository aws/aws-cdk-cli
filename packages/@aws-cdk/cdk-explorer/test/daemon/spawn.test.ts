import * as fs from 'fs';
import type { DaemonConnection } from '../../lib/daemon/connect';
import {
  socketPathForProject,
  infoPathForProject,
  logPathForProject,
} from '../../lib/daemon/socket-path';
import { acquireDaemon } from '../../lib/daemon/spawn';

const TEST_PROJECT = `/tmp/cdk-spawn-test-${process.pid}-${Date.now()}`;

describe('acquireDaemon', () => {
  let connections: DaemonConnection[] = [];

  afterEach(async () => {
    for (const conn of connections) {
      conn.send({ type: 'shutdown' });
      conn.close();
    }
    connections = [];

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 200));

    // Clean up any leftover files
    const socketPath = socketPathForProject(TEST_PROJECT);
    for (const p of [socketPath, socketPath + '.lock', socketPath + '.info', socketPath + '.log']) {
      try {
        fs.unlinkSync(p);
      } catch {
      }
    }
  });

  test('spawns daemon and returns connected client', async () => {
    const conn = await acquireDaemon({ projectDir: TEST_PROJECT });
    connections.push(conn);

    expect(conn).toBeDefined();
    expect(typeof conn.send).toBe('function');
    expect(typeof conn.close).toBe('function');
  }, 10_000);

  test('creates info file with daemon metadata', async () => {
    const conn = await acquireDaemon({ projectDir: TEST_PROJECT });
    connections.push(conn);

    const infoPath = infoPathForProject(TEST_PROJECT);
    const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
    expect(info.pid).toBeGreaterThan(0);
    expect(info.socketPath).toBe(socketPathForProject(TEST_PROJECT));
    expect(info.version).toBe('1');
  }, 10_000);

  test('creates log file', async () => {
    const conn = await acquireDaemon({ projectDir: TEST_PROJECT });
    connections.push(conn);

    const logPath = logPathForProject(TEST_PROJECT);
    expect(fs.existsSync(logPath)).toBe(true);
  }, 10_000);

  test('second call reuses existing daemon (singleton)', async () => {
    const conn1 = await acquireDaemon({ projectDir: TEST_PROJECT });
    connections.push(conn1);

    const infoPath = infoPathForProject(TEST_PROJECT);
    const pid1 = JSON.parse(fs.readFileSync(infoPath, 'utf-8')).pid;

    const conn2 = await acquireDaemon({ projectDir: TEST_PROJECT });
    connections.push(conn2);

    const pid2 = JSON.parse(fs.readFileSync(infoPath, 'utf-8')).pid;
    expect(pid2).toBe(pid1);
  }, 10_000);

  test('can exchange messages with spawned daemon', async () => {
    const conn = await acquireDaemon({ projectDir: TEST_PROJECT });
    connections.push(conn);

    conn.send({ type: 'subscribe' });
    conn.send({ type: 'requestSynth' });

    const iterator = conn.messages[Symbol.asyncIterator]();
    const result = await iterator.next();
    expect(result.done).toBe(false);
    expect(result.value.type).toBe('synthComplete');
  }, 10_000);
});
