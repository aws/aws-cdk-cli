import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate --online reports both offline and online errors',
  withSpecificFixture('validate-online-app', async (fixture) => {
    // Deploy a stack that owns the bucket
    await fixture.cdk(
      ['deploy', '--require-approval=never', fixture.fullStackName('validate-online-deployed')],
    );

    // Validate combined stack — has both a bucket (SecurityPlugin) and
    // uses the same bucket name (CFN early validation conflict)
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', '--online', fixture.fullStackName('validate-online-combined')],
      {
        allowErrExit: true,
      },
    );

    // Offline: SecurityPlugin catches the S3 bucket
    expect(output).toContain('S3 Buckets must not be publicly accessible');
    expect(output).toContain('SecurityPlugin');

    // Online: CloudFormation catches the bucket name conflict
    expect(output).toContain('already exists');
    expect(output).toContain('CloudFormation');

    // Cleanup
    await fixture.cdk(['destroy', '--force', fixture.fullStackName('validate-online-deployed')]);
  }),
);
