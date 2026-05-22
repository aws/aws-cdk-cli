import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk validate --online reports both offline and online errors',
  withSpecificFixture('validate-online-app', async (fixture) => {
    const output = await fixture.cdk(
      ['--unstable=validate', 'validate', '--online', fixture.fullStackName('validate-online-combined')],
      {
        allowErrExit: true,
      },
    );

    // Offline: SecurityPlugin catches the S3 bucket
    expect(output).toContain('S3 Buckets must not be publicly accessible');
    expect(output).toContain('SecurityPlugin');

    // Online: CloudFormation rejects the fake resource type
    expect(output).toContain('AWS::Fake::DoesNotExist');
    expect(output).toContain('CloudFormation');
  }),
);
