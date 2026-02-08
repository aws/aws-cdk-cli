import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda';
import { integTest, withDefaultFixture } from '../../../lib';
import { waitForLambdaUpdateComplete } from '../drift/drift_helpers';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy with revert-drift true',
  withDefaultFixture(async (fixture) => {
    await fixture.cdkDeploy('driftable', {});

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

    const drifted = await fixture.cdk(['drift', fixture.fullStackName('driftable')], { verbose: false });

    expect(drifted).toMatch(/Stack.*driftable/);
    expect(drifted).toContain('1 resource has drifted');

    // Update the Stack with drift-aware
    await fixture.cdkDeploy('driftable', {
      options: ['--revert-drift'],
      captureStderr: false,
    });

    // After performing a drift-aware deployment, verify that no drift has occurred.
    const noDrifted = await fixture.cdk(['drift', fixture.fullStackName('driftable')], { verbose: false });

    expect(noDrifted).toMatch(/Stack.*driftable/); // can't just .toContain because of formatting
    expect(noDrifted).toContain('No drift detected');
  }),
);
