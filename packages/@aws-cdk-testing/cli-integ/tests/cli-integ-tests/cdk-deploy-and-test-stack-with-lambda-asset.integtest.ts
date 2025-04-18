import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy and test stack with lambda asset',
  withDefaultFixture(async (fixture) => {
    const stackArn = await fixture.cdkDeploy('lambda', { captureStderr: false });

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );
    const lambdaArn = response.Stacks?.[0].Outputs?.[0].OutputValue;
    if (lambdaArn === undefined) {
      throw new Error('Stack did not have expected Lambda ARN output');
    }

    const output = await fixture.aws.lambda.send(
      new InvokeCommand({
        FunctionName: lambdaArn,
      }),
    );

    expect(JSON.stringify(output.Payload?.transformToString())).toContain('dear asset');
  }),
);

