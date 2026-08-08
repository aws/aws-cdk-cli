import { DescribeStacksCommand, StackStatus } from '@aws-sdk/client-cloudformation';
import type { ICloudFormationClient } from '../../../lib/api/aws-auth/private';
import { stabilizeStack, waitForStackDeploy } from '../../../lib/api/deployments/cfn-api';
import { advanceTime } from '../../_helpers/fake-time';
import { MockSdk, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper('deploy');

let cfn: ICloudFormationClient;

beforeEach(() => {
  restoreSdkMocksToDefault();
  cfn = new MockSdk().cloudFormation();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function stackResponse(status: StackStatus, stackId = 'my-stack-id') {
  return {
    Stacks: [
      {
        StackName: 'my-stack',
        StackId: stackId,
        CreationTime: new Date(),
        StackStatus: status,
      },
    ],
  };
}

describe('stabilizeStack', () => {
  test('keeps polling when REVIEW_IN_PROGRESS is read after an in-progress state', async () => {
    // GIVEN - a poll after ExecuteChangeSet lands on a replica still reporting the pre-execution status
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.CREATE_IN_PROGRESS))
      .resolvesOnce(stackResponse(StackStatus.REVIEW_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.CREATE_COMPLETE));

    // WHEN
    const stack = await advanceTime(stabilizeStack(cfn, ioHelper, 'my-stack', 10_000));

    // THEN
    expect(stack?.stackStatus.name).toEqual(StackStatus.CREATE_COMPLETE);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 3);
  });

  test('keeps polling when the very first read is a stale REVIEW_IN_PROGRESS for the executing stack', async () => {
    // GIVEN - nothing guarantees the first DescribeStacks after ExecuteChangeSet observes the new
    // status, so the executing stack's id is passed in to identify a stale read without having to
    // see the operation in progress first.
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.REVIEW_IN_PROGRESS))
      .resolvesOnce(stackResponse(StackStatus.CREATE_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.CREATE_COMPLETE));

    // WHEN
    const stack = await advanceTime(stabilizeStack(cfn, ioHelper, 'my-stack', 10_000, 'my-stack-id'));

    // THEN
    expect(stack?.stackStatus.name).toEqual(StackStatus.CREATE_COMPLETE);
  });

  test('treats REVIEW_IN_PROGRESS on a different stack id as a genuine status', async () => {
    // GIVEN - polling by name can observe a different stack if a concurrent operation deleted and
    // re-created it. That review status belongs to a stack we never deployed, and nothing will move
    // it on, so it must not be waited on.
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.UPDATE_IN_PROGRESS, 'original-stack-id'))
      .resolves(stackResponse(StackStatus.REVIEW_IN_PROGRESS, 'replacement-stack-id'));

    // WHEN
    const stack = await advanceTime(stabilizeStack(cfn, ioHelper, 'my-stack', 10_000));

    // THEN
    expect(stack?.stackStatus.name).toEqual(StackStatus.REVIEW_IN_PROGRESS);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 2);
  });

  test('gives up on a persistent REVIEW_IN_PROGRESS rather than polling forever', async () => {
    // GIVEN - REVIEW_IN_PROGRESS that never resolves after an in-progress state, e.g. a concurrent
    // operation deleted the stack and left a fresh CREATE changeset unexecuted. `waitFor` has no
    // timeout, so treating this as a stale read indefinitely would hang the deployment.
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.CREATE_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.REVIEW_IN_PROGRESS));

    // WHEN - advance a bounded number of intervals, so an unbounded wait fails the assertion
    // below instead of hanging until the jest timeout.
    let settled: string | undefined;
    void stabilizeStack(cfn, ioHelper, 'my-stack', 10_000).then((s) => {
      settled = s?.stackStatus.name ?? 'undefined';
    });
    for (let i = 0; i < 20 && settled === undefined; i++) {
      await jest.advanceTimersByTimeAsync(10_000);
    }

    // THEN
    expect(settled).toEqual(StackStatus.REVIEW_IN_PROGRESS);
  });

  test('treats REVIEW_IN_PROGRESS as stable when no operation was ever in progress', async () => {
    // GIVEN - an abandoned ChangeSet: nothing will move this stack on its own, so we must not wait forever
    mockCloudFormationClient.on(DescribeStacksCommand).resolves(stackResponse(StackStatus.REVIEW_IN_PROGRESS));

    // WHEN
    const stack = await advanceTime(stabilizeStack(cfn, ioHelper, 'my-stack', 10_000));

    // THEN
    expect(stack?.stackStatus.name).toEqual(StackStatus.REVIEW_IN_PROGRESS);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 1);
  });
});

describe('waitForStackDeploy', () => {
  test('succeeds when a stale REVIEW_IN_PROGRESS read interrupts a successful create', async () => {
    // GIVEN
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.CREATE_IN_PROGRESS))
      .resolvesOnce(stackResponse(StackStatus.REVIEW_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.CREATE_COMPLETE));

    // WHEN
    const stack = await advanceTime(waitForStackDeploy(cfn, ioHelper, 'my-stack', 10_000));

    // THEN
    expect(stack?.stackStatus.name).toEqual(StackStatus.CREATE_COMPLETE);
  });

  test('still fails on an abandoned pre-execution ChangeSet', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeStacksCommand).resolves(stackResponse(StackStatus.REVIEW_IN_PROGRESS));

    // WHEN / THEN
    await expect(
      advanceTime(waitForStackDeploy(cfn, ioHelper, 'my-stack', 10_000)),
    ).rejects.toThrow(/failed to deploy: REVIEW_IN_PROGRESS/);
  });
});
