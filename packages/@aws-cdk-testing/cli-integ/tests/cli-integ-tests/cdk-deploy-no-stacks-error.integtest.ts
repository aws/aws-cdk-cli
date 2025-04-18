import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

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

