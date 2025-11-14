import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

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

