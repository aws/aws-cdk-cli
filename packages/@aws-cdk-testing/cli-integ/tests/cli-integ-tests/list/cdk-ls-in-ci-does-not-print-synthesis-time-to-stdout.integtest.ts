import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk ls in CI does not print synthesis time to stdout',
  withDefaultFixture(async (fixture) => {
    // In CI mode, `cdk ls` output goes to stdout and is often piped, so it must
    // be only the stack listing, not status lines like "✨ Synthesis time: ...".
    const listing = await fixture.cdk(['ls'], {
      verbose: false, // no -v, so stdout is just the listing
      captureStderr: false, // stdout only
      modEnv: { CI: 'true' },
    });

    const lines = listing.trim().split('\n').filter(line => line.length > 0);

    // every line should be a stack; a synth-time line would not carry the prefix
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain(fixture.stackNamePrefix);
    }
  }),
);
