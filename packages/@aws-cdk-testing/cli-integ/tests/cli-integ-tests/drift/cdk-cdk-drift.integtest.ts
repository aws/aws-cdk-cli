import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { waitForLambdaUpdateComplete } from './drift_helpers';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk drift',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('driftable', {});

    // Assert that, right after deploying, there is no drift (because we just deployed it)
    const drift = await fixture.cdk(['drift', fixture.fullStackName('driftable')], { verbose: false });

    expect(drift).toMatch(/Stack.*driftable/); // can't just .toContain because of formatting
    expect(drift).toContain('No drift detected');
    expect(drift).toContain('✨  Number of resources with drift: 0');
    expect(drift).not.toContain('unchecked'); // should not see unchecked resources unless verbose

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

    const driftAfterModification = await fixture.cdk(['drift', fixture.fullStackName('driftable')], { verbose: false });

    const expectedMatches = [
      /Stack.*driftable/,
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
