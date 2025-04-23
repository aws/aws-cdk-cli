import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

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
  }),
);

