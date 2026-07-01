import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk ls in CI prints only the stack listing to stdout',
  withDefaultFixture(async (fixture) => {
    // In CI, non-error output goes to stdout. `cdk ls` stdout must be only the stack listing,
    // not status lines like "✨ Synthesis time: ..." or "Including dependency stacks: ...".
    const listing = await fixture.cdk(['ls'], {
      verbose: false, // fixture defaults verbose on; turn it off so stdout is just the listing
      captureStderr: false, // capture stdout only; stderr is folded into the result by default
      modEnv: { CI: 'true' }, // CI routes non-error output to stdout (default is stderr)
    });

    const lines = listing.trim().split('\n').filter(line => line.length > 0);

    // every line should be a stack; a status line would not carry the stack name prefix
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain(fixture.stackNamePrefix);
    }
  }),
);
