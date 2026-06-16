import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk ls --json does not pollute stdout with synthesis time in CI',
  withDefaultFixture(async (fixture) => {
    // In CI mode the CLI routes non-error output to stdout. `cdk list` is a
    // read-only query whose stdout is commonly piped (e.g. to `jq`), so the
    // synthesis-time message must not appear there. Regression test for the
    // synth-time line leaking into `cdk ls --json` output.
    const stdout = await fixture.cdk(['ls', '--json', '--no-notices'], {
      captureStderr: false, // return stdout only
      modEnv: {
        CI: 'true',
      },
    });

    expect(stdout).not.toContain('Synthesis time');
    // stdout should still contain the actual listing
    expect(stdout).toContain(fixture.fullStackName('test-1'));
  }),
);
