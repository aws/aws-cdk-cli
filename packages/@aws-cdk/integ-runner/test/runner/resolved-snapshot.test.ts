import type { EvaluatedStack } from '@aws-cdk/toolkit-lib';
import { resolvedSnapshot } from '../../lib/runner/resolved-snapshot';

/**
 * The same app deployed twice: every generated name and id differs, in different accounts and regions
 */
function deployment(suffix: string, account: string, region: string): EvaluatedStack {
  const queueName = `my-stack-JobsQueue1A2B3C4D-${suffix}Q`;
  const queueUrl = `https://sqs.${region}.amazonaws.com/${account}/${queueName}`;
  const roleName = `my-stack-HandlerServiceRole-${suffix}R`;
  const functionName = `my-stack-Handler886CB40B-${suffix}F`;
  return {
    stackName: 'my-stack',
    hierarchicalId: 'my-stack',
    stackId: `arn:aws:cloudformation:${region}:${account}:stack/my-stack/${suffix}-0000-11f1-a84b-0affd9b7fb2d`,
    physicalResourceIds: {
      JobsQueue1A2B3C4D: queueUrl,
      HandlerServiceRole: roleName,
      Handler886CB40B: functionName,
      ApiResource: `${suffix.slice(0, 6)}`,
      WebAcl: `my-acl|0f3a${suffix}-5b6c-7d8e|REGIONAL`,
      ApiStage: 'prod',
      ApiAccount: `my-sta-ApiAc-${suffix}`,
    },
    template: {
      Resources: {
        Handler886CB40B: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            Role: `arn:aws:iam::${account}:role/${roleName}`,
            Environment: { Variables: { QUEUE_URL: queueUrl, STAGE: 'prod' } },
          },
        },
        AlarmQueueDepth: {
          Type: 'AWS::CloudWatch::Alarm',
          Properties: { Dimensions: [{ Name: 'QueueName', Value: queueName }], Namespace: 'AWS/SQS' },
        },
        ApiMethod: {
          Type: 'AWS::ApiGateway::Method',
          Properties: { ResourceId: suffix.slice(0, 6), HttpMethod: 'GET' },
        },
        WebAclAssociation: {
          Type: 'AWS::WAFv2::WebACLAssociation',
          Properties: { WebACLArn: `arn:aws:wafv2:${region}:${account}:regional/webacl/my-acl/0f3a${suffix}-5b6c-7d8e`, Scope: 'REGIONAL' },
        },
        ApiStage: {
          Type: 'AWS::ApiGateway::Stage',
          Properties: { StageName: 'prod' },
        },
        ApiAccount: {
          Type: 'AWS::ApiGateway::Account',
          Properties: { CloudWatchRoleArn: `arn:aws:iam::${account}:role/${roleName}` },
        },
      },
      Outputs: {
        QueueUrl: { Value: queueUrl },
      },
    },
    unresolved: [],
  };
}

describe('resolvedSnapshot', () => {
  test('is the same for two deployments of the same app, in different accounts and regions', () => {
    const a = resolvedSnapshot(deployment('7l66agrnngob', '111111111111', 'us-east-1'));
    const b = resolvedSnapshot(deployment('xt2nevv23fvk', '222222222222', 'eu-west-2'));

    expect(a).toEqual(b);
  });

  test('replaces physical ids, the names inside them, and the account, region and partition', () => {
    const snapshot = resolvedSnapshot(deployment('7l66agrnngob', '111111111111', 'us-east-1'));

    expect(snapshot.resources.Handler886CB40B.Properties).toEqual({
      Role: 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${HandlerServiceRole}',
      Environment: { Variables: { QUEUE_URL: '${JobsQueue1A2B3C4D}', STAGE: 'prod' } },
    });
    expect(snapshot.resources.AlarmQueueDepth.Properties.Dimensions).toEqual([{ Name: 'QueueName', Value: '${JobsQueue1A2B3C4D.Name}' }]);
    expect(snapshot.outputs).toEqual({ QueueUrl: { Value: '${JobsQueue1A2B3C4D}' } });
  });

  test('keeps names the template chooses', () => {
    const snapshot = resolvedSnapshot(deployment('7l66agrnngob', '111111111111', 'us-east-1'));

    expect(snapshot.resources.ApiStage.Properties).toEqual({ StageName: 'prod' });
  });

  test('replaces short ids only when they are the whole value', () => {
    const snapshot = resolvedSnapshot(deployment('7l66agrnngob', '111111111111', 'us-east-1'));

    expect(snapshot.resources.ApiMethod.Properties).toEqual({ ResourceId: '${ApiResource}', HttpMethod: 'GET' });
  });

  test('replaces the generated parts of composite physical ids, but not words', () => {
    const snapshot = resolvedSnapshot(deployment('7l66agrnngob', '111111111111', 'us-east-1'));

    expect(snapshot.resources.WebAclAssociation.Properties).toEqual({
      WebACLArn: 'arn:${AWS::Partition}:wafv2:${AWS::Region}:${AWS::AccountId}:regional/webacl/my-acl/${WebAcl[1]}',
      Scope: 'REGIONAL',
    });
  });

  test('lists resources with account-wide settings', () => {
    const snapshot = resolvedSnapshot(deployment('7l66agrnngob', '111111111111', 'us-east-1'));

    expect(snapshot.accountWide).toEqual(['ApiAccount']);
  });

  test('keeps unresolved expressions, and includes nested stacks', () => {
    const parent = deployment('7l66agrnngob', '111111111111', 'us-east-1');
    const nested: EvaluatedStack = {
      ...deployment('9p8o7i6u5y4t', '111111111111', 'us-east-1'),
      stackName: 'my-stack-Nested-ABC123',
      unresolved: [{ path: 'Resources.X.Properties.Y', intrinsic: 'Fn::GetAZs', reason: 'not supported' }],
    };

    const snapshot = resolvedSnapshot({ ...parent, nestedStacks: { NestedStack: nested } });

    expect(snapshot.nestedStacks?.NestedStack.stackName).toEqual('my-stack-Nested-ABC123');
    expect(snapshot.nestedStacks?.NestedStack.unresolved).toEqual(nested.unresolved);
    expect(snapshot.nestedStacks?.NestedStack.resources.Handler886CB40B.Properties.Role)
      .toEqual('arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${HandlerServiceRole}');
  });
});
