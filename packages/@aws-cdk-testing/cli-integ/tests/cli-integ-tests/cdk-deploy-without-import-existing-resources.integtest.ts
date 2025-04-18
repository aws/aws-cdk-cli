import { DescribeStacksCommand, ListChangeSetsCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('deploy without import-existing-resources', withDefaultFixture(async (fixture) => {
  const stackArn = await fixture.cdkDeploy('test-2', {
    options: ['--no-execute'],
    captureStderr: false,
  });
  // verify that we only deployed a single stack (there's a single ARN in the output)
  expect(stackArn.split('\n').length).toEqual(1);

  const response = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({
    StackName: stackArn,
  }));
  expect(response.Stacks?.[0].StackStatus).toEqual('REVIEW_IN_PROGRESS');

  // verify a change set was successfully created and ImportExistingResources = false
  const changeSetResponse = await fixture.aws.cloudFormation.send(new ListChangeSetsCommand({
    StackName: stackArn,
  }));
  const changeSets = changeSetResponse.Summaries || [];
  expect(changeSets.length).toEqual(1);
  expect(changeSets[0].Status).toEqual('CREATE_COMPLETE');
  expect(changeSets[0].ImportExistingResources).toEqual(false);
}));

