import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk diagnose after deployment failure',
  withSpecificFixture('diagnose-app', async (fixture) => {
    // Deploy a stack that will fail (IAM Policy without PolicyDocument)
    const deployOutput = await fixture.cdkDeploy('diagnose-deploy-fail', {
      allowErrExit: true,
    });

    // The deploy should have failed.
    // Missing property failure counts as "early validation failure".
    expect(deployOutput).toContain('Early validation failed for change set');
    expect(deployOutput).toContain('Required property [PolicyDocument] not found');

    // Run cdk diagnose on the failed stack
    const diagnoseOutput = await fixture.cdk(
      ['--unstable=diagnose', 'diagnose', fixture.fullStackName('diagnose-deploy-fail')],
      { allowErrExit: true },
    );

    // The diagnose output should mention the stack and contain error information
    expect(diagnoseOutput).toContain('diagnose-deploy-fail');
    expect(diagnoseOutput).toContain('Early validation failed for change set');
    expect(diagnoseOutput).toContain('Required property [PolicyDocument] not found');
  }),
);
