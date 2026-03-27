import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';
import * as regions from '../../../lib/regions';

const SUPPORTED_REGIONS = regions.allBut([
  // AppSync isn't supported in these regions
  'ap-southeast-5',
  'ap-southeast-7',
  'ca-west-1',
  'mx-central-1',
]);

integTest('hotswap deployment supports AppSync APIs with many functions',
  withDefaultFixture(async (fixture) => {
    // GIVEN
    const stackArn = await fixture.cdkDeploy('appsync-hotswap', {
      captureStderr: false,
    });

    // WHEN
    const deployOutput = await fixture.cdkDeploy('appsync-hotswap', {
      options: ['--hotswap'],
      captureStderr: true,
      onlyStderr: true,
      modEnv: {
        DYNAMIC_APPSYNC_PROPERTY_VALUE: '$util.qr($ctx.stash.put("newTemplate", []))\n$util.toJson({})',
      },
    });

    const response = await fixture.aws.cloudFormation.send(
      new DescribeStacksCommand({
        StackName: stackArn,
      }),
    );

    expect(response.Stacks?.[0].StackStatus).toEqual('CREATE_COMPLETE');
    // assert all 50 functions were hotswapped
    for (const i of Array(50).keys()) {
      expect(deployOutput).toContain(`AWS::AppSync::FunctionConfiguration 'appsync_function${i}' hotswapped!`);
    }
  }, { aws: { regions: SUPPORTED_REGIONS }}),
);

