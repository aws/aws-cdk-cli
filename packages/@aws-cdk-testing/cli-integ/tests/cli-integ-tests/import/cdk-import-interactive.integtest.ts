import { DescribeStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { CreateTopicCommand, DeleteTopicCommand } from '@aws-sdk/client-sns';
import { integTest, withDefaultFixture } from '../../../lib';

integTest('cdk import prompts the user for sns topic arns', withDefaultFixture(async (fixture) => {
  const topicName = (logicalId: string) => `${logicalId}-${fixture.randomString}`;
  const topicArn = async (name: string) => `arn:aws:sns:${fixture.aws.region}:${ await fixture.aws.account()}:${name}`;

  const topic1Name = topicName('Topic1');
  const topic2Name = topicName('Topic2');

  const topic1Arn = await topicArn(topic1Name);
  const topic2Arn = await topicArn(topic2Name);

  fixture.log(`Creating topic ${topic1Name}`);
  await fixture.aws.sns.send(new CreateTopicCommand({ Name: topic1Name }));
  fixture.log(`Creating topic ${topic2Name}`);
  await fixture.aws.sns.send(new CreateTopicCommand({ Name: topic2Name }));

  try {
    const stackName = 'two-sns-topics';
    const fullStackName = fixture.fullStackName(stackName);

    fixture.log(`Importing topics to stack ${fullStackName}`);
    await fixture.cdk(['import', fullStackName], {
      interact: [
        {
          prompt: /Topic1.*\(empty to skip\):/,
          input: topic1Arn,
        },
        {
          prompt: /Topic2.*\(empty to skip\):/,
          input: topic2Arn,
        },
      ],
      modEnv: {
        // disable coloring because it messes up prompt matching.
        FORCE_COLOR: '0',
      },
    });

    // assert the stack now has the two topics
    const stackResources = await fixture.aws.cloudFormation.send(new DescribeStackResourcesCommand({ StackName: fullStackName }));
    const stackTopicArns = new Set(stackResources.StackResources?.filter(r => r.ResourceType === 'AWS::SNS::Topic').map(r => r.PhysicalResourceId) ?? []);

    expect(stackTopicArns).toEqual(new Set([topic1Arn, topic2Arn]));
  } finally {
    fixture.log(`Deleting topic ${topic1Name}`);
    await fixture.aws.sns.send(new DeleteTopicCommand({ TopicArn: topic1Arn }));
    fixture.log(`Deleting topic ${topic2Name}`);
    await fixture.aws.sns.send(new DeleteTopicCommand({ TopicArn: topic2Arn }));
  }
}));
