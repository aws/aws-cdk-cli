import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'synthing a stage with errors can be suppressed',
  withDefaultFixture(async (fixture) => {
    await fixture.cdk(['synth', '--no-validation'], {
      modEnv: {
        INTEG_STACK_SET: 'stage-with-errors',
      },
    });
  }),
);

