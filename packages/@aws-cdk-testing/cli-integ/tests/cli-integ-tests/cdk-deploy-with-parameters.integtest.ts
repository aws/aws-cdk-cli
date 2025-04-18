import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy with parameters',
  withDefaultFixture(async (fixture) => {
    const stackArn = await fixture.cdkDeploy('param-test-1', {
      options: ['--parameters', `TopicNameParam=${fixture.stackNamePrefix}bazinga`],
      captureStderr: false,
    });

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );

    expect(response.Stacks?.[0].Parameters).toContainEqual({
      ParameterKey: 'TopicNameParam',
      ParameterValue: `${fixture.stackNamePrefix}bazinga`,
    });
  }),
);

