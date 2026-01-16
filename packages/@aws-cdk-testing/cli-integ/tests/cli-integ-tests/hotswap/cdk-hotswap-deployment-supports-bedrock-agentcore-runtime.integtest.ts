import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'hotswap deployment supports Bedrock AgentCore Runtime',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const stackArn = await fixture.cdkDeploy('agentcore-hotswap', {
      captureStderr: false,
      modEnv: {
        DYNAMIC_BEDROCK_RUNTIME_DESCRIPTION: 'original description',
        DYNAMIC_BEDROCK_RUNTIME_ENV_VAR: 'original value',
      },
    });

    // WHEN
    const deployOutput = await fixture.cdkDeploy('agentcore-hotswap', {
      options: ['--hotswap'],
      captureStderr: true,
      onlyStderr: true,
      modEnv: {
        DYNAMIC_BEDROCK_RUNTIME_DESCRIPTION: 'new description',
        DYNAMIC_BEDROCK_RUNTIME_ENV_VAR: 'new value',
      },
    });

    // Extract stack name from ARN (format: arn:aws:cloudformation:region:account:stack/name/id)
    // Using the full ARN can cause "Stack name cannot exceed 128 characters" error in some cases
    const stackName = stackArn.split('/')[1];

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackName,
      }),
    );
    const runtimeId = response.Stacks?.[0].Outputs?.find((output) => output.OutputKey === 'RuntimeId')?.OutputValue;

    // THEN

    // The deployment should not trigger a full deployment, thus the stack's status must remains
    // "CREATE_COMPLETE"
    expect(response.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');
    // The entire string fails locally due to formatting. Making this test less specific
    expect(deployOutput).toMatch(/hotswapped!/);
    expect(deployOutput).toContain(runtimeId);
  }, {
    aws: {
      // Bedrock AgentCore Runtime is only available in specific regions
      // Source: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-regions.html
      regions: [
        'ap-south-1',
        'ap-southeast-1',
        'ap-southeast-2',
        'ap-northeast-1',
        'eu-west-1',
        'eu-central-1',
        'us-east-1',
        'us-east-2',
        'us-west-2',
      ],
    },
  }),
);
