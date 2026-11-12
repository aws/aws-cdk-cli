import { fullDiff, ResourceImpact } from '@aws-cdk/cloudformation-diff';
import {
  describeDestructiveImpact,
  findDestructiveChanges,
  formatDestructiveChange,
  partitionDestructiveChanges,
  validateIgnoreDestructivePatterns,
} from '../../../lib/api/diff/destructive-changes';
import type { DestructiveChange } from '../../../lib/payloads/diff';

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

describe('partitionDestructiveChanges', () => {
  const deployment: DestructiveChange = {
    stackName: 'MyStack',
    logicalId: 'MyApiDeployment1234abcd',
    resourceType: 'AWS::ApiGateway::Deployment',
    constructPath: '/MyStack/MyApi/Deployment/Resource',
    impact: ResourceImpact.WILL_DESTROY,
  };
  const table: DestructiveChange = {
    stackName: 'MyStack',
    logicalId: 'MyTable794EDED1',
    resourceType: 'AWS::DynamoDB::Table',
    constructPath: 'MyStack/Storage/MyTable/Resource',
    impact: ResourceImpact.WILL_REPLACE,
  };
  const withoutPath: DestructiveChange = {
    stackName: 'MyStack',
    logicalId: 'Topic',
    resourceType: 'AWS::SNS::Topic',
    impact: ResourceImpact.WILL_DESTROY,
  };
  const all = [deployment, table, withoutPath];

  test('ignores nothing without patterns', () => {
    expect(partitionDestructiveChanges(all)).toEqual({ destructive: all, ignored: [] });
    expect(partitionDestructiveChanges(all, [])).toEqual({ destructive: all, ignored: [] });
  });

  test.each([
    ['AWS::ApiGateway::Deployment'],
    ['AWS::ApiGateway::*'],
  ])('matches the resource type with a pattern containing "::" (%s)', (pattern) => {
    expect(partitionDestructiveChanges(all, [pattern])).toEqual({ destructive: [table, withoutPath], ignored: [deployment] });
  });

  test.each([
    ['MyStack/MyApi/Deployment/Resource', 'the full construct path'],
    ['/MyStack/MyApi/Deployment/Resource', 'the full construct path with a leading slash'],
    ['MyStack/MyApi/Deployment', 'the construct path without the default child'],
    ['MyApi/Deployment', 'the construct path as shown in the diff'],
    ['*/MyApi/Deployment', 'a glob for any stack'],
    ['**/Deployment', 'a glob for any depth'],
  ])('matches the construct path with any other pattern (%s, %s)', (pattern) => {
    expect(partitionDestructiveChanges(all, [pattern])).toEqual({ destructive: [table, withoutPath], ignored: [deployment] });
  });

  test('ignores a trailing slash in a construct path pattern', () => {
    expect(partitionDestructiveChanges(all, ['MyApi/Deployment/'])).toEqual({ destructive: [table, withoutPath], ignored: [deployment] });
  });

  test('does not match a construct path that only shares a prefix', () => {
    expect(partitionDestructiveChanges(all, ['MyStack/MyApi'])).toEqual({ destructive: all, ignored: [] });
  });

  test('does not match a stack name against a default child directly under the stack', () => {
    const underStack: DestructiveChange = { ...withoutPath, constructPath: 'MyStack/Resource' };

    expect(partitionDestructiveChanges([underStack], ['MyStack'])).toEqual({ destructive: [underStack], ignored: [] });
    expect(partitionDestructiveChanges([underStack], ['MyStack/Resource'])).toEqual({ destructive: [], ignored: [underStack] });
  });

  test('matches path components that start with a dot', () => {
    const hidden: DestructiveChange = { ...withoutPath, constructPath: 'MyStack/.hidden/Topic/Resource' };

    expect(partitionDestructiveChanges([hidden], ['**/Topic'])).toEqual({ destructive: [], ignored: [hidden] });
  });

  test('does not match a resource type pattern against the construct path', () => {
    const typeLikePath: DestructiveChange = { ...withoutPath, resourceType: 'AWS::SNS::Topic', constructPath: 'MyStack/AWS::SQS::Queue' };

    expect(partitionDestructiveChanges([typeLikePath], ['AWS::SQS::Queue'])).toEqual({ destructive: [typeLikePath], ignored: [] });
  });

  test('does not match the logical ID', () => {
    expect(partitionDestructiveChanges(all, ['MyTable794EDED1', 'Topic'])).toEqual({ destructive: all, ignored: [] });
  });

  test('ignores a change that matches any of the patterns', () => {
    expect(partitionDestructiveChanges(all, ['AWS::SNS::Topic', 'Storage/MyTable'])).toEqual({ destructive: [deployment], ignored: [table, withoutPath] });
  });

  test.each([[''], ['  ']])('rejects an empty pattern (%j)', (pattern) => {
    expect(() => partitionDestructiveChanges(all, [pattern])).toThrow(/must be a non-empty string/);
  });

  test('rejects a negated pattern, which would ignore every other change', () => {
    expect(() => partitionDestructiveChanges(all, ['!AWS::DynamoDB::Table'])).toThrow(/cannot start with "!"/);
  });
});

describe('validateIgnoreDestructivePatterns', () => {
  test('returns undefined when no patterns are given', () => {
    expect(validateIgnoreDestructivePatterns(undefined)).toBeUndefined();
  });

  test('returns a list of strings as is', () => {
    expect(validateIgnoreDestructivePatterns(['AWS::Lambda::*', 'MyApi/Deployment'])).toEqual(['AWS::Lambda::*', 'MyApi/Deployment']);
    expect(validateIgnoreDestructivePatterns([])).toEqual([]);
  });

  test('turns a number into a string, as a command line parser may read a pattern like 123 as a number', () => {
    expect(validateIgnoreDestructivePatterns([123])).toEqual(['123']);
  });

  test('rejects a single string, which would otherwise be read as one pattern per character', () => {
    expect(() => validateIgnoreDestructivePatterns('AWS::Lambda::*')).toThrow('"ignoreDestructive" must be a list of patterns, got "AWS::Lambda::*"');
  });

  test.each([
    [{ type: 'AWS::Lambda::*' }],
    [null],
    [true],
  ])('rejects a value that is not a list (%j)', (value) => {
    expect(() => validateIgnoreDestructivePatterns(value)).toThrow(/must be a list/);
  });

  test.each([['!MyApi/Deployment'], ['!AWS::Lambda::*'], ['/!MyApi/Deployment'], ['//!MyApi'], ['./!(MyApi)/**']])('rejects a pattern starting with "!" (%s)', (pattern) => {
    expect(() => validateIgnoreDestructivePatterns([pattern])).toThrow(`cannot start with "!", got ${JSON.stringify(pattern)}`);
  });

  test.each([['/'], ['//'], ['///']])('rejects a pattern that is only slashes (%j)', (pattern) => {
    expect(() => validateIgnoreDestructivePatterns([pattern])).toThrow(`must name a resource type or a construct path, got ${JSON.stringify(pattern)}`);
  });

  test.each([[' MyApi/Deployment'], ['AWS::Lambda::* ']])('rejects a pattern with leading or trailing whitespace (%j)', (pattern) => {
    expect(() => validateIgnoreDestructivePatterns([pattern])).toThrow(`cannot start or end with whitespace, got ${JSON.stringify(pattern)}`);
  });

  test.each([
    [[''], '""'],
    [['  '], '"  "'],
    [[null], 'null'],
    [[{ type: 'AWS::Lambda::*' }], '{"type":"AWS::Lambda::*"}'],
  ])('rejects a pattern that is not a non-empty string (%j)', (value, shown) => {
    expect(() => validateIgnoreDestructivePatterns(value)).toThrow(`must be a non-empty string, got ${shown}`);
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
