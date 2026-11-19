import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff prepares independent and nested stacks concurrently',
  withDefaultFixture(async (fixture) => {
    const names = ['test-1', 'with-doubly-nested-stack'].map(name => fixture.fullStackName(name));
    const diff = await fixture.cdk([
      'diff', ...names, '--exclusively', '--method=change-set', '--fail-on=never', '--concurrency=2',
    ]);
    for (const name of names) {
      expect(diff).toContain(name);
    }
    expect(diff).toContain('AWS::CloudFormation::Stack');
    expect(diff).toContain('AWS::SNS::Topic');
    expect(diff).not.toContain('Could not create a change set');
    expect(diff).toContain('read-only change set');
  }),
);
