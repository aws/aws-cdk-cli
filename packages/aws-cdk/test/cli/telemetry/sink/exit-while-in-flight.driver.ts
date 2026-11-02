import { SubprocessTelemetrySink } from '../../../../lib/cli/telemetry/sink/subprocess-sink';

/**
 * Driver for the "the CLI exits while delivery is still in flight" test.
 *
 * Not a test itself -- it is spawned as a separate process, because the property under test is about
 * process lifetime and cannot be observed from inside the process doing the work.
 *
 * Uses the real sink against the endpoint given in argv, prints the dispatched child's pid, and then
 * returns. If the sink held the process open (a referenced timer, a pipe waiting to drain, an awaited
 * request) this would not exit until the child was finished.
 */
async function main(): Promise<void> {
  const endpoint = process.argv[2];

  const sink = new SubprocessTelemetrySink({
    endpoint,
    ioHost: {
      notify: async (msg: any) => {
        // The sink reports the hand-off, including the pid we need to inspect from outside.
        process.stdout.write(`${msg.message}\n`);
      },
      requestResponse: async (msg: any) => msg.defaultResponse,
    } as any,
  });

  await sink.emit({ identifiers: { sessionId: 'exit-while-in-flight' } } as any);
  await sink.flush();
}

void main();
