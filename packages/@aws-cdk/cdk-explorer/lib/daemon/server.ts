import * as fs from 'fs';
import * as net from 'net';
import type {
  ClientMessage,
  DaemonMessage,
} from '../protocol';
import {
  PROTOCOL_VERSION,
} from '../protocol';
import { writeDaemonInfo, removeDaemonInfo } from './info-file';
import { LineParser } from './line-parser';
import { infoPathForProject } from './socket-path';
import { SynthLatch } from './state-machine';

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SYNTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface DaemonServerOptions {
  readonly socketPath: string;
  readonly projectDir: string;
  readonly logFile: string;
  readonly onSynth: (triggerFile: string) => Promise<void>;
  readonly idleTimeoutMs?: number;
  readonly synthTimeoutMs?: number;
}

export class DaemonServer {
  private readonly socketPath: string;
  private readonly projectDir: string;
  private readonly logFile: string;
  private readonly onSynth: (triggerFile: string) => Promise<void>;
  private readonly idleTimeoutMs: number;
  private readonly synthTimeoutMs: number;
  private readonly latch = new SynthLatch();
  private readonly connections = new Set<net.Socket>();
  private readonly subscribers = new Set<net.Socket>();
  private server: net.Server | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private synthTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingTriggerFile: string | undefined;
  private shuttingDown = false;

  constructor(options: DaemonServerOptions) {
    this.socketPath = options.socketPath;
    this.projectDir = options.projectDir;
    this.logFile = options.logFile;
    this.onSynth = options.onSynth;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.synthTimeoutMs = options.synthTimeoutMs ?? DEFAULT_SYNTH_TIMEOUT_MS;
  }

  public async start(): Promise<void> {
    this.server = net.createServer((socket) => this.handleConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.server!.on('error', reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.removeListener('error', reject);
        resolve();
      });
    });

    writeDaemonInfo(infoPathForProject(this.projectDir), {
      pid: process.pid,
      socketPath: this.socketPath,
      version: PROTOCOL_VERSION,
      startedAt: Date.now(),
      logFile: this.logFile,
    });

    this.resetIdleTimer();
  }

  public async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.clearIdleTimer();
    if (this.synthTimer !== undefined) {
      clearTimeout(this.synthTimer);
      this.synthTimer = undefined;
    }
    this.broadcast({ type: 'shuttingDown', reason: 'shutdown requested' });

    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    this.subscribers.clear();

    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });

    this.cleanup();
  }

  private handleConnection(socket: net.Socket): void {
    const parser = new LineParser<ClientMessage>();
    this.connections.add(socket);

    socket.on('data', (data) => {
      const messages = parser.feed(data.toString());
      for (const msg of messages) {
        this.handleMessage(socket, msg);
      }
    });

    socket.on('close', () => {
      this.removeConnection(socket);
    });

    socket.on('error', () => {
      this.removeConnection(socket);
    });
  }

  private removeConnection(socket: net.Socket): void {
    this.connections.delete(socket);
    const wasSubscriber = this.subscribers.delete(socket);
    if (wasSubscriber && this.subscribers.size === 0) {
      this.resetIdleTimer();
    }
  }

  private handleMessage(socket: net.Socket, msg: ClientMessage): void {
    switch (msg.type) {
      case 'handshake':
        this.handleHandshake(socket, msg.version);
        break;
      case 'subscribe':
        this.handleSubscribe(socket);
        break;
      case 'requestSynth':
        this.handleRequestSynth(msg.triggerFile);
        break;
      case 'shutdown':
        void this.stop();
        break;
    }
  }

  private handleHandshake(socket: net.Socket, clientVersion: string): void {
    const accepted = clientVersion === PROTOCOL_VERSION;
    this.send(socket, {
      type: 'handshakeAck',
      version: PROTOCOL_VERSION,
      accepted,
    });

    if (!accepted) {
      void this.stop();
    }
  }

  private handleSubscribe(socket: net.Socket): void {
    this.subscribers.add(socket);
    this.clearIdleTimer();
  }

  private handleRequestSynth(triggerFile: string): void {
    const { shouldStartSynth } = this.latch.requestSynth();
    if (shouldStartSynth) {
      this.runSynth(triggerFile);
    } else {
      this.pendingTriggerFile = triggerFile;
    }
  }

  private runSynth(triggerFile: string): void {
    this.synthTimer = setTimeout(() => {
      this.onSynthSettled(new Error(`Synth timed out after ${this.synthTimeoutMs}ms`));
    }, this.synthTimeoutMs);

    Promise.resolve()
      .then(() => this.onSynth(triggerFile))
      .then(
        () => this.onSynthSettled(undefined),
        (err) => this.onSynthSettled(err),
      );
  }

  private onSynthSettled(error: unknown): void {
    if (this.latch.state === 'idle') return; // guard: already settled (e.g. timeout after completion)

    if (this.synthTimer !== undefined) {
      clearTimeout(this.synthTimer);
      this.synthTimer = undefined;
    }

    const timestamp = Date.now();

    if (error === undefined) {
      this.broadcast({ type: 'synthComplete', timestamp });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      this.broadcast({ type: 'synthFailed', error: message, timestamp });
    }

    const { shouldStartSynth } = this.latch.synthComplete();
    if (shouldStartSynth) {
      this.runSynth(this.pendingTriggerFile ?? '');
      this.pendingTriggerFile = undefined;
    } else if (this.subscribers.size === 0) {
      this.resetIdleTimer();
    }
  }

  private broadcast(msg: DaemonMessage): void {
    for (const socket of this.subscribers) {
      this.send(socket, msg);
    }
  }

  private send(socket: net.Socket, msg: DaemonMessage): void {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(msg) + '\n');
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this.subscribers.size === 0 && !this.shuttingDown && this.latch.state === 'idle') {
      this.idleTimer = setTimeout(() => {
        void this.stop();
      }, this.idleTimeoutMs);
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private cleanup(): void {
    removeDaemonInfo(infoPathForProject(this.projectDir));
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Socket may already be removed
    }
  }
}
