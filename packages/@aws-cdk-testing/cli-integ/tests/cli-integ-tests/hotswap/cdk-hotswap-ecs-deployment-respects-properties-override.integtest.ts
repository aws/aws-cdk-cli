import { promises as fs } from 'fs';
import * as path from 'path';
import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DescribeServicesCommand } from '@aws-sdk/client-ecs';
import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest('hotswap ECS deployment respects properties override', withDefaultFixture(async (fixture) => {
  // Update the CDK context with the new ECS properties
  let ecsMinimumHealthyPercent = 100;
  let ecsMaximumHealthyPercent = 200;
  let cdkJson = JSON.parse(await fs.readFile(path.join(fixture.integTestDir, 'cdk.json'), 'utf8'));
  cdkJson = {
    ...cdkJson,
    hotswap: {
      ecs: {
        minimumHealthyPercent: ecsMinimumHealthyPercent,
        maximumHealthyPercent: ecsMaximumHealthyPercent,
      },
    },
  };

  await fs.writeFile(path.join(fixture.integTestDir, 'cdk.json'), JSON.stringify(cdkJson));

  // GIVEN
  const stackName = 'ecs-hotswap';
  await fixture.cdkDeploy(stackName, {
    captureStderr: false,
  });

  // WHEN
  await fixture.cdkDeploy(stackName, {
    options: [
      '--hotswap',
    ],
    modEnv: {
      DYNAMIC_ECS_PROPERTY_VALUE: 'new value',
    },
  });

  const describeStacksResponse = await fixture.aws.cloudFormation.send(
    new DescribeStacksCommand({
      StackName: fixture.fullStackName(stackName),
    }),
  );

  const clusterName = describeStacksResponse.Stacks?.[0].Outputs?.find(output => output.OutputKey == 'ClusterName')?.OutputValue!;
  const serviceName = describeStacksResponse.Stacks?.[0].Outputs?.find(output => output.OutputKey == 'ServiceName')?.OutputValue!;

  // THEN
  const describeServicesResponse = await fixture.aws.ecs.send(
    new DescribeServicesCommand({
      cluster: clusterName,
      services: [serviceName],
    }),
  );
  expect(describeServicesResponse.services?.[0].deploymentConfiguration?.minimumHealthyPercent).toEqual(ecsMinimumHealthyPercent);
  expect(describeServicesResponse.services?.[0].deploymentConfiguration?.maximumPercent).toEqual(ecsMaximumHealthyPercent);
}));
