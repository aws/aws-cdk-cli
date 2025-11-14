import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'update to stack in ROLLBACK_COMPLETE state will delete stack and create a new one',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    await expect(
      fixture.cdkDeploy('param-test-1', {
        options: ['--parameters', `TopicNameParam=${fixture.stackNamePrefix}@aww`],
        captureStderr: false,
      }),
    ).rejects.toThrow('exited with error');

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName('param-test-1'),
      }),
    );

    const stackArn = response.Stacks?.[0].StackId;
    expect(response.Stacks?.[0].StackStatus).toEqual('ROLLBACK_COMPLETE');

    // WHEN
    const newStackArn = await fixture.cdkDeploy('param-test-1', {
      options: ['--parameters', `TopicNameParam=${fixture.stackNamePrefix}allgood`],
      captureStderr: false,
    });

    const newStackResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: newStackArn,
      }),
    );

    // THEN
    expect(stackArn).not.toEqual(newStackArn); // new stack was created
    expect(newStackResponse.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');
    expect(newStackResponse.Stacks?.[0].Parameters).toContainEqual({
      ParameterKey: 'TopicNameParam',
      ParameterValue: `${fixture.stackNamePrefix}allgood`,
    });
  }),
);

