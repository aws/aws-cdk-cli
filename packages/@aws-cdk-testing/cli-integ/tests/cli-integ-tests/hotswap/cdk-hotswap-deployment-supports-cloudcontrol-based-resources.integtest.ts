import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'hotswap deployment supports CloudControl-based resources with attribute resolution',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const stackName = 'cc-hotswap';
    await fixture.cdkDeploy(stackName, {
      captureStderr: false,
      modEnv: {
        DYNAMIC_CC_PROPERTY_VALUE: 'original value',
      },
    });

    // WHEN
    const deployOutput = await fixture.cdkDeploy(stackName, {
      options: ['--hotswap'],
      captureStderr: true,
      onlyStderr: true,
      modEnv: {
        DYNAMIC_CC_PROPERTY_VALUE: 'new value',
      },
    });

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: fixture.fullStackName(stackName),
      }),
    );

    const queueUrl = response.Stacks?.[0].Outputs?.find((output) => output.OutputKey === 'QueueUrl')?.OutputValue;
    const agentName = response.Stacks?.[0].Outputs?.find((output) => output.OutputKey === 'AgentName')?.OutputValue;
    const ruleName = response.Stacks?.[0].Outputs?.find((output) => output.OutputKey === 'RuleName')?.OutputValue;

    // THEN

    // The deployment should not trigger a full deployment, thus the stack's status must remain
    // "CREATE_COMPLETE"
    expect(response.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');
    // Verify hotswap was used
    expect(deployOutput).toMatch(/hotswapped!/);
    // Verify all three CCAPI-based resources were hotswapped
    expect(queueUrl).toBeDefined();
    expect(agentName).toBeDefined();
    expect(ruleName).toBeDefined();
  }),
);
