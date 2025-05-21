import { DescribeStacksCommand, ListChangeSetsCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'deploy without execute a named change set',
  withDefaultFixture(async (fixture) => {
    const changeSetName = 'custom-change-set-name';
    const stackArn = await fixture.cdkDeploy('test-2', {
      options: ['--no-execute', '--change-set-name', changeSetName],
      captureStderr: false,
    });
    // verify that we only deployed a single stack (there's a single ARN in the output)
    expect(stackArn.split('\n').length).toEqual(1);

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );
    expect(response.Stacks?.[0].StackStatus).toEqual('REVIEW_IN_PROGRESS');

    // verify a change set was created with the provided name
    const changeSetResponse = await fixture.aws.cloudFormation.send(
      new ListChangeSetsCommand({
        StackName: stackArn,
      }),
    );
    const changeSets = changeSetResponse.Summaries || [];
    expect(changeSets.length).toEqual(1);
    expect(changeSets[0].ChangeSetName).toEqual(changeSetName);
    expect(changeSets[0].Status).toEqual('CREATE_COMPLETE');
  }),
);

