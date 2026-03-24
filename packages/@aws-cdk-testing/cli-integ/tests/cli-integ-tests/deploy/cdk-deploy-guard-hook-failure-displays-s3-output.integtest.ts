import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000);

integTest(
  'deploy with guard hook failure displays S3 output',
  withSpecificFixture('guard-hook-app', async (fixture) => {
    const logsBucket = `${fixture.stackNamePrefix}-guard-logs`;

    // Deploy the setup stack, which creates the S3 buckets, uploads the Guard rule,
    // and activates the Guard Hook via CloudFormation
    await fixture.cdkDeploy('guard-hook-setup');

    try {
      // Attempt to deploy non-compliant stack (should fail due to Guard Hook)
      const deployOutput = await fixture.cdkDeploy('guard-hook-test', {
        allowErrExit: true,
      });
      expect(deployOutput).toContain('CREATE_FAILED');
      expect(deployOutput).toContain('NonCompliant Rules:');
      expect(deployOutput).toContain('[AWS_S3_Bucket_AccessControl]');
      expect(deployOutput).toContain('• AccessControl is deprecated');
      expect(deployOutput).toContain(`Full output was written to s3://${logsBucket}`);
    } finally {
      // Destroy the test stack if it exists (may be in ROLLBACK_COMPLETE state)
      await fixture.cdkDestroy('guard-hook-test', { allowErrExit: true });
      // Destroy the setup stack, which removes the Guard Hook, S3 buckets, and IAM role
      await fixture.cdkDestroy('guard-hook-setup');
    }
  }),
);
