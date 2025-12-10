import { DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { integTest, withDefaultFixture } from '../../../lib';

integTest('cdk destroy can destroy stacks in stage-only configuration', withDefaultFixture(async (fixture) => {
  const stageNameSuffix = 'stage';
  const specifiedStackName = `${stageNameSuffix}/*`;

  await fixture.cdkDeploy(specifiedStackName);

  const stackName = `${fixture.fullStackName(stageNameSuffix)}-StackInStage`;
  const stack = await fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
  expect(stack.Stacks?.length ?? 0).toEqual(1);

  await fixture.cdkDestroy('stage/*', {
    modEnv: {
      INTEG_STACK_SET: 'stage-only',
    },
  });

  await expect(fixture.aws.cloudFormation.send(new DescribeStacksCommand({ StackName: stackName })))
    .rejects.toThrow(/does not exist/);
}));
