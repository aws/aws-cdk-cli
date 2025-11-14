import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'synthing a stage with errors leads to failure',
  withDefaultFixture(async (fixture) => {
    const output = await fixture.cdk(['synth'], {
      allowErrExit: true,
      modEnv: {
        INTEG_STACK_SET: 'stage-with-errors',
      },
    });

    expect(output).toContain('This is an error');
  }),
);

