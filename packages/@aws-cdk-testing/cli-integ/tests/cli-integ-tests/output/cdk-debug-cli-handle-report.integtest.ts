import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'debug-cli prints no handle report on a clean exit',
  withDefaultFixture(async (fixture) => {
    // synth exits cleanly, so the handle tracker's grace timer (which is
    // unref'd) must never fire. Exercises the cli.ts wiring end to end: the
    // flag enables tracking at startup, and the report stays silent unless the
    // process is genuinely still alive after the work is done.
    const output = await fixture.cdk(['synth', fixture.fullStackName('test-1'), '--debug-cli'], {
      captureStderr: true,
    });

    expect(output).not.toContain('keeping the CLI process alive');
  }),
);
