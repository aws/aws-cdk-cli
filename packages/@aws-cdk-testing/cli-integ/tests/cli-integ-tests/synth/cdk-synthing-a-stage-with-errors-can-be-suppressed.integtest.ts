import { integTest, withDefaultFixture } from '../../../lib';

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

