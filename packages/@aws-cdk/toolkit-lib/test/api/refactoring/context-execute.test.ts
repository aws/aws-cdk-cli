import {
  CreateStackRefactorCommand,
  DescribeStackRefactorCommand,
  DescribeStacksCommand,
  ExecuteStackRefactorCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { RefactoringContext } from '../../../lib/api/refactoring/context';
import { advanceTime } from '../../_helpers/fake-time';
import { MockSdkProvider, mockCloudFormationClient, mockSdkProvider, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

const ioHelper = new TestIoHost().asHelper('refactor');

mockSdkProvider();

const environment = {
  name: 'prod',
  account: '123456789012',
  region: 'us-east-1',
};

beforeEach(() => {
  restoreSdkMocksToDefault();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function stackResponse(stackName: string, status: StackStatus) {
  return {
    Stacks: [
      {
        StackName: stackName,
        StackId: `${stackName}-id`,
        CreationTime: new Date(),
        StackStatus: status,
      },
    ],
  };
}

function mockRefactorApi() {
  mockCloudFormationClient.on(CreateStackRefactorCommand).resolves({
    StackRefactorId: 'refactor-id',
  });

  mockCloudFormationClient.on(DescribeStackRefactorCommand).resolves({
    Status: 'CREATE_COMPLETE',
    ExecutionStatus: 'EXECUTE_COMPLETE',
  });

  mockCloudFormationClient.on(ExecuteStackRefactorCommand).resolves({});
}

describe('execute', () => {
  test('waits for the affected stacks to stabilize after the refactor is complete', async () => {
    // GIVEN a refactor within a single stack...
    const context = new RefactoringContext({
      environment,
      deployedStacks: [
        {
          environment,
          stackName: 'Foo',
          template: {
            Resources: {
              OldName: { Type: 'AWS::S3::Bucket' },
            },
          },
        },
      ],
      localStacks: [
        {
          environment,
          stackName: 'Foo',
          template: {
            Resources: {
              NewName: { Type: 'AWS::S3::Bucket' },
            },
          },
        },
      ],
    });

    mockRefactorApi();

    // ...whose stack is still in UPDATE_IN_PROGRESS right after the refactor
    // reaches EXECUTE_COMPLETE
    mockCloudFormationClient
      .on(DescribeStacksCommand, { StackName: 'Foo' })
      .resolvesOnce(stackResponse('Foo', StackStatus.UPDATE_IN_PROGRESS))
      .resolves(stackResponse('Foo', StackStatus.UPDATE_COMPLETE));

    // WHEN
    const promise = context.execute([{ StackName: 'Foo', TemplateBody: '{}' }], new MockSdkProvider(), ioHelper);

    // THEN the refactor was executed, but execute() is still waiting for the
    // stack to stabilize
    await jest.advanceTimersByTimeAsync(4999);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ExecuteStackRefactorCommand, 1);
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: 'Foo' })).toHaveLength(1);

    // and it only resolves after the stack has reached UPDATE_COMPLETE
    await advanceTime(promise);
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: 'Foo' })).toHaveLength(2);
  });

  test('waits for both source and destination stacks in a cross-stack refactor', async () => {
    // GIVEN a refactor that moves a bucket from stack Foo to stack Bar
    const context = new RefactoringContext({
      environment,
      deployedStacks: [
        {
          environment,
          stackName: 'Foo',
          template: {
            Resources: {
              Bucket1: { Type: 'AWS::S3::Bucket' },
            },
          },
        },
        {
          environment,
          stackName: 'Bar',
          template: {
            Resources: {
              Queue1: { Type: 'AWS::SQS::Queue' },
            },
          },
        },
      ],
      localStacks: [
        {
          environment,
          stackName: 'Foo',
          template: {
            Resources: {},
          },
        },
        {
          environment,
          stackName: 'Bar',
          template: {
            Resources: {
              Bucket1: { Type: 'AWS::S3::Bucket' },
              Queue1: { Type: 'AWS::SQS::Queue' },
            },
          },
        },
      ],
    });

    mockRefactorApi();

    mockCloudFormationClient
      .on(DescribeStacksCommand, { StackName: 'Foo' })
      .resolves(stackResponse('Foo', StackStatus.UPDATE_COMPLETE));
    mockCloudFormationClient
      .on(DescribeStacksCommand, { StackName: 'Bar' })
      .resolves(stackResponse('Bar', StackStatus.UPDATE_COMPLETE));

    // WHEN
    const promise = context.execute(
      [
        { StackName: 'Foo', TemplateBody: '{}' },
        { StackName: 'Bar', TemplateBody: '{}' },
      ],
      new MockSdkProvider(),
      ioHelper,
    );
    await advanceTime(promise);

    // THEN both stacks were checked for stability
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: 'Foo' })).toHaveLength(1);
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: 'Bar' })).toHaveLength(1);
  });
});
