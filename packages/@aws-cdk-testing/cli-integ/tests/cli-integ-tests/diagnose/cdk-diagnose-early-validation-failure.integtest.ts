import { randomUUID } from 'node:crypto';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk diagnose after early validation failure',
  withSpecificFixture('diagnose-app', async (fixture) => {
    const bucketName = randomUUID();

    // Deploy the first stack with a named bucket — should succeed
    await fixture.cdkDeploy('diagnose-early-val-1', {
      modEnv: { BUCKET_NAME: bucketName },
    });

    // Deploy the second stack with the same bucket name — should fail with early validation
    const deployOutput = await fixture.cdkDeploy('diagnose-early-val-2', {
      modEnv: { BUCKET_NAME: bucketName },
      allowErrExit: true,
    });

    expect(deployOutput).toContain('already exists');

    // Run cdk diagnose on the second stack
    const diagnoseOutput = await fixture.cdk(
      ['--unstable=diagnose', 'diagnose', fixture.fullStackName('diagnose-early-val-2')],
      {
        modEnv: { BUCKET_NAME: bucketName },
        allowErrExit: true,
      },
    );

    // The diagnose output should mention the stack and the validation error
    expect(diagnoseOutput).toContain('diagnose-early-val-2');
    expect(diagnoseOutput).toContain('already exists');
  }),
);
