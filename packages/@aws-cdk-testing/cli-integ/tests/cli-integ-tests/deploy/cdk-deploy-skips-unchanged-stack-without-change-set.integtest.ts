import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'deploy skips an unchanged stack without creating a change set',
  withDefaultFixture(async (fixture) => {
    // First deploy creates the stack through a change set.
    const firstDeploy = await fixture.cdkDeploy('test-2');
    expect(firstDeploy).toContain('creating CloudFormation changeset...');

    // Deploying the same template again is skipped before a change set is created.
    const secondDeploy = await fixture.cdkDeploy('test-2');
    expect(secondDeploy).toContain('skipping deployment (use --force to override)');
    expect(secondDeploy).not.toContain('creating CloudFormation changeset...');
  }),
);
