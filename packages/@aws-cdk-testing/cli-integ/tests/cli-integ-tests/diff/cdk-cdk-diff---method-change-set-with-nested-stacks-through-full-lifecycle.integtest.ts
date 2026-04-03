import { integTest, withDefaultFixture } from '../../../lib';

integTest(
  'cdk diff --method=change-set with nested stacks through full lifecycle',
  withDefaultFixture(async (fixture) => {
    const stackName = fixture.fullStackName('with-nested-stack');

    // 1. Diff a new stack with nested stacks (CREATE change set)
    const diffNew = await fixture.cdk(['diff', '--method=change-set', stackName]);
    // Should show the nested stack resource in the root stack
    expect(diffNew).toContain('AWS::CloudFormation::Stack');
    // Should show the SNS topic from inside the nested stack
    expect(diffNew).toContain('AWS::SNS::Topic');
    // Should use changeset-based diff, not fall back to template diff
    expect(diffNew).not.toContain('Could not create a change set');
    expect(diffNew).not.toContain('falling back to template diff');
    // Should show the changeset info message
    expect(diffNew).toContain('read-only change set');

    // 2. Deploy the stack
    await fixture.cdkDeploy('with-nested-stack');

    // 3. Diff after deploy with no changes — should report no differences
    const diffNoChanges = await fixture.cdk(['diff', '--method=change-set', stackName]);
    expect(diffNoChanges).toContain('There were no differences');
    expect(diffNoChanges).not.toContain('Could not create a change set');

    // 4. Destroy the stack
    await fixture.cdkDestroy('with-nested-stack');

    // 5. Diff again after destroy (CREATE change set for a new stack)
    const diffAfterDestroy = await fixture.cdk(['diff', '--method=change-set', stackName]);
    expect(diffAfterDestroy).toContain('AWS::CloudFormation::Stack');
    expect(diffAfterDestroy).toContain('AWS::SNS::Topic');
  }),
);
