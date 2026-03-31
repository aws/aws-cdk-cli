import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --method=change-set through full lifecycle',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('test-1');

    // 1. Diff a new stack (CREATE change set)
    const diffNew = await fixture.cdk(['diff', '--method=change-set', stackName]);
    expect(diffNew).toContain('AWS::SNS::Topic');

    // 2. Deploy the stack
    await fixture.cdkDeploy('test-1');

    // 3. Destroy the stack
    await fixture.cdkDestroy('test-1');

    // 4. Diff again after destroy (CREATE change set again)
    const diffAfterDestroy = await fixture.cdk(['diff', '--method=change-set', stackName]);
    expect(diffAfterDestroy).toContain('AWS::SNS::Topic');
  }),
);
