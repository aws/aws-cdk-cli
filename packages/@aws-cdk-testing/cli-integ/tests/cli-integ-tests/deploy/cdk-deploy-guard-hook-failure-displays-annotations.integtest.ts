import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000);

integTest(
  'deploy with guard hook failure displays hook annoations',
  withSpecificFixture('guard-hook-app', async (fixture) => {
    // Deploy the setup stack which creates the Guard Hook via CloudFormation
    await fixture.cdkDeploy('guard-hook-setup');

    // Attempt to deploy non-compliant stack (should fail due to Guard Hook)
    const deployOutput = await fixture.cdkDeploy('guard-hook-test', {
      options: ['--no-rollback'],
      allowErrExit: true,
    });
    expect(deployOutput).toContain('CREATE_FAILED');
    expect(deployOutput).toContain('NonCompliant Rules:');
    expect(deployOutput).toContain('[AWS_S3_Bucket_AccessControl]');
    expect(deployOutput).toContain('• Check was not compliant as property [/Resources/NonCompliantBucket/Properties/AccessControl[L:0,C:91]] existed.');
    expect(deployOutput).toContain('Remediation: AccessControl is deprecated');
  }),
);
