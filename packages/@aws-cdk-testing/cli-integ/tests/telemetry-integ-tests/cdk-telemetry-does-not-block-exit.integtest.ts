import { integTest, withDefaultFixture } from '../../lib';
import { startBlackHoleEndpoint } from '../../lib/telemetry-endpoint';

/**
 * The detached sender's own network budget (`NETWORK_TIMEOUT_MS` in `lib/cli/telemetry/sender.ts`).
 *
 * This is the regression signature: a CLI that went back to waiting for delivery would block for this
 * long against a black hole, so the overhead budget only has to stay comfortably underneath it.
 */
const SENDER_NETWORK_BUDGET_MS = 10_000;

/**
 * Smallest overhead we are willing to call a regression, however fast the machine is.
 *
 * Process spawn and interpreter startup are not free, and on a fast machine half the baseline is less
 * than that noise.
 */
const OVERHEAD_FLOOR_MS = 2_000;

/**
 * Share of the baseline synth time we allow as overhead.
 *
 * Relative rather than absolute because a loaded CI machine varies run-to-run by a large fraction of
 * the run's own duration; a fixed millisecond budget turns that noise into a failure.
 */
const OVERHEAD_FRACTION = 0.5;

/**
 * Largest overhead we are willing to call noise, whatever the baseline.
 *
 * INVARIANT: must stay comfortably below `SENDER_NETWORK_BUDGET_MS`. Letting the budget grow with an
 * arbitrarily slow baseline would eventually exceed it, and the test would pass no matter what.
 */
const OVERHEAD_CEILING_MS = SENDER_NETWORK_BUDGET_MS / 2;

/**
 * How much slower the telemetry run may be than the baseline before we call it a regression.
 */
function overheadBudgetMs(baselineMs: number): number {
  return Math.min(Math.max(baselineMs * OVERHEAD_FRACTION, OVERHEAD_FLOOR_MS), OVERHEAD_CEILING_MS);
}

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
      const budget = overheadBudgetMs(disabledMs);
      fixture.log(`fastest synth with telemetry disabled: ${disabledMs}ms, pointed at a black hole: ${blackHoleMs}ms (overhead ${overhead}ms, budget ${budget}ms)`);

      // Half one: something actually tried to deliver. Without this the test would also pass if
      // telemetry were silently broken.
      expect(await blackHole.waitForConnection()).toBe(true);

      // Half two: whatever is hanging on the black hole, it is not the CLI.
      expect(overhead).toBeLessThan(budget);
    } finally {
      await blackHole.dispose();
    }
  }),
);
