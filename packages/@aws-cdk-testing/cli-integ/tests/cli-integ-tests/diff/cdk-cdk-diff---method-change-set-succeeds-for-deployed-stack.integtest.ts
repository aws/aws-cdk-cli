import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --method=change-set succeeds for deployed stack',
  withDefaultFixture(async (fixture) => {
    // GIVEN - deploy with one role
    await fixture.cdkDeploy('iam-roles', {
      modEnv: {
        NUMBER_OF_ROLES: '1',
      },
    });

    // WHEN - diff with an additional role using --method=change-set
    const diff = await fixture.cdk(['diff', '--method=change-set', fixture.fullStackName('iam-roles')], {
      modEnv: {
        NUMBER_OF_ROLES: '2',
      },
    });

    // THEN - should succeed and show the new role
    expect(diff).toContain('AWS::IAM::Role');
  }),
);
