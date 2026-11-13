export interface LogSink {
  warn(message: string): void;
  error(message: string): void;
}

export const NOOP_LOGGER: LogSink = {
  warn: () => {
  },
  error: () => {
  },
};

