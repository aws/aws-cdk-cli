import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'detects refactoring changes and prints the result',
  withSpecificFixture('refactoring', async (fixture) => {
    // First, deploy a stack
    await fixture.cdkDeploy('basic', {
      modEnv: {
        BASIC_QUEUE_LOGICAL_ID: 'OldName',
      },
    });

    // Then see if the refactoring tool detects the change
    const stdErr = await fixture.cdkRefactor({
      options: ['--dry-run', '--unstable=refactor'],
      allowErrExit: true,
      // Making sure the synthesized stack has the new name
      // so that a refactor is detected
      modEnv: {
        BASIC_QUEUE_LOGICAL_ID: 'NewName',
      },
    });

    expect(stdErr).toContain('The following resources were moved or renamed:');
    expect(removeColor(stdErr)).toMatch(/│ AWS::SQS::Queue │ .*\/OldName\/Resource │ .*\/NewName\/Resource │/);
  }),
);

integTest(
  'no refactoring changes detected',
  withSpecificFixture('refactoring', async (fixture) => {
    const modEnv = {
      BASIC_QUEUE_LOGICAL_ID: 'OldName',
    };

    // First, deploy a stack
    await fixture.cdkDeploy('basic', { modEnv });

    // Then see if the refactoring tool detects the change
    const stdErr = await fixture.cdkRefactor({
      options: ['--dry-run', '--unstable=refactor'],
      allowErrExit: true,
      modEnv,
    });

    expect(stdErr).toContain('Nothing to refactor');
  }),
);

function removeColor(str: string): string {
  return str.replace(/\x1B[[(?);]{0,2}(;?\d)*./g, '');
}

