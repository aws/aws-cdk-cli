import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { DescribeRepositoriesCommand } from '@aws-sdk/client-ecr';
import { integTest, withoutBootstrap } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('create ECR with tag IMMUTABILITY to set on', withoutBootstrap(async (fixture) => {
  const bootstrapStackName = fixture.bootstrapStackName;

  await fixture.cdkBootstrapModern({
    verbose: true,
    toolkitStackName: bootstrapStackName,
  });

  const response = await fixture.aws.cloudFormation.send(
    new DescribeStackResourcesCommand({
      StackName: bootstrapStackName,
    }),
  );
  const ecrResource = response.StackResources?.find(resource => resource.LogicalResourceId === 'ContainerAssetsRepository');
  expect(ecrResource).toBeDefined();

  const ecrResponse = await fixture.aws.ecr.send(
    new DescribeRepositoriesCommand({
      repositoryNames: [
        // This is set, as otherwise we don't end up here
        ecrResource?.PhysicalResourceId ?? '',
      ],
    }),
  );

  expect(ecrResponse.repositories?.[0].imageTagMutability).toEqual('IMMUTABLE');
}));

