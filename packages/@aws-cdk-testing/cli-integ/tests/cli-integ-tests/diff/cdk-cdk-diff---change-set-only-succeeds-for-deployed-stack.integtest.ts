import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --change-set-only succeeds for deployed stack',
  withDefaultFixture(async (fixture) => {
    // GIVEN - deploy with one role
    await fixture.cdkDeploy('iam-roles', {
      modEnv: {
        NUMBER_OF_ROLES: '1',
      },
    });

    // WHEN - diff with an additional role using --change-set-only
    const diff = await fixture.cdk(['diff', '--change-set-only', fixture.fullStackName('iam-roles')], {
      modEnv: {
        NUMBER_OF_ROLES: '2',
      },
    });

    // THEN - should succeed and show the new role
    expect(diff).toContain('AWS::IAM::Role');
  }),
);
