import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DescribeServicesCommand } from '@aws-sdk/client-ecs';
import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'hotswap deployment for ecs service waits for deployment to complete',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const stackArn = await fixture.cdkDeploy('ecs-hotswap', {
      captureStderr: false,
    });

    // WHEN
    const deployOutput = await fixture.cdkDeploy('ecs-hotswap', {
      options: ['--hotswap'],
      modEnv: {
        DYNAMIC_ECS_PROPERTY_VALUE: 'new value',
      },
    });

    const describeStacksResponse = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );
    const clusterName = describeStacksResponse.Stacks?.[0].Outputs?.find((output) => output.OutputKey == 'ClusterName')
      ?.OutputValue!;
    const serviceName = describeStacksResponse.Stacks?.[0].Outputs?.find((output) => output.OutputKey == 'ServiceName')
      ?.OutputValue!;

    // THEN

    const describeServicesResponse = await fixture.aws.ecs.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName],
      }),
    );
    expect(describeServicesResponse.services?.[0].deployments).toHaveLength(1); // only one deployment present
    expect(deployOutput).toMatch(/hotswapped!/);
  }),
);

