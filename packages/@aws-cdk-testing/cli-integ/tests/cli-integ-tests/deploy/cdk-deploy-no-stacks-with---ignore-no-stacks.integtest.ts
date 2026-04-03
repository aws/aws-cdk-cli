import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy no stacks with --ignore-no-stacks',
  withDefaultFixture(async (fixture) => {
    // empty array for stack names
    await fixture.cdkDeploy([], {
      options: ['--ignore-no-stacks'],
      modEnv: {
        INTEG_STACK_SET: 'stage-with-no-stacks',
      },
    });
  }),
);

