import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk ls --json in CI does not print synthesis time to stdout',
  withDefaultFixture(async (fixture) => {
    // `cdk ls --json` stdout is a machine-readable contract and is often piped (e.g. to `jq`),
    // so it must be only the stack listing, not status lines like "✨ Synthesis time: ...".
    const listing = await fixture.cdk(['ls', '--json'], {
      verbose: false, // fixture defaults verbose on; turn it off so stdout is just the listing
      captureStderr: false, // capture stdout only; stderr is folded into the result by default
      modEnv: { CI: 'true' }, // CI routes non-error output to stdout (default is stderr)
    });

    const lines = listing.trim().split('\n').filter(line => line.length > 0);

    // every line should be a stack; a synth-time line would not carry the prefix
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain(fixture.stackNamePrefix);
    }
  }),
);
