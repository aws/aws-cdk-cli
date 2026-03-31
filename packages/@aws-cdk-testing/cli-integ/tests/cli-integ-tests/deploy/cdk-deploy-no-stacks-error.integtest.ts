import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy no stacks error',
  withDefaultFixture(async (fixture) => {
    // empty array for stack names
    await expect(
      fixture.cdkDeploy([], {
        modEnv: {
          INTEG_STACK_SET: 'stage-with-no-stacks',
        },
      }),
    ).rejects.toThrow('exited with error');
  }),
);

