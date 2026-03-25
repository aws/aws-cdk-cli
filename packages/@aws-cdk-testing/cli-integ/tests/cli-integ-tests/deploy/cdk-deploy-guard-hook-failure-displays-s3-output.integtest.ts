import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000);

integTest(
  'deploy with guard hook failure displays S3 output',
  withSpecificFixture('guard-hook-app', async (fixture) => {
    // Deploy the setup stack, which creates the S3 buckets, uploads the Guard rule,
    // and activates the Guard Hook via CloudFormation
    await fixture.cdkDeploy('guard-hook-setup');

    // Attempt to deploy non-compliant stack (should fail due to Guard Hook)
    const deployOutput = await fixture.cdkDeploy('guard-hook-test', {
      options: ['--no-rollback'],
      allowErrExit: true,
    });
    expect(deployOutput).toContain('CREATE_FAILED');
    expect(deployOutput).toContain('NonCompliant Rules:');
    expect(deployOutput).toContain('[AWS_S3_Bucket_AccessControl]');
    expect(deployOutput).toContain('• AccessControl is deprecated');
    expect(deployOutput).toContain('Full output was written to s3://');
  }),
);
