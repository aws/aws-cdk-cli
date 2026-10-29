import { integTest, withSpecificFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000);

integTest(
  'deploy with lambda hook change set failure displays hook status reason',
  withSpecificFixture('lambda-hook-app', async (fixture) => {
    // Deploy the setup stack which creates the Lambda Hook via CloudFormation
    await fixture.cdkDeploy('lambda-hook-setup');

    // Attempt to deploy the test stack; the Lambda Hook fails its change set.
    // Lambda Hooks don't emit annotations, so the detailed failure reason is only
    // available via the hook result APIs and must be surfaced from there.
    const deployOutput = await fixture.cdkDeploy('lambda-hook-test', {
      allowErrExit: true,
    });
    expect(deployOutput).toContain("Hook 'Private::Lambda::TestHook' failed");
    expect(deployOutput).toContain('Ingress must not allow 0.0.0.0/0 to non-HTTP(s) ports');
  }),
);
