import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk refactor - dry run - filters stacks by pattern',
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
