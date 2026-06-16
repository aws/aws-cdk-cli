import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk ls in CI does not print synthesis time to stdout',
  withDefaultFixture(async (fixture) => {
    // In CI mode the CLI routes non-error output to stdout. `cdk ls` stdout is
    // commonly piped (e.g. to `jq`), so it must contain the stack listing and
    // not the "Synthesis time" status line.
    const listing = await fixture.cdk(['ls'], {
      captureStderr: false, // stdout only
      modEnv: { CI: 'true' },
    });

    const lines = listing.trim().split('\n').filter(line => line.length > 0);

    // there is an actual listing (guards against an empty pass)
    expect(lines.length).toBeGreaterThan(0);

    // every line is a stack entry; a status line like "✨ Synthesis time: ..."
    // would not carry the stack prefix, so it fails this check
    for (const line of lines) {
      expect(line).toContain(fixture.stackNamePrefix);
    }
  }),
);
