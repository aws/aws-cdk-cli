import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest('deploy with method=direct and import-existing-resources fails', withDefaultFixture(async (fixture) => {
  const stackName = 'iam-test';
  await expect(fixture.cdkDeploy(stackName, {
    options: ['--import-existing-resources', '--method=direct'],
  })).rejects.toThrow('exited with error');

  // Ensure stack was not deployed
  await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({
    StackName: fixture.fullStackName(stackName),
  }))).rejects.toThrow('does not exist');
}));

