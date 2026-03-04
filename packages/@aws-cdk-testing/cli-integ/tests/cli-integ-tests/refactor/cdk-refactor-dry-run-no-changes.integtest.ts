import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk refactor - dry-run - no refactoring changes detected',
  withSpecificFixture('refactoring', async (fixture) => {
    const modEnv = {
      BASIC_QUEUE_LOGICAL_ID: 'OldName',
    };

    // First, deploy the stacks
    await fixture.cdkDeploy('bucket-stack');
    await fixture.cdkDeploy('basic', { modEnv });

    // Then see if the refactoring tool detects the change
    const stdErr = await fixture.cdkRefactor({
      options: ['--dry-run', '--unstable=refactor'],
      allowErrExit: true,
      modEnv,
    });

    expect(stdErr).toContain('Nothing to refactor');
  }),
);
