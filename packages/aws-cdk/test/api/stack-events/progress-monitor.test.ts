import { ResourceStatus } from '@aws-sdk/client-cloudformation';
import { StackProgressMonitor } from '../../../lib/api/stack-events/stack-progress-monitor';

let TIMESTAMP: number;
beforeAll(() => {
  TIMESTAMP = new Date().getTime();
});

test('prints 0/4 progress report, when addActivity is called with an "IN_PROGRESS" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    LogicalResourceId: 'stack1',
    ResourceStatus: ResourceStatus.CREATE_IN_PROGRESS,
    Timestamp: new Date(TIMESTAMP),
    ResourceType: 'AWS::CloudFormation::Stack',
    StackId: '',
    EventId: '',
    StackName: 'stack-name',
  });

  expect(stackProgress.formatted).toStrictEqual('0/4');
});

test('prints 1/4 progress report, when addActivity is called with an "UPDATE_COMPLETE" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    LogicalResourceId: 'stack1',
    ResourceStatus: ResourceStatus.UPDATE_COMPLETE,
    Timestamp: new Date(TIMESTAMP),
    ResourceType: 'AWS::CloudFormation::Stack',
    StackId: '',
    EventId: '',
    StackName: 'stack-name',
  });

  expect(stackProgress.formatted).toStrictEqual('1/4');
});

test('prints 1/4 progress report, when addActivity is called with an "ROLLBACK_COMPLETE" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    LogicalResourceId: 'stack1',
    ResourceStatus: ResourceStatus.ROLLBACK_COMPLETE,
    Timestamp: new Date(TIMESTAMP),
    ResourceType: 'AWS::CloudFormation::Stack',
    StackId: '',
    EventId: '',
    StackName: 'stack-name',
  });

  expect(stackProgress.formatted).toStrictEqual('1/4');
});

test('prints 0/4 progress report, when addActivity is called with an "UPDATE_FAILED" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    LogicalResourceId: 'stack1',
    ResourceStatus: ResourceStatus.UPDATE_FAILED,
    Timestamp: new Date(TIMESTAMP),
    ResourceType: 'AWS::CloudFormation::Stack',
    StackId: '',
    EventId: '',
    StackName: 'stack-name',
  });

  expect(stackProgress.formatted).toStrictEqual('0/4');
});


test('prints "  1" progress report, when number of resources is unknown and addActivity is called with an "UPDATE_COMPLETE" ResourceStatus', () => {
  const stackProgress = new StackProgressMonitor();

  stackProgress.process({
    LogicalResourceId: 'stack1',
    ResourceStatus: ResourceStatus.UPDATE_COMPLETE,
    Timestamp: new Date(TIMESTAMP),
    ResourceType: 'AWS::CloudFormation::Stack',
    StackId: '',
    EventId: '',
    StackName: 'stack-name',
  });

  expect(stackProgress.formatted).toStrictEqual('  1');
});

test('will count backwards when resource is first completed and then rolled back', () => {
  const stackProgress = new StackProgressMonitor(3);

  stackProgress.process({
    LogicalResourceId: 'stack1',
    ResourceStatus: ResourceStatus.UPDATE_COMPLETE,
    Timestamp: new Date(TIMESTAMP),
    ResourceType: 'AWS::CloudFormation::Stack',
    StackId: '',
    EventId: '',
    StackName: 'stack-name',
  });

  expect(stackProgress.formatted).toStrictEqual('1/4');

  stackProgress.process({
    LogicalResourceId: 'stack1',
    ResourceStatus: ResourceStatus.ROLLBACK_COMPLETE,
    Timestamp: new Date(TIMESTAMP),
    ResourceType: 'AWS::CloudFormation::Stack',
    StackId: '',
    EventId: '',
    StackName: 'stack-name',
  });

  expect(stackProgress.formatted).toStrictEqual('0/4');
});
