import { integTest, withDefaultFixture } from '../../lib';
import { startBlackHoleEndpoint } from '../../lib/telemetry-endpoint';

/**
 * Largest exit delay we are willing to attribute to telemetry.
 *
 * INVARIANT: this must stay comfortably below the detached sender's own network budget
 * (`NETWORK_TIMEOUT_MS` in `lib/cli/telemetry/sender.ts`, currently 10s). If the CLI ever went back
 * to waiting for delivery, it would wait for that budget to expire against a black hole, so the
 * regression shows up as whole seconds. Raising this above the sender's timeout would make the test
 * pass no matter what.
 */
const MAX_TELEMETRY_OVERHEAD_MS = 2_000;

/**
 * How many times to run each variant. The fastest run of each is compared, which is far less noisy
 * than a single sample on a loaded CI machine.
 */
const RUNS = 2;

/**
 * Telemetry is delivered by a detached child, so the CLI must not wait for the POST.
 *
 * The endpoint is a black hole: it accepts the TCP connection and then never writes a byte, so
 * anything waiting on a response hangs until its own timeout. Two things have to be true, and
 * checking only one of them is how this test would quietly stop meaning anything:
 *
 * 1. the black hole received a connection, so delivery really was attempted; and
 * 2. the CLI still exited promptly, so it was not the one waiting.
 */
integTest(
  'cdk synth does not wait for the telemetry endpoint',
  withDefaultFixture(async (fixture) => {
    const blackHole = await startBlackHoleEndpoint();

    const timeSynth = async (modEnv: Record<string, string>): Promise<number> => {
      const start = Date.now();
      await fixture.cdkSynth({ options: [fixture.fullStackName('test-1')], modEnv });
      return Date.now() - start;
    };

    const fastest = async (modEnv: Record<string, string>): Promise<number> => {
      const timings: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        timings.push(await timeSynth(modEnv));
      }
      return Math.min(...timings);
    };

    try {
      // Baseline: the same synth with telemetry switched off entirely.
      const disabledMs = await fastest({ CDK_DISABLE_CLI_TELEMETRY: 'true' });

      // The same synth, with telemetry pointed at the black hole.
      const blackHoleMs = await fastest({
        CDK_HOME: fixture.integTestDir,
        TELEMETRY_ENDPOINT: blackHole.url,
      });

      const overhead = blackHoleMs - disabledMs;
      fixture.log(`fastest synth with telemetry disabled: ${disabledMs}ms, pointed at a black hole: ${blackHoleMs}ms (overhead ${overhead}ms)`);

      // Half one: something actually tried to deliver. Without this the test would also pass if
      // telemetry were silently broken.
      expect(await blackHole.waitForConnection()).toBe(true);

      // Half two: whatever is hanging on the black hole, it is not the CLI.
      expect(overhead).toBeLessThan(MAX_TELEMETRY_OVERHEAD_MS);
    } finally {
      await blackHole.dispose();
    }
  }),
);
