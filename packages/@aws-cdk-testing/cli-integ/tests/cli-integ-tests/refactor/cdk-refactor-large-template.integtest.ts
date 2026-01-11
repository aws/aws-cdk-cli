import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk refactor - handles large templates by uploading to S3',
  withSpecificFixture('refactoring-large-template', async (fixture) => {
    // Deploy a stack with a large template (450 buckets = >50KB)
    await fixture.cdkDeploy('large-stack', {
      modEnv: {
        QUEUE_LOGICAL_ID: 'OldQueue',
      },
    });

    // Perform a refactor by renaming the queue's logical ID
    // This verifies that large templates (>50KB) are correctly uploaded to S3
    const stdErr = await fixture.cdkRefactor({
      options: ['--unstable=refactor', '--force'],
      allowErrExit: true,
      modEnv: {
        QUEUE_LOGICAL_ID: 'NewQueue',
      },
    });

    // Verify refactor completed successfully with the large template
    expect(stdErr).toMatch('Stack refactor complete');

    // CloudFormation may complete the refactoring, while the stack is still in the "UPDATE_IN_PROGRESS" state.
    // Give it a couple of seconds to finish the update.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }),
);
