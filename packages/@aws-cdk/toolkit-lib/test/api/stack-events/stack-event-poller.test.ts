import type { DescribeStackEventsCommandInput, StackEvent } from '@aws-sdk/client-cloudformation';
import { DescribeStackEventsCommand } from '@aws-sdk/client-cloudformation';
import { StackEventPoller, PollRange } from '../../../lib/api/stack-events';
import { MockSdk, mockCloudFormationClient } from '../../_helpers/mock-sdk';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('poll', () => {
  test('polls all necessary pages', async () => {
    const deployTime = Date.now();

    const postDeployEvent1: StackEvent = {
      Timestamp: new Date(deployTime + 1000),
      EventId: 'event-1',
      StackId: 'stack-id',
      StackName: 'stack',
    };

    const postDeployEvent2: StackEvent = {
      Timestamp: new Date(deployTime + 2000),
      EventId: 'event-2',
      StackId: 'stack-id',
      StackName: 'stack',
    };

    const sdk = new MockSdk();
    mockCloudFormationClient.on(DescribeStackEventsCommand).callsFake((input: DescribeStackEventsCommandInput) => {
      const result = {
        StackEvents: input.NextToken === 'token' ? [postDeployEvent2] : [postDeployEvent1],
        NextToken: input.NextToken === 'token' ? undefined : 'token', // simulate a two page event stream.
      };

      return result;
    });

    const poller = new StackEventPoller(sdk.cloudFormation(), {
      stackArn: 'stack',
      initialPollRange: PollRange.sinceTimestamp(new Date().getTime()),
    });

    const events = await poller.poll();
    expect(events.length).toEqual(2);
  });

  test('does not poll unnecessary pages', async () => {
    const deployTime = Date.now();

    const preDeployTimeEvent: StackEvent = {
      Timestamp: new Date(deployTime - 1000),
      EventId: 'event-1',
      StackId: 'stack-id',
      StackName: 'stack',
    };

    const sdk = new MockSdk();
    mockCloudFormationClient.on(DescribeStackEventsCommand).callsFake((input: DescribeStackEventsCommandInput) => {
      // the first event we return should stop the polling. we therefore
      // do not expect a second page to be polled.
      expect(input.NextToken).toBe(undefined);

      return {
        StackEvents: [preDeployTimeEvent],
        NextToken: input.NextToken === 'token' ? undefined : 'token', // simulate a two page event stream.
      };
    });

    const poller = new StackEventPoller(sdk.cloudFormation(), {
      stackArn: 'stack',
      initialPollRange: PollRange.sinceTimestamp(new Date().getTime()),
    });

    await poller.poll();
  });

  test('swallows "does not exist" ValidationError when ARN is passed', async () => {
    const stackArn = 'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/some-guid';

    const sdk = new MockSdk();
    mockCloudFormationClient.on(DescribeStackEventsCommand).rejects(
      Object.assign(new Error(`Stack [${stackArn}] does not exist`), { name: 'ValidationError' }),
    );

    const poller = new StackEventPoller(sdk.cloudFormation(), {
      stackArn,
      initialPollRange: PollRange.sinceTimestamp(Date.now()),
    });

    const events = await poller.poll();
    expect(events).toEqual([]);
  });

  test('swallows "does not exist" ValidationError when plain name is passed', async () => {
    const sdk = new MockSdk();
    mockCloudFormationClient.on(DescribeStackEventsCommand).rejects(
      Object.assign(new Error('Stack [my-stack] does not exist'), { name: 'ValidationError' }),
    );

    const poller = new StackEventPoller(sdk.cloudFormation(), {
      stackArn: 'my-stack',
      initialPollRange: PollRange.sinceTimestamp(Date.now()),
    });

    const events = await poller.poll();
    expect(events).toEqual([]);
  });

  test('rethrows non-matching ValidationError', async () => {
    const stackArn = 'arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/some-guid';

    const sdk = new MockSdk();
    mockCloudFormationClient.on(DescribeStackEventsCommand).rejects(
      Object.assign(new Error('Something else went wrong'), { name: 'ValidationError' }),
    );

    const poller = new StackEventPoller(sdk.cloudFormation(), {
      stackArn,
      initialPollRange: PollRange.sinceTimestamp(Date.now()),
    });

    await expect(poller.poll()).rejects.toThrow('Something else went wrong');
  });
});
