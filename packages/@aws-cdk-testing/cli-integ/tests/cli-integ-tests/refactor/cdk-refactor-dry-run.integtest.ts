import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk refactor - detects refactoring changes and prints the result',
  withSpecificFixture('refactoring', async (fixture) => {
    // First, deploy the stacks
    await fixture.cdkDeploy('bucket-stack');
    await fixture.cdkDeploy('basic', {
      modEnv: {
        BASIC_QUEUE_LOGICAL_ID: 'OldName',
      },
    });

    // Then see if the refactoring tool detects the change
    const stdErr = await fixture.cdkRefactor({
      options: ['--dry-run', '--unstable=refactor'],
      allowErrExit: true,
      // Making sure the synthesized stack has a queue with
      // the new name so that a refactor is detected
      modEnv: {
        BASIC_QUEUE_LOGICAL_ID: 'NewName',
      },
    });

    expect(stdErr).toContain('The following resources were moved or renamed:');
    expect(removeColor(stdErr)).toMatch(/│ AWS::SQS::Queue │ .*\/OldName\/Resource │ .*\/NewName\/Resource │/);
  }),
);

integTest(
  'cdk refactor - no refactoring changes detected',
  withSpecificFixture('refactoring', async (fixture) => {
    const modEnv = {
      BASIC_QUEUE_LOGICAL_ID: 'OldName',
    };

    // First, deploy the stacks
    await fixture.cdkDeploy('bucket-stack');
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

integTest(
  'cdk refactor - filters stacks by pattern',
  withSpecificFixture('refactoring-multiple-envs', async (fixture) => {
    // First, deploy the stacks
    await fixture.cdkDeploy('gamma-stack', {
      modEnv: {
        BUCKET_ID: 'OldName',
      },
    });
    await fixture.cdkDeploy('prod-stack', {
      modEnv: {
        BUCKET_ID: 'OldName',
      },
    });

    // Then see if the refactoring tool detects the change
    const stdErr = await fixture.cdkRefactor({
      options: ['*-gamma-stack', '--dry-run', '--unstable=refactor'],
      allowErrExit: true,
      captureStderr: true,
      // Making sure the synthesized stack has a queue with
      // the new name so that a refactor is detected
      modEnv: {
        BUCKET_ID: 'NewName',
      },
    });

    const numberOfEnvironments = (stdErr.match(/Resource Type/g) || []).length;
    expect(numberOfEnvironments).toEqual(1);
  }),
);

function removeColor(str: string): string {
  return str.replace(/\x1B[[(?);]{0,2}(;?\d)*./g, '');
}

