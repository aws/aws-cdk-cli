import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy with --require-approval skips the approval prompt on a no-change deploy',
  withDefaultFixture(async (fixture) => {
    // First deploy — creates the stack.
    await fixture.cdkDeploy('test-2');

    // Second deploy — no changes. With --require-approval=any-change and no
    // --yes, the CLI must *not* prompt for approval: there is nothing for the
    // user to approve. If the bug regresses, this call will hang waiting for
    // stdin and the test will time out.
    const output = await fixture.cdkDeploy('test-2', {
      options: ['--require-approval=any-change', '--method=change-set'],
      neverRequireApproval: false,
      modEnv: {
        FORCE_COLOR: '0',
      },
    });

    // The deploy completed and reported no changes — and, crucially, never
    // asked the user to confirm "updates" that don't exist.
    expect(output).toContain('(no changes)');
    expect(output).not.toContain('Do you wish to deploy these changes');
  }),
);
