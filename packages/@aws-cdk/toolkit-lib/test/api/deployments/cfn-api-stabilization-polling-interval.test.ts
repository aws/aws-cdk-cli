import { DescribeStacksCommand, StackStatus } from '@aws-sdk/client-cloudformation';
import type { ICloudFormationClient } from '../../../lib/api/aws-auth/private';
import { stabilizeStack, waitForStackDelete, waitForStackDeploy } from '../../../lib/api/deployments/cfn-api';
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

function stackResponse(status: StackStatus) {
  return {
    Stacks: [
      {
        StackName: 'my-stack',
        StackId: 'my-stack-id',
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
    const promise = stabilizeStack(cfn, ioHelper, 'my-stack', 10_000);

    // THEN
    await jest.advanceTimersByTimeAsync(9_999);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 1);

    const result = await advanceTime(promise);
    expect(result?.stackStatus.name).toEqual(StackStatus.UPDATE_COMPLETE);
    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(DescribeStacksCommand, 2);
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
