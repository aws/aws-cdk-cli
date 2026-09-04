import { ResourceStatus, StackStatus } from '@aws-sdk/client-cloudformation';
import { StackProgressMonitor } from '../../../lib/api/stack-events';

let TIMESTAMP: number;
beforeAll(() => {
  TIMESTAMP = new Date().getTime();
});

test('prints 0/4 progress report, when addActivity is called with an "IN_PROGRESS" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    parentStackLogicalIds: [],
    event: {
      LogicalResourceId: 'stack1',
      ResourceStatus: ResourceStatus.CREATE_IN_PROGRESS,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  expect(stackProgress.formatted).toStrictEqual('0/4');
});

test.each([
  [false, 1],
  [true, 0],
])(', when addActivity is called with an "UPDATE_COMPLETE" ResourceStatus in nested stack=%p, prints %p/4 progress report', (nested, expectedProgress) => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    parentStackLogicalIds: nested ? ['NestedStackLogicalId'] : [],
    event: {
      LogicalResourceId: 'stack1',
      ResourceStatus: ResourceStatus.UPDATE_COMPLETE,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  expect(stackProgress.formatted).toStrictEqual(`${expectedProgress}/4`);
});

test('prints 1/4 progress report, when addActivity is called with an "ROLLBACK_COMPLETE" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    parentStackLogicalIds: [],
    event: {
      LogicalResourceId: 'stack1',
      ResourceStatus: ResourceStatus.ROLLBACK_COMPLETE,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  expect(stackProgress.formatted).toStrictEqual('1/4');
});

test('prints 0/4 progress report, when addActivity is called with an "UPDATE_FAILED" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    parentStackLogicalIds: [],
    event: {
      LogicalResourceId: 'stack1',
      ResourceStatus: ResourceStatus.UPDATE_FAILED,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  expect(stackProgress.formatted).toStrictEqual('0/4');
});

test('prints "  1" progress report, when number of resources is unknown and addActivity is called with an "UPDATE_COMPLETE" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor();

  stackProgress.process({
    parentStackLogicalIds: [],
    event: {
      LogicalResourceId: 'stack1',
      ResourceStatus: ResourceStatus.UPDATE_COMPLETE,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  expect(stackProgress.formatted).toStrictEqual('  1');
});

test('will count backwards when resource is first completed and then rolled back', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    parentStackLogicalIds: [],
    event: {
      LogicalResourceId: 'stack1',
      ResourceStatus: ResourceStatus.UPDATE_COMPLETE,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  expect(stackProgress.formatted).toStrictEqual('1/4');

  stackProgress.process({
    parentStackLogicalIds: [],
    event: {
      LogicalResourceId: 'stack1',
      ResourceStatus: ResourceStatus.ROLLBACK_COMPLETE,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  expect(stackProgress.formatted).toStrictEqual('0/4');
});

test('does not double-count the stack when it goes through a CLEANUP_IN_PROGRESS phase before COMPLETE', () => {
  const stackProgress = new StackProgressMonitor(3);

  // The stack's own cleanup-in-progress event and its terminal COMPLETE event
  // share the same LogicalResourceId (the stack itself).
  stackProgress.process({
    parentStackLogicalIds: [],
    event: {
      LogicalResourceId: 'stack1',
      // The AWS SDK types a stack's own StackEvent.ResourceStatus as `ResourceStatus`, but
      // in practice a root stack event carries `StackStatus` values like this one.
      ResourceStatus: StackStatus.UPDATE_COMPLETE_CLEANUP_IN_PROGRESS as unknown as ResourceStatus,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  expect(stackProgress.formatted).toStrictEqual('1/4');

  stackProgress.process({
    parentStackLogicalIds: [],
    event: {
      LogicalResourceId: 'stack1',
      ResourceStatus: ResourceStatus.UPDATE_COMPLETE,
      Timestamp: new Date(TIMESTAMP),
      ResourceType: 'AWS::CloudFormation::Stack',
      StackId: '',
      EventId: '',
      StackName: 'stack-name',
    },
  });

  // Without the fix this would overshoot to 2/4, even though there is only
  // one slot reserved in the total for the stack's own completion.
  expect(stackProgress.formatted).toStrictEqual('1/4');
});
