import { fullDiff, ResourceImpact } from '@aws-cdk/cloudformation-diff';
import { describeDestructiveImpact, findDestructiveChanges, formatDestructiveChange } from '../../../lib/api/diff/destructive-changes';

const oldTemplate = {
  Resources: {
    Updated: { Type: 'AWS::SQS::Queue', Properties: { VisibilityTimeout: 30 } },
    Replaced: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'old-name' } },
    Removed: { Type: 'AWS::SNS::Topic' },
    Retained: { Type: 'AWS::DynamoDB::Table', DeletionPolicy: 'Retain', Properties: {} },
    TypeChanged: { Type: 'AWS::SQS::Queue' },
  },
};

const newTemplate = {
  Resources: {
    Updated: { Type: 'AWS::SQS::Queue', Properties: { VisibilityTimeout: 60 } },
    Replaced: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'new-name' } },
    TypeChanged: { Type: 'AWS::SNS::Topic' },
    Added: { Type: 'AWS::SNS::Topic' },
  },
};

describe('findDestructiveChanges', () => {
  test('collects replacements, deletions and orphans, but not updates or additions', () => {
    const changes = findDestructiveChanges({ MyStack: fullDiff(oldTemplate, newTemplate) });

    expect(changes).toEqual(expect.arrayContaining([
      { stackName: 'MyStack', logicalId: 'Replaced', resourceType: 'AWS::S3::Bucket', impact: ResourceImpact.WILL_REPLACE },
      { stackName: 'MyStack', logicalId: 'Removed', resourceType: 'AWS::SNS::Topic', impact: ResourceImpact.WILL_DESTROY },
      { stackName: 'MyStack', logicalId: 'Retained', resourceType: 'AWS::DynamoDB::Table', impact: ResourceImpact.WILL_ORPHAN },
      { stackName: 'MyStack', logicalId: 'TypeChanged', resourceType: 'AWS::SQS::Queue', impact: ResourceImpact.WILL_REPLACE },
    ]));
    expect(changes).toHaveLength(4);
  });

  test('reports the construct path from the resource metadata', () => {
    const changes = findDestructiveChanges({
      MyStack: fullDiff(
        { Resources: { Removed: { Type: 'AWS::SNS::Topic', Metadata: { 'aws:cdk:path': 'MyStack/Old/Resource' } } } },
        { Resources: { Replaced: { Type: 'AWS::SNS::Topic', Metadata: { 'aws:cdk:path': 'MyStack/New/Resource' } } } },
      ),
    });

    expect(changes).toEqual([
      { stackName: 'MyStack', logicalId: 'Removed', resourceType: 'AWS::SNS::Topic', constructPath: 'MyStack/Old/Resource', impact: ResourceImpact.WILL_DESTROY },
    ]);
  });

  test('prefers the given construct paths over the resource metadata', () => {
    const changes = findDestructiveChanges(
      { MyStack: fullDiff({ Resources: { Removed: { Type: 'AWS::SNS::Topic', Metadata: { 'aws:cdk:path': 'MyStack/Old/Resource' } } } }, {}) },
      { MyStack: { Removed: 'MyStack/FromAssembly/Resource' } },
    );

    expect(changes[0].constructPath).toEqual('MyStack/FromAssembly/Resource');
  });

  test('reports the stack each change belongs to', () => {
    const changes = findDestructiveChanges({
      Clean: fullDiff(newTemplate, newTemplate),
      Dirty: fullDiff({ Resources: { Removed: { Type: 'AWS::SNS::Topic' } } }, {}),
    });

    expect(changes).toEqual([
      { stackName: 'Dirty', logicalId: 'Removed', resourceType: 'AWS::SNS::Topic', impact: ResourceImpact.WILL_DESTROY },
    ]);
  });

  test('ignores CDK metadata, which is not a physical resource', () => {
    const changes = findDestructiveChanges({
      MyStack: fullDiff({ Resources: { CDKMetadata: { Type: 'AWS::CDK::Metadata', Properties: { Analytics: 'v2' } } } }, {}),
    });

    expect(changes).toEqual([]);
  });

  test('reports where a moved resource was moved to', () => {
    const templateDiff = fullDiff({ Resources: { Removed: { Type: 'AWS::SNS::Topic' } } }, {});
    templateDiff.resources.get('Removed').move = { direction: 'to', stackName: 'OtherStack', resourceLogicalId: 'Moved' };

    const changes = findDestructiveChanges({ MyStack: templateDiff });

    expect(changes).toEqual([{
      stackName: 'MyStack',
      logicalId: 'Removed',
      resourceType: 'AWS::SNS::Topic',
      impact: ResourceImpact.WILL_DESTROY,
      move: { direction: 'to', stackName: 'OtherStack', resourceLogicalId: 'Moved' },
    }]);
  });

  test('returns nothing when there are no diffs', () => {
    expect(findDestructiveChanges({})).toEqual([]);
  });
});

describe('formatDestructiveChange', () => {
  test('includes the resource type and impact', () => {
    expect(formatDestructiveChange({
      stackName: 'MyStack', logicalId: 'MyBucket', resourceType: 'AWS::S3::Bucket', impact: ResourceImpact.WILL_REPLACE,
    })).toEqual('MyStack: AWS::S3::Bucket MyBucket will be replaced');
  });

  test('shows the construct path like the diff does, without the stack and a trailing Resource', () => {
    expect(formatDestructiveChange({
      stackName: 'MyStack',
      logicalId: 'MyConstructBucketF68F3FF0',
      resourceType: 'AWS::S3::Bucket',
      constructPath: '/MyStack/MyConstruct/Bucket/Resource',
      impact: ResourceImpact.WILL_REPLACE,
    })).toEqual('MyStack: AWS::S3::Bucket MyConstruct/Bucket MyConstructBucketF68F3FF0 will be replaced');
  });

  test('keeps a single-component construct path as is', () => {
    expect(formatDestructiveChange({
      stackName: 'MyStack',
      logicalId: 'Bucket',
      resourceType: 'AWS::S3::Bucket',
      constructPath: 'Bucket',
      impact: ResourceImpact.WILL_REPLACE,
    })).toEqual('MyStack: AWS::S3::Bucket Bucket Bucket will be replaced');
  });

  test('omits an unknown resource type', () => {
    expect(formatDestructiveChange({
      stackName: 'MyStack', logicalId: 'MyResource', impact: ResourceImpact.WILL_DESTROY,
    })).toEqual('MyStack: MyResource will be destroyed');
  });

  test('names the target of a move', () => {
    expect(formatDestructiveChange({
      stackName: 'MyStack',
      logicalId: 'MyTopic',
      resourceType: 'AWS::SNS::Topic',
      impact: ResourceImpact.WILL_DESTROY,
      move: { direction: 'to', stackName: 'OtherStack', resourceLogicalId: 'MovedTopic' },
    })).toEqual("MyStack: AWS::SNS::Topic MyTopic will be destroyed (moved to OtherStack.MovedTopic, run 'cdk refactor' to keep it)");
  });
});

describe('describeDestructiveImpact', () => {
  test.each([
    [ResourceImpact.WILL_REPLACE, 'will be replaced'],
    [ResourceImpact.MAY_REPLACE, 'may be replaced'],
    [ResourceImpact.WILL_DESTROY, 'will be destroyed'],
    [ResourceImpact.WILL_ORPHAN, 'will be orphaned'],
    [ResourceImpact.WILL_UPDATE, 'WILL_UPDATE'],
  ])('%s', (impact, expected) => {
    expect(describeDestructiveImpact(impact)).toEqual(expected);
  });
});
