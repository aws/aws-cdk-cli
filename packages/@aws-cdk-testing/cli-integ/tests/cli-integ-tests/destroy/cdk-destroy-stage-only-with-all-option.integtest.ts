import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest('cdk destroy can destroy stacks in stage-only configuration with --all option', withDefaultFixture(async (fixture) => {
  const integStackSet = 'stage-only';

  await fixture.cdkDeploy([], {
    options: ['--all'],
    modEnv: {
      INTEG_STACK_SET: integStackSet,
    },
  });

  const stackName = `${fixture.fullStackName('stage')}-StackInStage`;
  const stack = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
  expect(stack.Stacks?.length ?? 0).toEqual(1);

  await fixture.cdkDestroy([], {
    options: ['--all'],
    modEnv: {
      INTEG_STACK_SET: integStackSet,
    },
  });

  await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: stackName })))
    .rejects.toThrow(/does not exist/);
}));
