import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy with any-change approval shows diff',
  withDefaultFixture(async (fixture) => {
    // Deploy with --require-approval=any-change and --yes to auto-confirm.
    // The output should contain the stack diff so the user knows what they're approving.
    const output = await fixture.cdkDeploy('test-2', {
      options: ['--require-approval=any-change', '--yes'],
      neverRequireApproval: false,
    });

    // The deploy confirmation message should contain the diff with resource information
    expect(output).toContain('AWS::SNS::Topic');
    expect(output).toContain('"--require-approval" is set to \'any-change\'');
    expect(output).toContain('Do you wish to deploy these changes');
    expect(output).toContain('(auto-confirmed)');
  }),
);
