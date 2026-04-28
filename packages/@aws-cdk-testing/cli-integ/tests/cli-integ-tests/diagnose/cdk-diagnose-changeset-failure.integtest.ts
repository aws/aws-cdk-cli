import { DeleteRoleCommand } from '@aws-sdk/client-iam';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk diagnose after changeset failure (auto-import)',
  withSpecificFixture('diagnose-app', async (fixture) => {
    const roleName = `${fixture.stackNamePrefix}-diagnose-import-role`;

    try {
      // Step 1: Deploy with RETAIN so the role survives stack deletion
      await fixture.cdkDeploy('diagnose-import-fail', {
        modEnv: { REMOVAL_POLICY: 'retain' },
      });

      // Step 2: Delete the stack — the role survives because of RETAIN
      await fixture.cdkDestroy('diagnose-import-fail', {
        modEnv: { REMOVAL_POLICY: 'retain' },
      });

      // Step 3: Re-deploy with DESTROY (no retain) and --import-existing-resources
      // This should fail because CloudFormation requires DeletionPolicy=Retain for import
      const deployOutput = await fixture.cdkDeploy('diagnose-import-fail', {
        modEnv: { REMOVAL_POLICY: 'destroy' },
        options: ['--import-existing-resources'],
        allowErrExit: true,
      });

      expect(deployOutput).toContain('DeletionPolicy');

      // Step 4: Run cdk diagnose
      const diagnoseOutput = await fixture.cdk(
        ['--unstable=diagnose', 'diagnose', fixture.fullStackName('diagnose-import-fail')],
        {
          modEnv: { REMOVAL_POLICY: 'destroy' },
          allowErrExit: true,
        },
      );

      // The diagnose output should mention the import issue
      expect(diagnoseOutput).toContain('diagnose-import-fail');
      expect(diagnoseOutput).toContain('DeletionPolicy');
    } finally {
      // Clean up: delete the role if it was retained
      try {
        await fixture.aws.iam.send(new DeleteRoleCommand({ RoleName: roleName }));
      } catch {
        // Role may already be deleted
      }
    }
  }),
);
