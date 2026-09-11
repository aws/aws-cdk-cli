import { integTest, withDefaultFixture } from '../../../lib';

// A debug-level line the CLI always emits, used here as the marker that
// `--debug-cli` raised the log level. Unit tests cover the report itself; what
// only an integ test can prove is that the wiring survives bundling, since the
// published CLI is a single minified file with no source map.
const DEBUG_MARKER = 'CDK Toolkit CLI version:';

integTest(
  'debug-cli raises the log level and stays silent on a clean exit',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('test-1');

    const withFlag = await fixture.cdk(['synth', stackName, '--debug-cli'], {
      captureStderr: true,
    });

    // `--debug-cli` on its own, with no `-v`, has to be enough to see the CLI's
    // debug output. If it isn't, the handle report it exists to print would be
    // filtered out and the flag would do nothing visible.
    expect(withFlag).toContain(DEBUG_MARKER);

    // synth exits cleanly, so the tracker's grace timer (which is unref'd) must
    // never fire. This is the invariant that keeps the flag usable: enabling it
    // must not add a second of latency to every successful command.
    expect(withFlag).not.toContain('keeping the CLI process alive');
    expect(withFlag).not.toContain('no tracked handle explains it');

    // Control, so the assertion above is attributable to the flag rather than to
    // the CLI being verbose by default.
    const withoutFlag = await fixture.cdk(['synth', stackName], {
      captureStderr: true,
    });
    expect(withoutFlag).not.toContain(DEBUG_MARKER);
  }),
);
