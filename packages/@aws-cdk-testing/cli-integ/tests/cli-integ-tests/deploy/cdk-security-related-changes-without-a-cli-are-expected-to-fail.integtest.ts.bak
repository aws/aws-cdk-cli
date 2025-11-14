import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'security related changes without a CLI are expected to fail',
  withDefaultFixture(async (fixture) => {
    // redirect /dev/null to stdin, which means there will not be tty attached
    // since this stack includes security-related changes, the deployment should
    // immediately fail because we can't confirm the changes
    const stackName = 'iam-test';
    await expect(
      fixture.cdkDeploy(stackName, {
        options: ['<', '/dev/null'], // H4x, this only works because I happen to know we pass shell: true.
        neverRequireApproval: false,
      }),
    ).rejects.toThrow('exited with error');

    // Ensure stack was not deployed
    await expect(
      fixture.aws.cloudFormation.send(
        new DescribeStacksCommand({
          StackName: fixture.fullStackName(stackName),
        }),
      ),
    ).rejects.toThrow('does not exist');
  }),
);

