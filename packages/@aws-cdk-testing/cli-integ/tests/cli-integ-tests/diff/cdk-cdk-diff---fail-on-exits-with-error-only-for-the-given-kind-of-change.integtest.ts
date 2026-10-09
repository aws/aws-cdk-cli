import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --fail-on exits with error only for the given kind of change',
  withDefaultFixture(async (fixture) => {
    // Neither stack is deployed: 'iam-test' adds an IAM role (broadening), 'test-1' only adds SNS topics
    const iamStack = fixture.fullStackName('iam-test');
    const topicStack = fixture.fullStackName('test-1');

    // --fail-on=any-change fails on any difference
    await expect(fixture.cdk(['diff', '--fail-on=any-change', topicStack])).rejects.toThrow('exited with error');

    // --fail-on=broadening fails only on changes that broaden security permissions
    await expect(fixture.cdk(['diff', '--fail-on=broadening', iamStack])).rejects.toThrow('exited with error');
    await fixture.cdk(['diff', '--fail-on=broadening', topicStack]);

    // --fail-on=never does not fail
    await fixture.cdk(['diff', '--fail-on=never', iamStack]);
  }),
);
