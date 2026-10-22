import { integTest, withSpecificFixture } from '../../../lib';

integTest(
  'cdk diff --fail-on=destructive does not fail on ignored resources',
  withSpecificFixture('destructive-changes-app', async (fixture) => {
    const stackName = fixture.fullStackName('destructive-changes');

    // GIVEN
    await fixture.cdkDeploy('destructive-changes');

    // The diff replaces one queue and deletes another
    const destructiveEnv = {
      DESTRUCTIVE_CHANGES_QUEUE_NAME: `cdktest-${fixture.randomString}-replaced`,
      DESTRUCTIVE_CHANGES_REMOVE_QUEUE: 'true',
    };

    // WHEN - the deleted queue is ignored by its construct path as shown in the diff: `RemovedQueue` is
    // `<stack>/RemovedQueue/Resource` without the stack and the trailing `Resource`, not the logical ID.
    // The queue only exists in the deployed template, so this matches the path in its metadata.
    const partlyIgnored = await fixture.cdk(['diff', '--fail-on=destructive', '--ignore-destructive', 'RemovedQueue', stackName], {
      modEnv: destructiveEnv,
      allowErrExit: true,
    });

    // THEN - the replacement still fails the diff, and the deletion is counted as ignored
    // and left out of the list of destructive changes printed after the diff (`... will be destroyed`)
    expect(partlyIgnored).toContain('Found 1 destructive change(s) (--fail-on=destructive, 1 ignored by --ignore-destructive)');
    expect(partlyIgnored).toMatch(/: AWS::SQS::Queue ReplacedQueue ReplacedQueue\w+ will be replaced/);
    expect(partlyIgnored).not.toMatch(/RemovedQueue\w+ will be destroyed/);

    // WHEN - both queues are ignored, the second one by its full construct path
    const allIgnored = await fixture.cdk([
      'diff', '--fail-on=destructive',
      '--ignore-destructive', 'RemovedQueue',
      '--ignore-destructive', '*/ReplacedQueue/Resource',
      stackName,
    ], { modEnv: destructiveEnv });

    // THEN - the command succeeds and lists no destructive change...
    expect(allIgnored).toContain('All 2 destructive change(s) are ignored by --ignore-destructive (--fail-on=destructive)');
    expect(allIgnored).not.toMatch(/will be (replaced|destroyed)/);

    // ...but the diff itself still shows both changes (`[~] ... replace`, `[-] ... destroy`)
    expect(allIgnored).toMatch(/AWS::SQS::Queue ReplacedQueue ReplacedQueue\w+ replace/);
    expect(allIgnored).toMatch(/AWS::SQS::Queue RemovedQueue RemovedQueue\w+ destroy/);
  }),
);
