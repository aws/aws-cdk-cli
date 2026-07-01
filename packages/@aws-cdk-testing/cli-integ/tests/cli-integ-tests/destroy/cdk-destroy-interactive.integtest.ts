import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest('cdk destroy prompts the user for confirmation', withDefaultFixture(async (fixture) => {
  const stackName = 'test-2';
  const fullStackName = fixture.fullStackName(stackName);

  fixture.log(`Deploying stack ${fullStackName}`);
  await fixture.cdkDeploy(stackName);

  fixture.log(`Destroying stack ${fullStackName} and declining prompt`);
  const output = await fixture.cdkDestroy(stackName, {
    force: false,
    // Declining the confirmation aborts the command with a non-zero exit code.
    allowErrExit: true,
    interact: [
      { prompt: /Are you sure you want to delete/, input: 'no' },
    ],
    modEnv: {
      // disable coloring because it messes up prompt matching.
      FORCE_COLOR: '0',
    },
  });

  // the decline is reported softly, not as a crash
  expect(output).toContain('Deletion cancelled');

  // assert we didn't destroy the stack
  const stack = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: fullStackName }));
  expect(stack.Stacks?.length ?? 0).toEqual(1);

  fixture.log(`Destroying stack ${fullStackName} and accepting prompt`);
  await fixture.cdkDestroy(stackName, {
    force: false,
    interact: [
      { prompt: /Are you sure you want to delete/, input: 'yes' },
    ],
  });

  // assert we did destroy the stack
  await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: fullStackName })))
    .rejects.toThrow(/does not exist/);
}));
