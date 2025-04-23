import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withCliLibFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'security related changes without a CLI are expected to fail when approval is required',
  withCliLibFixture(async (fixture) => {
    const stdErr = await fixture.cdk(['deploy', fixture.fullStackName('simple-1')], {
      onlyStderr: true,
      captureStderr: true,
      allowErrExit: true,
      neverRequireApproval: false,
    });

    expect(stdErr).toContain(
      '"--require-approval" is enabled and stack includes security-sensitive updates',
    );

    // Ensure stack was not deployed
    await expect(
      fixture.aws.cloudFormation.send(
        new DescribeStacksCommand({
          StackName: fixture.fullStackName('simple-1'),
        }),
      ),
    ).rejects.toThrow('does not exist');
  }),
);
