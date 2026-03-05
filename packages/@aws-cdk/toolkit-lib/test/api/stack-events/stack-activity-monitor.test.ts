import { Readable } from 'stream';
import {
  DescribeStackEventsCommand,
  ResourceStatus,
  type StackEvent,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import type { IIoHost } from '../../../lib/api/io';
import { asIoHelper } from '../../../lib/api/io/private';
import { StackActivityMonitor } from '../../../lib/api/stack-events';
import { testStack } from '../../_helpers/assembly';
import { MockSdk, mockCloudFormationClient, mockS3Client, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';

let sdk: MockSdk;
let monitor: StackActivityMonitor;
let ioHost: IIoHost = {
  notify: jest.fn(),
  requestResponse: jest.fn().mockImplementation((msg) => msg.defaultResponse),
};
beforeEach(async () => {
  sdk = new MockSdk();

  monitor = await new StackActivityMonitor({
    cfn: sdk.cloudFormation(),
    ioHelper: asIoHelper(ioHost, 'deploy'),
    stack: testStack({
      stackName: 'StackName',
    }),
    stackName: 'StackName',
    changeSetCreationTime: new Date(T100),
    pollingInterval: 0,
    s3Client: sdk.s3(),
  }).start();

  restoreSdkMocksToDefault();
});

describe('stack monitor event ordering and pagination', () => {
  test('continue to the next page if it exists', async () => {
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [event(102), event(101)],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    // Printer sees them in chronological order
    expect(ioHost.notify).toHaveBeenCalledTimes(4);
    expect(ioHost.notify).toHaveBeenNthCalledWith(1, expectStart());
    expect(ioHost.notify).toHaveBeenNthCalledWith(2, expectEvent(101));
    expect(ioHost.notify).toHaveBeenNthCalledWith(3, expectEvent(102));
    expect(ioHost.notify).toHaveBeenNthCalledWith(4, expectStop());
  });

  test('do not page further if we already saw the last event', async () => {
    mockCloudFormationClient
      .on(DescribeStackEventsCommand)
      .resolvesOnce({
        StackEvents: [event(101)],
      })
      .resolvesOnce({
        StackEvents: [event(102), event(101)],
      })
      .resolvesOnce({});

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    // Seen in chronological order
    expect(ioHost.notify).toHaveBeenCalledTimes(4);
    expect(ioHost.notify).toHaveBeenNthCalledWith(1, expectStart());
    expect(ioHost.notify).toHaveBeenNthCalledWith(2, expectEvent(101));
    expect(ioHost.notify).toHaveBeenNthCalledWith(3, expectEvent(102));
    expect(ioHost.notify).toHaveBeenNthCalledWith(4, expectStop());
  });

  test('do not page further if the last event is too old', async () => {
    mockCloudFormationClient
      .on(DescribeStackEventsCommand)
      .resolvesOnce({
        StackEvents: [event(101), event(95)],
      })
      .resolvesOnce({
        StackEvents: [],
      });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    // Seen only the new one
    expect(ioHost.notify).toHaveBeenCalledTimes(3);
    expect(ioHost.notify).toHaveBeenNthCalledWith(1, expectStart());
    expect(ioHost.notify).toHaveBeenNthCalledWith(2, expectEvent(101));
    expect(ioHost.notify).toHaveBeenNthCalledWith(3, expectStop());
  });

  test('do a final request after the monitor is stopped', async () => {
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolves({
      StackEvents: [event(101)],
    });
    // Establish that we've received events prior to stop and then reset the mock
    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    mockCloudFormationClient.resetHistory();
    await monitor.stop();
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolves({
      StackEvents: [event(102), event(101)],
    });
    // Since we can't reset the mock to a new value before calling stop, we'll have to check
    // and make sure it's called again instead.
    expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand);
  });
});

describe('stack monitor, collecting errors from events', () => {
  test('return errors from the root stack', async () => {
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [addErrorToStackEvent(event(100))],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();
    expect(monitor.errors).toStrictEqual(['Test Error']);
  });

  test('return errors from the nested stack', async () => {
    mockCloudFormationClient
      .on(DescribeStackEventsCommand)
      .resolvesOnce({
        StackEvents: [
          addErrorToStackEvent(event(102), {
            logicalResourceId: 'nestedStackLogicalResourceId',
            physicalResourceId: 'nestedStackPhysicalResourceId',
            resourceType: 'AWS::CloudFormation::Stack',
            resourceStatusReason: 'nested stack failed',
            resourceStatus: ResourceStatus.UPDATE_FAILED,
          }),
          addErrorToStackEvent(event(100), {
            logicalResourceId: 'nestedStackLogicalResourceId',
            physicalResourceId: 'nestedStackPhysicalResourceId',
            resourceType: 'AWS::CloudFormation::Stack',
            resourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
          }),
        ],
      })
      .resolvesOnce({
        StackEvents: [
          addErrorToStackEvent(event(101), {
            logicalResourceId: 'nestedResource',
            resourceType: 'Some::Nested::Resource',
            resourceStatusReason: 'actual failure error message',
          }),
        ],
      });

    await eventually(
      () =>
        expect(mockCloudFormationClient).toHaveReceivedNthCommandWith(1, DescribeStackEventsCommand, {
          StackName: 'StackName',
        }),
      2,
    );

    await eventually(
      () =>
        expect(mockCloudFormationClient).toHaveReceivedNthCommandWith(2, DescribeStackEventsCommand, {
          StackName: 'nestedStackPhysicalResourceId',
        }),
      2,
    );
    await monitor.stop();
    expect(monitor.errors).toStrictEqual(['actual failure error message', 'nested stack failed']);
  });

  test('does not consider events without physical resource id for monitoring nested stacks', async () => {
    mockCloudFormationClient
      .on(DescribeStackEventsCommand)
      .resolvesOnce({
        StackEvents: [
          addErrorToStackEvent(event(100), {
            logicalResourceId: 'nestedStackLogicalResourceId',
            physicalResourceId: '',
            resourceType: 'AWS::CloudFormation::Stack',
            resourceStatusReason: 'nested stack failed',
          }),
        ],
        NextToken: 'nextToken',
      })
      .resolvesOnce({
        StackEvents: [
          addErrorToStackEvent(event(101), {
            logicalResourceId: 'OtherResource',
            resourceType: 'Some::Other::Resource',
            resourceStatusReason: 'some failure',
          }),
        ],
      });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(monitor.errors).toStrictEqual(['nested stack failed', 'some failure']);
    expect(mockCloudFormationClient).toHaveReceivedNthCommandWith(1, DescribeStackEventsCommand, {
      StackName: 'StackName',
    });
    // Note that the second call happened for the top level stack instead of a nested stack
    expect(mockCloudFormationClient).toHaveReceivedNthCommandWith(2, DescribeStackEventsCommand, {
      StackName: 'StackName',
    });
  });

  test('does not check for nested stacks that have already completed successfully', async () => {
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        addErrorToStackEvent(event(100), {
          logicalResourceId: 'nestedStackLogicalResourceId',
          physicalResourceId: 'nestedStackPhysicalResourceId',
          resourceType: 'AWS::CloudFormation::Stack',
          resourceStatusReason: 'nested stack status reason',
          resourceStatus: StackStatus.CREATE_COMPLETE,
        }),
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(monitor.errors).toStrictEqual([]);
  });
});

const T0 = 1597837230504;

// Events 0-99 are before we started paying attention
const T100 = T0 + 100 * 1000;

function event(nr: number): StackEvent {
  return {
    EventId: `${nr}`,
    StackId: 'StackId',
    StackName: 'StackName',
    Timestamp: new Date(T0 + nr * 1000),
  };
}

function addErrorToStackEvent(
  eventToUpdate: StackEvent,
  props: {
    resourceStatus?: ResourceStatus;
    resourceType?: string;
    resourceStatusReason?: string;
    logicalResourceId?: string;
    physicalResourceId?: string;
  } = {},
): StackEvent {
  eventToUpdate.ResourceStatus = props.resourceStatus ?? ResourceStatus.UPDATE_FAILED;
  eventToUpdate.ResourceType = props.resourceType ?? 'Test::Resource::Type';
  eventToUpdate.ResourceStatusReason = props.resourceStatusReason ?? 'Test Error';
  eventToUpdate.LogicalResourceId = props.logicalResourceId ?? 'testLogicalId';
  eventToUpdate.PhysicalResourceId = props.physicalResourceId ?? 'testPhysicalResourceId';
  return eventToUpdate;
}

const wait = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

// Using the eventually function to ensure these functions have had sufficient time to execute.
const eventually = async (call: () => void, attempts: number): Promise<void> => {
  while (attempts-- >= 0) {
    try {
      return call();
    } catch (err) {
      if (attempts <= 0) throw err;
    }
    await wait();
  }

  throw new Error('An unexpected error has occurred.');
};

const expectStart = () => expect.objectContaining({ code: 'CDK_TOOLKIT_I5501' });
const expectStop = () => expect.objectContaining({ code: 'CDK_TOOLKIT_I5503' });
const expectEvent = (id: number) => expect.objectContaining({
  code: 'CDK_TOOLKIT_I5502',
  data: expect.objectContaining({
    event: expect.objectContaining({ EventId: String(id) }),
  }),
});

describe('GuardHook S3 fetching', () => {
  test('fetches and replaces HookStatusReason with S3 content when S3 URL is present', async () => {
    const guardHookDetails = `[
  {
    "name": "STDIN",
    "metadata": {},
    "status": "FAIL",
    "not_compliant": [
      {
        "Rule": {
          "name": "AWS_SNS_Topic_KmsMasterKeyId",
          "metadata": {},
          "messages": {
            "custom_message": null,
            "error_message": "Check was not compliant as property [KmsMasterKeyId] is missing."
          }
        }
      }
    ]
  }
]`;

    const stream = new Readable();
    stream.push(guardHookDetails);
    stream.push(null);
    const sdkStream = sdkStreamMixin(stream);

    mockS3Client.on(GetObjectCommand).resolvesOnce({
      Body: sdkStream as any,
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        {
          ...event(101),
          StackName: 'TestStack',
          LogicalResourceId: 'TestResource',
          ResourceType: 'AWS::SNS::Topic',
          ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
          HookStatus: 'HOOK_COMPLETE_FAILED',
          HookType: 'Private::Guard::TestHook',
          HookStatusReason: 'Template failed validation. Full output was written to s3://test-guard-logs-bucket/cfn-guard-validate-report/AWS--SNS--Topic-AwsSNSTopic/1234567890123.json',
        },
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(mockS3Client).toHaveReceivedCommandTimes(GetObjectCommand, 1);
    expect(mockS3Client).toHaveReceivedCommandWith(GetObjectCommand, {
      Bucket: 'test-guard-logs-bucket',
      Key: 'cfn-guard-validate-report/AWS--SNS--Topic-AwsSNSTopic/1234567890123.json',
    });

    expect(ioHost.notify).toHaveBeenCalledTimes(3);
    expect(ioHost.notify).toHaveBeenNthCalledWith(1, expectStart());
    expect(ioHost.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: guardHookDetails,
          }),
        }),
      }),
    );
    expect(ioHost.notify).toHaveBeenNthCalledWith(3, expectStop());
  });

  test('keeps original HookStatusReason when S3 fetch fails', async () => {
    mockS3Client.on(GetObjectCommand).rejectsOnce('Access denied');

    const originalMessage = 'Template failed validation. Full output was written to s3://test-guard-logs-bucket/cfn-guard-validate-report/AWS--SNS--Topic-AwsSNSTopic/1234567890123.json';

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        {
          ...event(101),
          StackName: 'TestStack',
          LogicalResourceId: 'TestResource',
          ResourceType: 'AWS::SNS::Topic',
          ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
          HookStatus: 'HOOK_COMPLETE_FAILED',
          HookType: 'Private::Guard::TestHook',
          HookStatusReason: originalMessage,
        },
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(mockS3Client).toHaveReceivedCommandTimes(GetObjectCommand, 1);
    expect(mockS3Client).toHaveReceivedCommandWith(GetObjectCommand, {
      Bucket: 'test-guard-logs-bucket',
      Key: 'cfn-guard-validate-report/AWS--SNS--Topic-AwsSNSTopic/1234567890123.json',
    });

    expect(ioHost.notify).toHaveBeenCalledTimes(4);
    expect(ioHost.notify).toHaveBeenNthCalledWith(1, expectStart());
    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        level: 'warn',
        message: 'Failed to fetch Guard Hook details from s3://test-guard-logs-bucket/cfn-guard-validate-report/AWS--SNS--Topic-AwsSNSTopic/1234567890123.json: Access denied',
      }),
    );
    expect(ioHost.notify).toHaveBeenNthCalledWith(3,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: originalMessage,
          }),
        }),
      }),
    );
    expect(ioHost.notify).toHaveBeenNthCalledWith(4, expectStop());
  });
});
