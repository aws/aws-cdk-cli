import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --method=change-set can be run twice on a new stack',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('test-1');

    // First diff creates a CREATE changeset, leaving the stack in REVIEW_IN_PROGRESS
    const diff1 = await fixture.cdk(['diff', '--method=change-set', stackName]);
    expect(diff1).toContain('AWS::SNS::Topic');

    // Second diff should also succeed, not fail with "Stack does not exist" or UPDATE errors
    const diff2 = await fixture.cdk(['diff', '--method=change-set', stackName]);
    expect(diff2).toContain('AWS::SNS::Topic');
  }),
);
