import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'context in stage propagates to top',
  withoutBootstrap(async (fixture) => {
    await expect(
      fixture.cdkSynth({
        // This will make it error to prove that the context bubbles up, and also that we can fail on command
        options: ['--no-lookups'],
        modEnv: {
          INTEG_STACK_SET: 'stage-using-context',
        },
        allowErrExit: true,
      }),
    ).resolves.toContain('Context lookups have been disabled');
  }),
);

