import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { integTest, withDefaultFixture } from '../../lib';

/**
 * Telemetry is delivered by a detached child process, so the CLI must not wait for the POST.
 *
 * The endpoint here is a black hole: a TCP listener that accepts the connection and then never
 * writes a byte, so anything talking to it hangs until its own timeout. Before the sender was
 * detached, the flush at the end of the invocation blocked on exactly that, which is why this
 * asserts on wall-clock time rather than on output.
 */
integTest(
  'cdk synth does not wait for the telemetry endpoint',
  withDefaultFixture(async (fixture) => {
    const sockets: net.Socket[] = [];
    const blackHole = net.createServer((socket) => {
      // Accept and hold. Never respond, never close.
      sockets.push(socket);
    });
    await new Promise<void>((ok) => blackHole.listen(0, '127.0.0.1', ok));
    const port = (blackHole.address() as AddressInfo).port;

    try {
      // Baseline: the same synth with telemetry switched off entirely.
      const disabledStart = Date.now();
      await fixture.cdkSynth({
        options: [fixture.fullStackName('test-1')],
        modEnv: { CDK_DISABLE_CLI_TELEMETRY: 'true' },
      });
      const disabledMs = Date.now() - disabledStart;

      // The same synth, with telemetry pointed at the black hole.
      const blackHoleStart = Date.now();
      await fixture.cdkSynth({
        options: [fixture.fullStackName('test-1')],
        modEnv: { TELEMETRY_ENDPOINT: `https://127.0.0.1:${port}/metrics` },
      });
      const blackHoleMs = Date.now() - blackHoleStart;

      const overhead = blackHoleMs - disabledMs;
      fixture.log(`synth with telemetry disabled: ${disabledMs}ms, pointed at a black hole: ${blackHoleMs}ms (overhead ${overhead}ms)`);

      // The detached sender is what hangs on the black hole, not us. The headroom is generous
      // because CI machines are noisy; what this rules out is the CLI blocking on the request
      // timeout, which shows up as whole seconds.
      expect(overhead).toBeLessThan(2000);
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((ok) => blackHole.close(() => ok()));
    }
  }),
);
