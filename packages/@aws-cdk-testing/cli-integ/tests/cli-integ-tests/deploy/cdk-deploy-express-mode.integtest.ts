import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';
import { EXPRESS_MODE_REGIONS } from '../../../lib/regions';

integTest(
  'deploy and destroy in Express Mode',
  withDefaultFixture(async (fixture) => {
    // Deploy a stack using Express Mode.
    const stackArn = await fixture.cdkDeploy('test-2', {
      options: ['--express'],
      captureStderr: false,
    });

    // Verify the stack was actually created with its resources.
    const response = await fixture.aws.cloudFormation.send(
      new DescribeStackResourcesCommand({
        StackName: stackArn,
      }),
    );
    expect(response.StackResources?.length).toEqual(2);

    // Tear the stack down using Express Mode as well.
    await fixture.cdkDestroy('test-2', {
      options: ['--express'],
    });
  },
  // Express Mode is currently only available in a subset of regions.
  { aws: { regions: EXPRESS_MODE_REGIONS } }),
);
