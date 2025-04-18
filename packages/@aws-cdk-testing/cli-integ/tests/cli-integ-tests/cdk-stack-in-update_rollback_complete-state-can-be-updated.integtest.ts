import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'stack in UPDATE_ROLLBACK_COMPLETE state can be updated',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const stackArn = await fixture.cdkDeploy('param-test-1', {
      options: ['--parameters', `TopicNameParam=${fixture.stackNamePrefix}nice`],
      captureStderr: false,
    });

    let response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );

    expect(response.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');

    // bad parameter name with @ will put stack into UPDATE_ROLLBACK_COMPLETE
    await expect(
      fixture.cdkDeploy('param-test-1', {
        options: ['--parameters', `TopicNameParam=${fixture.stackNamePrefix}@aww`],
        captureStderr: false,
      }),
    ).rejects.toThrow('exited with error');

    response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );

    expect(response.Stacks?.[0].StackStatus).toEqual('UPDATE_ROLLBACK_COMPLETE');

    // WHEN
    await fixture.cdkDeploy('param-test-1', {
      options: ['--parameters', `TopicNameParam=${fixture.stackNamePrefix}allgood`],
      captureStderr: false,
    });

    response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );

    // THEN
    expect(response.Stacks?.[0].StackStatus).toEqual('UPDATE_COMPLETE');
    expect(response.Stacks?.[0].Parameters).toContainEqual({
      ParameterKey: 'TopicNameParam',
      ParameterValue: `${fixture.stackNamePrefix}allgood`,
    });
  }),
);

