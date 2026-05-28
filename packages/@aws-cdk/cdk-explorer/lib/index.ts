export { PROTOCOL_VERSION } from './protocol';
export type {
  ClientMessage,
  DaemonInfo,
  DaemonMessage,
  HandshakeAckMessage,
  HandshakeMessage,
  RequestSynthMessage,
  ShutdownMessage,
  ShuttingDownMessage,
  SubscribeMessage,
  SynthCompleteMessage,
  SynthFailedMessage,
} from './protocol';

export { SynthLatch } from './daemon/state-machine';
export type { SynthState, TransitionResult } from './daemon/state-machine';

export {
  socketPathForProject,
  lockPathForProject,
  infoPathForProject,
  logPathForProject,
} from './daemon/socket-path';

export { DaemonServer } from './daemon/server';
export type { DaemonServerOptions } from './daemon/server';

export { connectToDaemon } from './daemon/connect';
export type { DaemonConnection } from './daemon/connect';

export { acquireDaemon } from './daemon/spawn';
export type { AcquireDaemonOptions } from './daemon/spawn';
