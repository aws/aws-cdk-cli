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

const FOO_ARN = 'arn:aws:cloudformation:us-east-1:123456789012:stack/Foo/1111';

describe('execute', () => {
  test('waits for the affected stacks to stabilize after the refactor is complete', async () => {
    // GIVEN a refactor within a single stack...
    const context = new RefactoringContext({
      environment,
      deployedStacks: [
        {
          environment,
          stackName: 'Foo',
          stackId: FOO_ARN,
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
    // reaches EXECUTE_COMPLETE. The stack is identified by its ARN.
    mockCloudFormationClient
      .on(DescribeStacksCommand, { StackName: FOO_ARN })
      .resolvesOnce(stackResponse('Foo', StackStatus.UPDATE_IN_PROGRESS))
      .resolves(stackResponse('Foo', StackStatus.UPDATE_COMPLETE));

    // WHEN
    let resolved = false;
    const promise = context
      .execute([{ StackName: 'Foo', TemplateBody: '{}' }], new MockSdkProvider(), ioHelper)
      .then(() => {
        resolved = true;
      });

    // THEN the refactor was executed and the stack was seen in progress, so
    // execute() is still waiting for it to stabilize.
    // Advancing by 0 flushes the mocked API call chain up to the first
    // DescribeStacks poll (microtasks only), without firing any timer.
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(ExecuteStackRefactorCommand, 1);
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: FOO_ARN })).toHaveLength(1);
    expect(resolved).toBe(false);

    // and it only resolves after the stack has reached UPDATE_COMPLETE
    await advanceTime(promise);
    expect(resolved).toBe(true);
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: FOO_ARN })).toHaveLength(2);
  });

  test('waits for every stack in the stack definitions, even without mapped resources of its own', async () => {
    // GIVEN a refactor that moves a bucket from stack Foo to stack Bar. The
    // deployed stacks carry no ARN here, so the wait falls back to the names.
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

    for (const stackName of ['Foo', 'Bar', 'Baz']) {
      mockCloudFormationClient
        .on(DescribeStacksCommand, { StackName: stackName })
        .resolves(stackResponse(stackName, StackStatus.UPDATE_COMPLETE));
    }

    // WHEN the refactor also updates stack Baz, which has no resource moves of
    // its own (e.g. only its resource metadata changed)
    const promise = context.execute(
      [
        { StackName: 'Foo', TemplateBody: '{}' },
        { StackName: 'Bar', TemplateBody: '{}' },
        { StackName: 'Baz', TemplateBody: '{}' },
      ],
      new MockSdkProvider(),
      ioHelper,
    );
    await advanceTime(promise);

    // THEN all three stacks were checked for stability
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: 'Foo' })).toHaveLength(1);
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: 'Bar' })).toHaveLength(1);
    expect(mockCloudFormationClient.commandCalls(DescribeStacksCommand, { StackName: 'Baz' })).toHaveLength(1);
  });
});
