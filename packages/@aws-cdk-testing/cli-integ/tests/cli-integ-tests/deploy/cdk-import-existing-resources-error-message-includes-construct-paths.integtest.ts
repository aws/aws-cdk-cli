import { DeleteRoleCommand } from '@aws-sdk/client-iam';
import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'import-existing-resources error message includes construct paths',
  withSpecificFixture('import-existing-resources-app', async (fixture) => {
    const roleName = `${fixture.stackNamePrefix}-import-role`;

    try {
      // Step 1: Deploy with RETAIN so the role exists and can survive stack deletion
      await fixture.cdkDeploy('import-existing', {
        modEnv: { REMOVAL_POLICY: 'retain' },
      });

      // Step 2: Delete the stack — the role survives because of RETAIN
      await fixture.cdkDestroy('import-existing', {
        modEnv: { REMOVAL_POLICY: 'retain' },
      });

      // Step 3: Re-deploy with DESTROY (no retain) and --import-existing-resources
      // This should fail because CloudFormation requires DeletionPolicy=Retain for import
      const stdErr = await fixture.cdkDeploy('import-existing', {
        modEnv: { REMOVAL_POLICY: 'destroy' },
        options: ['--import-existing-resources'],
        allowErrExit: true,
      });

      expect(stdErr).toContain('needs a DeletionPolicy');
      expect(stdErr).toContain('MyRole');
      expect(stdErr).toContain('RemovalPolicy.RETAIN');
      expect(stdErr).toContain('https://docs.aws.amazon.com/cdk/v2/guide/resources.html#resources-removal');

      // Step 4: Deploy with RETAIN and --import-existing-resources — this should succeed
      await fixture.cdkDeploy('import-existing', {
        modEnv: { REMOVAL_POLICY: 'retain' },
        options: ['--import-existing-resources'],
      });
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
