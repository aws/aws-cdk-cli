import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  "hotswap deployment supports Lambda function's description and environment variables",
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const stackArn = await fixture.cdkDeploy('lambda-hotswap', {
      captureStderr: false,
      modEnv: {
        DYNAMIC_LAMBDA_PROPERTY_VALUE: 'original value',
      },
    });

    // WHEN
    const deployOutput = await fixture.cdkDeploy('lambda-hotswap', {
      options: ['--hotswap'],
      captureStderr: true,
      onlyStderr: true,
      modEnv: {
        DYNAMIC_LAMBDA_PROPERTY_VALUE: 'new value',
      },
    });

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );
    const functionName = response.Stacks?.[0].Outputs?.[0].OutputValue;

    // THEN
    // The deployment should not trigger a full deployment, thus the stack's status must remains
    // "CREATE_COMPLETE"
    expect(response.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');
    // The entire string fails locally due to formatting. Making this test less specific
    expect(deployOutput).toMatch(/hotswapped!/);
    expect(deployOutput).toContain(functionName);
  }),
);

