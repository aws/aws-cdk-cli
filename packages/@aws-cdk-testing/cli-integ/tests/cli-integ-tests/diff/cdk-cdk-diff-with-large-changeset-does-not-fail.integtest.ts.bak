import { integTest, withDefaultFixture } from '../../../lib';

jest.setTimeout(2 * 60 * 60_000); // Includes the time to acquire locks, worst-case single-threaded runtime

integTest(
  'cdk diff with large changeset does not fail',
  withDefaultFixture(async (fixture) => {
    // GIVEN - small initial stack with only one IAM role
    await fixture.cdkDeploy('iam-roles', {
      modEnv: {
        NUMBER_OF_ROLES: '1',
      },
    });

    // WHEN - adding an additional role with a ton of metadata to create a large diff
    const diff = await fixture.cdk(['diff', fixture.fullStackName('iam-roles')], {
      verbose: true,
      modEnv: {
        NUMBER_OF_ROLES: '2',
      },
    });

    // Assert that the CLI assumes the file publishing role:
    expect(diff).toMatch(/Assuming role .*file-publishing-role/);
    expect(diff).toContain('success: Published');
  }),
);

