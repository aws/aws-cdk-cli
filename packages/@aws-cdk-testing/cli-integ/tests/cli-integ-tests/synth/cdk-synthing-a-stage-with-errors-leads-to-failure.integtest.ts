import { integTest, withDefaultFixture } from '../../../lib';

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

