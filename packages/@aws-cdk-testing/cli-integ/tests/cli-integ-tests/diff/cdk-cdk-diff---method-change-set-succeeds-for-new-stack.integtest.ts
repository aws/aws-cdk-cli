import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --method=change-set succeeds for new stack',
  withDefaultFixture(async (fixture) => {
    // WHEN - diff with --method=change-set against a stack that has not been deployed
    const diff = await fixture.cdk(['diff', '--method=change-set', fixture.fullStackName('test-1')]);

    // THEN - should succeed using a CREATE changeset
    expect(diff).toContain('AWS::SNS::Topic');
  }),
);
