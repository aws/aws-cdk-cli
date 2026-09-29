import { integTest, withDefaultFixture } from '../../../lib';

// A debug-level line the CLI always emits, used here as the marker that
// `--debug-cli` raised the log level. Unit tests cover the report itself; what
// only an integ test can prove is that the wiring survives bundling, since the
// published CLI is a single minified file with no source map.
const DEBUG_MARKER = 'CDK Toolkit CLI version:';

integTest(
  'debug-cli raises the log level on the bundled CLI',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('test-1');

    // `verbose: false` is essential. `fixture.cdk` injects `-v` by default, which
    // raises the log level on its own and would make this test pass whether or not
    // `--debug-cli` did anything.
    //
    // `fixture.cdk` throws on a non-zero exit, so this also asserts the flag does
    // not break the command it is diagnosing.
    const withFlag = await fixture.cdk(['synth', stackName, '--debug-cli'], {
      captureStderr: true,
      verbose: false,
    });

    // `--debug-cli` on its own, with no `-v`, has to be enough to see the CLI's
    // debug output. If it isn't, the handle report it exists to print would be
    // filtered out and the flag would do nothing visible.
    expect(withFlag).toContain(DEBUG_MARKER);

    // Control, so the assertion above is attributable to the flag rather than to
    // the CLI being verbose by default. Same `verbose: false` for the same reason.
    const withoutFlag = await fixture.cdk(['synth', stackName], {
      captureStderr: true,
      verbose: false,
    });
    expect(withoutFlag).not.toContain(DEBUG_MARKER);

    // Deliberately not asserted here: that the report stays silent on a clean
    // exit. The grace timer is unref'd, so it only fires when something really is
    // still holding the event loop, and against real AWS the CLI's own notices
    // fetch can still have a socket open at that point — a true positive, and the
    // exact symptom this flag exists to diagnose. Asserting silence would make a
    // correct report fail the build. The unref'd-timer invariant is covered
    // deterministically by the unit tests, with fake timers.
  }),
);
