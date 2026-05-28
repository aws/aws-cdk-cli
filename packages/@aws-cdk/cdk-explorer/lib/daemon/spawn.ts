import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { DaemonConnection } from './connect';
import { connectToDaemon } from './connect';
import { readDaemonInfo, removeDaemonInfo } from './info-file';
import {
  socketPathForProject,
  lockPathForProject,
  infoPathForProject,
  logPathForProject,
} from './socket-path';

const SPAWN_POLL_INTERVAL_MS = 10;
const SPAWN_TIMEOUT_MS = 5000;

export interface AcquireDaemonOptions {
  readonly projectDir: string;
}

/**
 * Acquires a daemon connection for the given project directory,
 * spawning one if not already running.
 *
 * Uses an exclusive lock file to prevent concurrent spawns.
 * If a daemon is already running, connects to it directly.
 */
export async function acquireDaemon(options: AcquireDaemonOptions): Promise<DaemonConnection> {
  const { projectDir } = options;

  // daemon already running
  try {
    return await connectToDaemon(projectDir);
  } catch {
    // Connection failed, need to spawn or clean up
  }

  const lockPath = lockPathForProject(projectDir);
  const lockFd = acquireLock(lockPath);

  try {
    // Re-check after acquiring lock (another process may have won the race)
    try {
      return await connectToDaemon(projectDir);
    } catch {
      // Still not running, so we need to spawn
    }

    await cleanupStaleState(projectDir);
    await spawnDaemon(projectDir);
    return await connectToDaemon(projectDir);
  } finally {
    releaseLock(lockFd, lockPath);
  }
}

function acquireLock(lockPath: string): number {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, String(process.pid));
    return fd;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const stalePid = readLockPid(lockPath);
      if (stalePid === undefined || !isProcessAlive(stalePid)) {
        // PID is unreadable/garbage OR process is dead → stale lock
        try {
          fs.unlinkSync(lockPath);
          const fd = fs.openSync(lockPath, 'wx');
          fs.writeSync(fd, String(process.pid));
          return fd;
        } catch {
          throw new Error('Another process is spawning the daemon');
        }
      }
      throw new Error('Another process is spawning the daemon');
    }
    throw err;
  }
}

function releaseLock(fd: number, lockPath: string): void {
  fs.closeSync(fd);
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Best effort, safe because aquireLock guarantees we don't keep lock indefinitely
  }
}

function readLockPid(lockPath: string): number | undefined {
  try {
    const content = fs.readFileSync(lockPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? undefined : pid;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanupStaleState(projectDir: string): Promise<void> {
  const socketPath = socketPathForProject(projectDir);
  const infoPath = infoPathForProject(projectDir);

  const info = readDaemonInfo(infoPath);
  if (info && isProcessAlive(info.pid)) {
    try {
      process.kill(info.pid, 'SIGTERM');
    } catch {
    }
    await waitForProcessExit(info.pid, 2000);
  }

  removeDaemonInfo(infoPath);
  try {
    fs.unlinkSync(socketPath);
  } catch {
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await sleep(50);
  }
}

async function spawnDaemon(projectDir: string): Promise<void> {
  const entryPath = path.resolve(__dirname, 'entry.js');
  const logPath = logPathForProject(projectDir);
  const logFd = fs.openSync(logPath, 'a');

  const child = child_process.spawn(
    process.execPath,
    [entryPath, '--project-dir', projectDir],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  );
  child.unref();
  fs.closeSync(logFd);

  await waitForSocket(projectDir);
}

async function waitForSocket(projectDir: string): Promise<void> {
  const socketPath = socketPathForProject(projectDir);
  const deadline = Date.now() + SPAWN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) {
      // Socket file exists — try to connect to verify it's listening
      try {
        const conn = await connectToDaemon(projectDir);
        conn.close();
        return;
      } catch {
        // Not ready yet
      }
    }
    await sleep(SPAWN_POLL_INTERVAL_MS);
  }

  throw new Error(`Daemon failed to start within ${SPAWN_TIMEOUT_MS}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
