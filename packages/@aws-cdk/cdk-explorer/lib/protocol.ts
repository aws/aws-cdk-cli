/**
 * Wire protocol for the CDK synth daemon.
 *
 * Transport: Unix domain socket (macOS/Linux), named pipe (Windows).
 * Framing: newline-delimited JSON — each message is JSON.stringify(msg) + '\n'.
 */

// ---------------------------------------------------------------------------
// Client to Daemon messages
// ---------------------------------------------------------------------------

export interface RequestSynthMessage {
  readonly type: 'requestSynth';
  readonly triggerFile: string;
}

export interface SubscribeMessage {
  readonly type: 'subscribe';
}

export interface HandshakeMessage {
  readonly type: 'handshake';
  readonly version: string;
}

export interface ShutdownMessage {
  readonly type: 'shutdown';
}

export type ClientMessage =
  | RequestSynthMessage
  | SubscribeMessage
  | HandshakeMessage
  | ShutdownMessage;

// ---------------------------------------------------------------------------
// Daemon to Client messages
// ---------------------------------------------------------------------------

export interface SynthCompleteMessage {
  readonly type: 'synthComplete';
  readonly timestamp: number;
}

export interface SynthFailedMessage {
  readonly type: 'synthFailed';
  readonly error: string;
  readonly timestamp: number;
}

export interface HandshakeAckMessage {
  readonly type: 'handshakeAck';
  readonly version: string;
  readonly accepted: boolean;
}

export interface ShuttingDownMessage {
  readonly type: 'shuttingDown';
  readonly reason: string;
}

export type DaemonMessage =
  | SynthCompleteMessage
  | SynthFailedMessage
  | HandshakeAckMessage
  | ShuttingDownMessage;

// ---------------------------------------------------------------------------
// Info file — written by daemon at startup, read by clients for PID detection
// ---------------------------------------------------------------------------

export interface DaemonInfo {
  readonly pid: number;
  readonly socketPath: string;
  readonly version: string;
  readonly startedAt: number;
  readonly logFile: string;
}

// ---------------------------------------------------------------------------
// Protocol version — manually bumped when the wire protocol changes.
// Used for daemon version handshake: if client and daemon versions differ,
// the daemon shuts down so a new one matching the client can be spawned.
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = '1';
