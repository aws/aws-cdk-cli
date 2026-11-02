import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'publish-assets without deploying',
  withDefaultFixture(async (fixture) => {
    const stackName = 'lambda';
    const fullStackName = fixture.fullStackName(stackName);

    const output = await fixture.cdk(['publish-assets', fullStackName, '--unstable=publish-assets']);
    expect(output).toMatch('Assets published successfully');

    // assert the stack was not deployed
    await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: fullStackName })))
      .rejects.toThrow(/does not exist/);
  }),
);
