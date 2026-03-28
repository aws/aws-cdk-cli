import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'skips notice refresh',
  withDefaultFixture(async (fixture) => {
    const output = await fixture.cdkSynth({
      options: ['--no-notices'],
      modEnv: {
        INTEG_STACK_SET: 'stage-using-context',
      },
      allowErrExit: true,
    });

    // Neither succeeds nor fails, but skips the refresh
    await expect(output).not.toContain('Notices refreshed');
    await expect(output).not.toContain('Notices refresh failed');
  }),
);

/**
 * Create an S3 bucket, orphan that bucket, then import the bucket, with a NodeJSFunction lambda also in the stack.
 *
 * Validates fix for https://github.com/aws/aws-cdk/issues/31999 (import fails)
 */
