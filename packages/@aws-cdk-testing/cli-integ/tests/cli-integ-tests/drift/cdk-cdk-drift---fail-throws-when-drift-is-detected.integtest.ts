import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { GetFunctionCommand, UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { integTest, sleep, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk drift --fail throws when drift is detected',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('driftable', {});

    // Assert that, right after deploying, there is no drift (because we just deployed it)
    const drift = await fixture.cdk(['drift', '--fail', fixture.fullStackName('driftable')], { verbose: false });

    expect(drift).toContain('No drift detected');

    // Get the Lambda, we want to now make it drift
    const response = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: fixture.fullStackName('driftable'),
      }),
    );
    const lambdaResource = response.StackResources?.find(
      resource => resource.ResourceType === 'AWS::Lambda::Function',
    );
    if (!lambdaResource || !lambdaResource.PhysicalResourceId) {
      throw new Error('Could not find Lambda function in stack resources');
    }
    const functionName = lambdaResource.PhysicalResourceId;

    // Update the Lambda function, introducing drift
    await fixture.aws.lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Description: 'I\'m slowly drifting (drifting away)',
      }),
    );

    // Wait for the stack update to complete
    await waitForLambdaUpdateComplete(fixture, functionName);

    await expect(
      fixture.cdk(['drift', '--fail', fixture.fullStackName('driftable')], { verbose: false }),
    ).rejects.toThrow('exited with error');
  }),
);

async function waitForLambdaUpdateComplete(fixture: any, functionName: string): Promise<void> {
  const delaySeconds = 5;
  const timeout = 30_000; // timeout after 30s
  const deadline = Date.now() + timeout;

  while (true) {
    const response = await fixture.aws.lambda.send(
      new GetFunctionCommand({
        FunctionName: functionName,
      }),
    );

    const lastUpdateStatus = response.Configuration?.LastUpdateStatus;

    if (lastUpdateStatus === 'Successful') {
      return; // Update completed successfully
    }

    if (lastUpdateStatus === 'Failed') {
      throw new Error('Lambda function update failed');
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeout / 1000} seconds.`);
    }

    // Wait before checking again
    await sleep(delaySeconds * 1000);
  }
}
