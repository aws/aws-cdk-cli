import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk diff --fail-on=destructive fails only on replacement or deletion',
  withSpecificFixture('destructive-changes-app', async (fixture) => {
    const stackName = fixture.fullStackName('destructive-changes');

    // GIVEN
    await fixture.cdkDeploy('destructive-changes');

    // WHEN - the only change updates a resource in place
    const inPlaceDiff = await fixture.cdk(['diff', '--fail-on=destructive', stackName], {
      modEnv: { DESTRUCTIVE_CHANGES_VISIBILITY_TIMEOUT: '60' },
    });

    // THEN - the change is shown, but the command succeeds
    expect(inPlaceDiff).toContain('VisibilityTimeout');
    expect(inPlaceDiff).not.toContain('destructive change');

    // WHEN - the diff replaces one resource and deletes another
    const destructiveEnv = {
      DESTRUCTIVE_CHANGES_VISIBILITY_TIMEOUT: '60',
      DESTRUCTIVE_CHANGES_QUEUE_NAME: `cdktest-${fixture.randomString}-replaced`,
      DESTRUCTIVE_CHANGES_REMOVE_QUEUE: 'true',
    };

    // THEN - the command exits with an error...
    await expect(
      fixture.cdk(['diff', '--fail-on=destructive', stackName], { modEnv: destructiveEnv }),
    ).rejects.toThrow('exited with error');

    // ...and lists the destructive changes, but not the in-place update
    const destructiveDiff = await fixture.cdk(['diff', '--fail-on=destructive', stackName], {
      modEnv: destructiveEnv,
      allowErrExit: true,
    });
    expect(destructiveDiff).toContain('Found 2 destructive change(s)');
    expect(destructiveDiff).toMatch(/: AWS::SQS::Queue ReplacedQueue ReplacedQueue\w+ will be replaced/);
    expect(destructiveDiff).toMatch(/: AWS::SQS::Queue RemovedQueue RemovedQueue\w+ will be destroyed/);
    expect(destructiveDiff).not.toMatch(/UpdatedQueue\w* will be/);

    // The same diff succeeds without the option
    await fixture.cdk(['diff', '--no-fail', stackName], { modEnv: destructiveEnv });
  }),
);
