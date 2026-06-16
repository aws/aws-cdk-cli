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

    expect(listing).toContain(fixture.fullStackName('test-1'));
    expect(listing).not.toContain('Synthesis time');
  }),
);
