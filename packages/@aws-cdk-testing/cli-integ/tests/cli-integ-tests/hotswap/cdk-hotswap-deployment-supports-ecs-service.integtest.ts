import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'hotswap deployment supports ecs service',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const stackName = 'ecs-hotswap';
    await fixture.cdkDeploy(stackName, {
      captureStderr: false,
    });

    // WHEN
    const deployOutput = await fixture.cdkDeploy(stackName, {
      options: ['--hotswap'],
      captureStderr: true,
      onlyStderr: true,
      modEnv: {
        DYNAMIC_ECS_PROPERTY_VALUE: 'new value',
      },
    });

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName(stackName),
      }),
    );
    const serviceName = response.Stacks?.[0].Outputs?.find((output) => output.OutputKey == 'ServiceName')?.OutputValue;

    // THEN

    // The deployment should not trigger a full deployment, thus the stack's status must remains
    // "CREATE_COMPLETE"
    expect(response.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');
    // The entire string fails locally due to formatting. Making this test less specific
    expect(deployOutput).toMatch(/hotswapped!/);
    expect(deployOutput).toContain(serviceName);
  }),
);

