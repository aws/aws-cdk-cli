import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { GetFunctionCommand, UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { integTest, sleep, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk drift',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('driftable-lambda', {});

    // Assert that, right after deploying, there is no drift (because we just deployed it)
    const drift = await fixture.cdk(['drift', fixture.fullStackName('driftable-lambda')], { verbose: false });

    expect(drift).toMatch(/Stack.*driftable-lambda/); // can't just .toContain because of formatting
    expect(drift).toContain('No drift detected');
    expect(drift).toContain('✨  Number of resources with drift: 0');

    // Get the Lambda, we want to now make it drift
    const response = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: fixture.fullStackName('driftable-lambda'),
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

    const driftAfterModification = await fixture.cdk(['drift', fixture.fullStackName('driftable-lambda')], { verbose: false });

    const expectedMatches = [
      /Stack.*driftable-lambda/,
      /[-].*This is my function!/m,
      /[+].*I'm slowly drifting \(drifting away\)/m,
    ];
    const expectedSubstrings = [
      '1 resource has drifted', // num resources drifted
      '✨  Number of resources with drift: 1',
      'AWS::Lambda::Function', // the lambda should be marked drifted
      '/Description', // the resources that have drifted
    ];
    for (const expectedMatch of expectedMatches) {
      expect(driftAfterModification).toMatch(expectedMatch);
    }
    for (const expectedSubstring of expectedSubstrings) {
      expect(driftAfterModification).toContain(expectedSubstring);
    }
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
