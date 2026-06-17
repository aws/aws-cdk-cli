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

  test('collects DELETE_FAILED events into deleteFailures', async () => {
    const deployTime = Date.now();

    const sdk = new MockSdk();
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolves({
      StackEvents: [
        {
          Timestamp: new Date(deployTime + 3000),
          EventId: 'event-3',
          StackId: 'stack-id',
          StackName: 'stack',
          LogicalResourceId: 'MyBucket',
          PhysicalResourceId: 'my-bucket-12345',
          ResourceType: 'AWS::S3::Bucket',
          ResourceStatus: 'DELETE_FAILED',
          ResourceStatusReason: 'The bucket is not empty',
        },
        {
          Timestamp: new Date(deployTime + 2000),
          EventId: 'event-2',
          StackId: 'stack-id',
          StackName: 'stack',
          LogicalResourceId: 'MyFunction',
          ResourceType: 'AWS::Lambda::Function',
          ResourceStatus: 'DELETE_COMPLETE',
        },
        {
          Timestamp: new Date(deployTime + 1000),
          EventId: 'event-1',
          StackId: 'stack-id',
          StackName: 'stack',
          LogicalResourceId: 'MyTable',
          PhysicalResourceId: 'my-table',
          ResourceType: 'AWS::DynamoDB::Table',
          ResourceStatus: 'DELETE_FAILED',
          ResourceStatusReason: 'Table has deletion protection enabled',
        },
      ],
    });

    const poller = new StackEventPoller(sdk.cloudFormation(), {
      stackArn: 'stack-id',
      initialPollRange: PollRange.sinceTimestamp(deployTime),
    });

    await poller.poll();

    expect(poller.deleteFailures).toEqual([
      {
        logicalResourceId: 'MyTable',
        physicalResourceId: 'my-table',
        resourceType: 'AWS::DynamoDB::Table',
        reason: 'Table has deletion protection enabled',
      },
      {
        logicalResourceId: 'MyBucket',
        physicalResourceId: 'my-bucket-12345',
        resourceType: 'AWS::S3::Bucket',
        reason: 'The bucket is not empty',
      },
    ]);
  });

  test('does not include AWS::CloudFormation::Stack DELETE_FAILED in deleteFailures', async () => {
    const deployTime = Date.now();

    const sdk = new MockSdk();
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolves({
      StackEvents: [
        {
          Timestamp: new Date(deployTime + 1000),
          EventId: 'event-1',
          StackId: 'stack-id',
          StackName: 'stack',
          LogicalResourceId: 'NestedStack',
          ResourceType: 'AWS::CloudFormation::Stack',
          ResourceStatus: 'DELETE_FAILED',
          ResourceStatusReason: 'Nested stack failed',
        },
      ],
    });

    const poller = new StackEventPoller(sdk.cloudFormation(), {
      stackArn: 'stack-id',
      initialPollRange: PollRange.sinceTimestamp(deployTime),
    });

    await poller.poll();

    expect(poller.deleteFailures).toEqual([]);
  });
});
