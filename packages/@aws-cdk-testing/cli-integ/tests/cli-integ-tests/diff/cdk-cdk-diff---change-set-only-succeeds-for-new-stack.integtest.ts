import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --change-set-only succeeds for new stack',
  withDefaultFixture(async (fixture) => {
    // WHEN - diff with --change-set-only against a stack that has not been deployed
    const diff = await fixture.cdk(['diff', '--change-set-only', fixture.fullStackName('test-1')]);

    // THEN - should succeed using a CREATE changeset
    expect(diff).toContain('AWS::SNS::Topic');
  }),
);
