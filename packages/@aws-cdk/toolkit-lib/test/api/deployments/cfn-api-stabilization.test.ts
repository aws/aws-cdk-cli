import { DescribeStacksCommand, StackStatus } from '@aws-sdk/client-cloudformation';
import type { ICloudFormationClient } from '../../../lib/api/aws-auth/private';
import { stabilizeStack, waitForStackDelete, waitForStackDeploy } from '../../../lib/api/deployments/cfn-api';
import { advanceTime } from '../../_helpers/fake-time';
import { MockSdk, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

const STACK_ARN = 'arn:aws:cloudformation:here:123456789012:stack/my-stack/abcdef';

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

function stackResponse(status: StackStatus) {
  return {
    Stacks: [
      {
        StackName: 'my-stack',
        StackId: STACK_ARN,
        CreationTime: new Date(),
        StackStatus: status,
      },
    ],
  };
}

describe('stabilizeStack', () => {
  test('polls DescribeStacks at the default 5s interval when no interval is given', async () => {
    // GIVEN
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.UPDATE_IN_PROGRESS))
      .resolvesOnce(stackResponse(StackStatus.UPDATE_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.UPDATE_COMPLETE));

    // WHEN
    const promise = stabilizeStack(cfn, ioHelper, 'my-stack');

    // THEN: two 5s ticks are needed before the stack stabilizes
    await jest.advanceTimersByTimeAsync(4999);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 1);

    await jest.advanceTimersByTimeAsync(1);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 2);

    const result = await advanceTime(promise);
    expect(result?.stackStatus.name).toEqual(StackStatus.UPDATE_COMPLETE);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 3);
  });

  test('polls DescribeStacks at the given interval', async () => {
    // GIVEN
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.UPDATE_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.UPDATE_COMPLETE));

    // WHEN
    const promise = stabilizeStack(cfn, ioHelper, 'my-stack', { pollingInterval: 10_000 });

    // THEN
    await jest.advanceTimersByTimeAsync(9_999);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 1);

    const result = await advanceTime(promise);
    expect(result?.stackStatus.name).toEqual(StackStatus.UPDATE_COMPLETE);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 2);
  });

  test('keeps waiting when REVIEW_IN_PROGRESS is read after the stack was in progress', async () => {
    // GIVEN - DescribeStacks is eventually consistent, so a poll issued after ExecuteChangeSet can
    // still report the pre-execution status
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.CREATE_IN_PROGRESS))
      .resolvesOnce(stackResponse(StackStatus.REVIEW_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.CREATE_COMPLETE));

    // WHEN
    const stack = await advanceTime(stabilizeStack(cfn, ioHelper, STACK_ARN, { pollingInterval: 10_000, changeSetExecuted: true }));

    // THEN
    expect(stack?.stackStatus.name).toEqual(StackStatus.CREATE_COMPLETE);
  });

  test('treats REVIEW_IN_PROGRESS as stable for callers that have not executed a ChangeSet', async () => {
    // GIVEN - a ChangeSet that was created but never executed. Nothing will move this stack on its
    // own, so callers that did not issue a deployment must not wait on it at all.
    mockCloudFormationClient.on(DescribeStacksCommand).resolves(stackResponse(StackStatus.REVIEW_IN_PROGRESS));

    // WHEN
    const stack = await advanceTime(stabilizeStack(cfn, ioHelper, STACK_ARN, { pollingInterval: 10_000 }));

    // THEN
    expect(stack?.stackStatus.name).toEqual(StackStatus.REVIEW_IN_PROGRESS);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 1);
  });

  test('gives up on a leading REVIEW_IN_PROGRESS that never resolves', async () => {
    // GIVEN - every read is REVIEW_IN_PROGRESS and the stack is never seen in any other state, so we
    // cannot tell a stale read from a ChangeSet that was never executed. `waitFor` has no timeout, so
    // believing the read eventually is what ends the wait.
    mockCloudFormationClient.on(DescribeStacksCommand).resolves(stackResponse(StackStatus.REVIEW_IN_PROGRESS));

    // WHEN - advance a bounded number of intervals, so an unbounded wait fails the assertion below
    // instead of hanging until the jest timeout
    let settled: string | undefined;
    void stabilizeStack(cfn, ioHelper, STACK_ARN, { pollingInterval: 10_000, changeSetExecuted: true }).then((stack) => {
      settled = stack?.stackStatus.name ?? 'gone';
    });
    for (let i = 0; i < 20 && settled === undefined; i++) {
      await jest.advanceTimersByTimeAsync(10_000);
    }

    // THEN
    expect(settled).toEqual(StackStatus.REVIEW_IN_PROGRESS);
  });

  test('survives more stale reads than the leading-read budget over a long deployment', async () => {
    // GIVEN - a deployment long enough for several scattered stale reads. Once the stack has been seen
    // in progress, every REVIEW_IN_PROGRESS read is provably stale, so no budget applies to them.
    const statuses = [
      StackStatus.CREATE_IN_PROGRESS,
      StackStatus.REVIEW_IN_PROGRESS,
      StackStatus.CREATE_IN_PROGRESS,
      StackStatus.REVIEW_IN_PROGRESS,
      StackStatus.CREATE_IN_PROGRESS,
      StackStatus.REVIEW_IN_PROGRESS,
      StackStatus.CREATE_IN_PROGRESS,
      StackStatus.REVIEW_IN_PROGRESS,
      StackStatus.CREATE_COMPLETE,
    ];
    let read = 0;
    mockCloudFormationClient.on(DescribeStacksCommand).callsFake(() => {
      return stackResponse(statuses[Math.min(read++, statuses.length - 1)]);
    });

    // WHEN
    const stack = await advanceTime(stabilizeStack(cfn, ioHelper, STACK_ARN, {
      pollingInterval: 10_000,
      changeSetExecuted: true,
    }));

    // THEN - the deployment succeeded, so this must not report the stale status as the outcome
    expect(stack?.stackStatus.name).toEqual(StackStatus.CREATE_COMPLETE);
  });

  test('reports a stack deleted mid-wait as gone, not as a stable status', async () => {
    // GIVEN - the stack is deleted while we are waiting on it. `DescribeStacks` keeps answering for a
    // deleted stack when asked by ARN, which is what we ask by from the second poll onwards.
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.UPDATE_IN_PROGRESS))
      .resolvesOnce(stackResponse(StackStatus.DELETE_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.DELETE_COMPLETE));

    // WHEN
    const stack = await advanceTime(stabilizeStack(cfn, ioHelper, 'my-stack', { pollingInterval: 10_000 }));

    // THEN - callers rely on this to raise their own "the stack disappeared" error
    expect(stack).toBeUndefined();
  });

  test('narrows a stack name to the ARN it resolved to', async () => {
    // GIVEN - called with a name, so the first read is the only chance to learn which stack we are
    // actually waiting on
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.CREATE_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.CREATE_COMPLETE));

    // WHEN
    await advanceTime(stabilizeStack(cfn, ioHelper, 'my-stack', { pollingInterval: 10_000 }));

    // THEN - the first call goes out by name, every later one by ARN
    const calls = mockCloudFormationClient.commandCalls(DescribeStacksCommand);
    expect(calls[0].args[0].input).toEqual({ StackName: 'my-stack' });
    expect(calls[1].args[0].input).toEqual({ StackName: STACK_ARN });
  });
});

describe('waitForStackDeploy', () => {
  test('forwards the polling interval to stabilizeStack', async () => {
    // GIVEN
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.CREATE_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.CREATE_COMPLETE));

    // WHEN
    const promise = waitForStackDeploy(cfn, ioHelper, 'my-stack', 10_000);

    // THEN
    await jest.advanceTimersByTimeAsync(9_999);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 1);

    await advanceTime(promise);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 2);
  });

  test('still fails on a ChangeSet that was never executed', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeStacksCommand).resolves(stackResponse(StackStatus.REVIEW_IN_PROGRESS));

    // WHEN / THEN
    await expect(
      advanceTime(waitForStackDeploy(cfn, ioHelper, STACK_ARN, 10_000)),
    ).rejects.toThrow(/failed to deploy: REVIEW_IN_PROGRESS/);
  });

  test('names the stack rather than its ARN when a deployment fails', async () => {
    // GIVEN - callers pass an ARN, which must not leak into the error the user sees
    mockCloudFormationClient.on(DescribeStacksCommand).resolves(stackResponse(StackStatus.ROLLBACK_COMPLETE));

    // WHEN / THEN
    await expect(
      advanceTime(waitForStackDeploy(cfn, ioHelper, STACK_ARN, 10_000)),
    ).rejects.toThrow(/stack named my-stack failed creation/);
  });
});

describe('waitForStackDelete', () => {
  test('forwards the polling interval to stabilizeStack', async () => {
    // GIVEN
    mockCloudFormationClient
      .on(DescribeStacksCommand)
      .resolvesOnce(stackResponse(StackStatus.DELETE_IN_PROGRESS))
      .resolves(stackResponse(StackStatus.DELETE_COMPLETE));

    // WHEN
    const promise = waitForStackDelete(cfn, ioHelper, 'my-stack', 10_000);

    // THEN
    await jest.advanceTimersByTimeAsync(9_999);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 1);

    await advanceTime(promise);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 2);
  });
});
