import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000);

integTest(
  'cdk diagnose after guard hook failure displays hook failure details',
  withSpecificFixture('guard-hook-app', async (fixture) => {
    // Deploy the setup stack which creates the Guard Hook via CloudFormation
    await fixture.cdkDeploy('guard-hook-setup');

    // Attempt to deploy the non-compliant stack; it fails due to the Guard Hook.
    // --no-rollback leaves the stack in CREATE_FAILED so diagnose can inspect it.
    const deployOutput = await fixture.cdkDeploy('guard-hook-test', {
      options: ['--no-rollback'],
      allowErrExit: true,
    });
    expect(deployOutput).toContain('CREATE_FAILED');

    // Run cdk diagnose on the failed stack
    const diagnoseOutput = await fixture.cdk(
      ['--unstable=diagnose', 'diagnose', fixture.fullStackName('guard-hook-test')],
      { allowErrExit: true },
    );

    // diagnose has no live activity stream, so the hook failure details must have
    // been fetched via the GetHookResult API and attached to the diagnosis
    expect(diagnoseOutput).toContain("Hook 'Private::Guard::TestHook' failed: NonCompliant Rules:");
    expect(diagnoseOutput).toContain('[AWS_S3_Bucket_AccessControl]');
    expect(diagnoseOutput).toContain('• Check was not compliant as property [/Resources/NonCompliantBucket/Properties/AccessControl[L:0,C:91]] existed.');
    expect(diagnoseOutput).toContain('Remediation: AccessControl is deprecated');
  }),
);
