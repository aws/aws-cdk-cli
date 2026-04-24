import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk diagnose after deployment failure',
  withSpecificFixture('diagnose-app', async (fixture) => {
    // Deploy a stack that will fail (IAM Policy without PolicyDocument)
    const deployOutput = await fixture.cdkDeploy('diagnose-deploy-fail', {
      allowErrExit: true,
    });

    // The deploy should have failed
    expect(deployOutput).toContain('Required property [PolicyName] not found');

    // Run cdk diagnose on the failed stack
    const diagnoseOutput = await fixture.cdk(
      ['diagnose', fixture.fullStackName('diagnose-deploy-fail')],
      { allowErrExit: true },
    );

    // The diagnose output should mention the stack and contain error information
    expect(diagnoseOutput).toContain('diagnose-deploy-fail');
    expect(diagnoseOutput).toContain('Required property [PolicyName] not found');
  }),
);
