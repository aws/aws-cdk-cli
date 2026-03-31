import { DescribeStacksCommand, ListChangeSetsCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';
import * as regions from '../../../lib/regions';

const SUPPORTED_REGIONS = regions.allBut([
  // quirk: ImportExistingResources behaves differently in these regions.
  'eu-south-1',
  'ap-southeast-3',
]);

integTest('deploy with import-existing-resources true', withDefaultFixture(async (fixture) => {
  const stackArn = await fixture.cdkDeploy('test-2', {
    options: ['--no-execute', '--import-existing-resources'],
    captureStderr: false,
  });
  // verify that we only deployed a single stack (there's a single ARN in the output)
  expect(stackArn.split('\n').length).toEqual(1);

  const response = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({
    StackName: stackArn,
  }));
  expect(response.Stacks?.[0].StackStatus).toEqual('REVIEW_IN_PROGRESS');

  // verify a change set was successfully created
  // Here, we do not test whether a resource is actually imported, because that is a CloudFormation feature, not a CDK feature.
  const changeSetResponse = await fixture.aws.cloudFormation.send(new ListChangeSetsCommand({
    StackName: stackArn,
  }));
  const changeSets = changeSetResponse.Summaries || [];
  expect(changeSets.length).toEqual(1);
  expect(changeSets[0].Status).toEqual('CREATE_COMPLETE');
  expect(changeSets[0].ImportExistingResources).toEqual(true);
}, { aws: { regions: SUPPORTED_REGIONS } }));

