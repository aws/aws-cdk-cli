import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --method=change-set with doubly nested stacks',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('with-doubly-nested-stack');

    // Diff a stack with two levels of nesting
    const diff = await fixture.cdk(['diff', '--method=change-set', stackName]);

    // Root stack should contain the outer nested stack
    expect(diff).toContain('AWS::CloudFormation::Stack');
    // The inner nested stack should contain the SNS topic
    expect(diff).toContain('AWS::SNS::Topic');
    // Should use changeset-based diff successfully
    expect(diff).not.toContain('Could not create a change set');
    expect(diff).toContain('read-only change set');
  }),
);
