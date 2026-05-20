import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --method=change-set does not leave stack in REVIEW_IN_PROGRESS',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('test-1');

    // WHEN - diff against a stack that has not been deployed
    await fixture.cdk(['diff', '--method=change-set', stackName]);

    // THEN - the stack should be deleted or deleting (not stuck in REVIEW_IN_PROGRESS)
    const status = await fixture.aws.stackStatus(stackName);
    expect(status).not.toBe('REVIEW_IN_PROGRESS');
  }),
);
