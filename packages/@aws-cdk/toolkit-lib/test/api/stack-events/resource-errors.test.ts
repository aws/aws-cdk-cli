import type { StackEvent } from '@aws-sdk/client-cloudformation';
import type { ResourceEvent } from '../../../lib/api/stack-events';
import { ResourceErrors } from '../../../lib/api/stack-events/resource-errors';

const STACK_ARN = 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/abc';

function resourceEvent(event: Partial<StackEvent> & Pick<StackEvent, 'EventId'>): ResourceEvent {
  const fullEvent: StackEvent = {
    StackId: STACK_ARN,
    StackName: 'MyStack',
    Timestamp: new Date(),
    ...event,
  };
  return {
    event: fullEvent,
    parentStackLogicalIds: [],
    isRootStackEvent: false,
  };
}

describe('hook failure correlation', () => {
  test('attaches a preceding hook failure to the resource error it caused', () => {
    const errors = new ResourceErrors();

    errors.update(
      resourceEvent({
        EventId: 'evt-hook',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'UPDATE_IN_PROGRESS',
        HookStatus: 'HOOK_COMPLETE_FAILED',
        HookType: 'Private::Guard::TestHook',
        HookInvocationId: 'hook-invocation-1',
        HookStatusReason: 'Template failed validation',
      }),
      resourceEvent({
        EventId: 'evt-fail',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'The following hook(s) failed: [Private::Guard::TestHook]',
      }),
    );

    expect(errors.all).toEqual([
      expect.objectContaining({
        logicalId: 'MyBucket',
        hookFailures: [
          {
            hookType: 'Private::Guard::TestHook',
            hookInvocationId: 'hook-invocation-1',
            hookStatusReason: 'Template failed validation',
          },
        ],
      }),
    ]);
  });

  test('does not attach a hook failure whose type is not named in the resource status reason', () => {
    const errors = new ResourceErrors();

    errors.update(
      resourceEvent({
        EventId: 'evt-hook',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'UPDATE_IN_PROGRESS',
        HookStatus: 'HOOK_COMPLETE_FAILED',
        HookType: 'Private::Guard::TestHook',
        HookInvocationId: 'hook-invocation-1',
      }),
      resourceEvent({
        EventId: 'evt-fail',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'Some unrelated failure',
      }),
    );

    expect(errors.all[0].hookFailures).toBeUndefined();
  });

  test('does not correlate a hook failure across different resources', () => {
    const errors = new ResourceErrors();

    errors.update(
      resourceEvent({
        EventId: 'evt-hook',
        LogicalResourceId: 'OtherResource',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'UPDATE_IN_PROGRESS',
        HookStatus: 'HOOK_COMPLETE_FAILED',
        HookType: 'Private::Guard::TestHook',
        HookInvocationId: 'hook-invocation-1',
      }),
      resourceEvent({
        EventId: 'evt-fail',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'The following hook(s) failed: [Private::Guard::TestHook]',
      }),
    );

    expect(errors.all[0].hookFailures).toBeUndefined();
  });

  test('ignores hook events that did not fail', () => {
    const errors = new ResourceErrors();

    errors.update(
      resourceEvent({
        EventId: 'evt-hook',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'UPDATE_IN_PROGRESS',
        HookStatus: 'HOOK_COMPLETE_SUCCEEDED',
        HookType: 'Private::Guard::TestHook',
        HookInvocationId: 'hook-invocation-1',
      }),
      resourceEvent({
        EventId: 'evt-fail',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'The following hook(s) failed: [Private::Guard::TestHook]',
      }),
    );

    expect(errors.all[0].hookFailures).toBeUndefined();
  });
});

describe('operation principals', () => {
  test('records roles and functions seen in any event, including ones later rolled back', () => {
    const errors = new ResourceErrors();
    errors.update(
      // No physical ID yet on the first CREATE_IN_PROGRESS event
      resourceEvent({ EventId: '1', LogicalResourceId: 'NewRole', ResourceType: 'AWS::IAM::Role', ResourceStatus: 'CREATE_IN_PROGRESS' }),
      resourceEvent({ EventId: '2', LogicalResourceId: 'NewRole', ResourceType: 'AWS::IAM::Role', PhysicalResourceId: 'MyStack-NewRole-abc', ResourceStatus: 'CREATE_COMPLETE' }),
      resourceEvent({ EventId: '3', LogicalResourceId: 'Fn', ResourceType: 'AWS::Lambda::Function', PhysicalResourceId: 'MyStack-Fn-def', ResourceStatus: 'CREATE_FAILED' }),
      resourceEvent({ EventId: '4', LogicalResourceId: 'NewRole', ResourceType: 'AWS::IAM::Role', PhysicalResourceId: 'MyStack-NewRole-abc', ResourceStatus: 'DELETE_COMPLETE' }),
    );

    expect(errors.principals).toEqual([
      { stackArn: STACK_ARN, logicalId: 'NewRole', resourceType: 'AWS::IAM::Role', physicalId: 'MyStack-NewRole-abc' },
      { stackArn: STACK_ARN, logicalId: 'Fn', resourceType: 'AWS::Lambda::Function', physicalId: 'MyStack-Fn-def' },
    ]);
  });

  test('records both the old and the new physical ID of a replaced role', () => {
    const errors = new ResourceErrors();
    errors.update(
      resourceEvent({ EventId: '1', LogicalResourceId: 'Role', ResourceType: 'AWS::IAM::Role', PhysicalResourceId: 'old-role', ResourceStatus: 'UPDATE_IN_PROGRESS' }),
      resourceEvent({ EventId: '2', LogicalResourceId: 'Role', ResourceType: 'AWS::IAM::Role', PhysicalResourceId: 'new-role', ResourceStatus: 'UPDATE_COMPLETE' }),
    );

    expect(errors.principals.map((p) => p.physicalId)).toEqual(['old-role', 'new-role']);
  });

  test('ignores resources that do not act as principals', () => {
    const errors = new ResourceErrors();
    errors.update(
      resourceEvent({ EventId: '1', LogicalResourceId: 'Bucket', ResourceType: 'AWS::S3::Bucket', PhysicalResourceId: 'my-bucket', ResourceStatus: 'CREATE_COMPLETE' }),
    );

    expect(errors.principals).toEqual([]);
  });
});
