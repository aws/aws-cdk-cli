import {
  DescribeStackEventsCommand,
  GetHookResultCommand,
  ResourceStatus,
  type StackEvent,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import type { IIoHost } from '../../../lib/api/io';
import { asIoHelper } from '../../../lib/api/io/private';
import { StackActivityMonitor } from '../../../lib/api/stack-events';
import { testStack } from '../../_helpers/assembly';
import { MockSdk, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';

let sdk: MockSdk;
let monitor: StackActivityMonitor;
const mockEnvResources = { lookupToolkit: jest.fn().mockResolvedValue({ version: 30 }) };
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
    envResources: mockEnvResources as any,
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
      StackEvents: [errorEvent(100)],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();
    expect(monitor.allErrorMessages).toStrictEqual(['Test Error']);
  });

  test('find error code in the root stack', async () => {
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [errorEvent(100, {
        resourceStatusReason: 'Test Error (Error Code: OhNo)',
      })],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();
    expect(monitor.rootCauseErrorCode).toStrictEqual('ResourceType:OhNo');
  });

  test('errors without a clear regex match are reported as unknown', async () => {
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [errorEvent(100)],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();
    expect(monitor.rootCauseErrorCode).toStrictEqual('ResourceType:UnknownError');
  });

  test('error code does not include resource type for non-AWS resources', async () => {
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [errorEvent(100, {
        resourceType: 'Private::Resource::Type',
      })],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();
    expect(monitor.rootCauseErrorCode).toStrictEqual('PrivateResourceError');
  });

  describe('return errors from the nested stack', () => {
    beforeEach(() => {
      mockCloudFormationClient
        .on(DescribeStackEventsCommand)
        .resolvesOnce({
          StackEvents: [
            errorEvent(102, {
              logicalResourceId: 'nestedStackLogicalResourceId',
              physicalResourceId: 'nestedStackPhysicalResourceId',
              resourceType: 'AWS::CloudFormation::Stack',
              resourceStatusReason: 'nested stack failed',
              resourceStatus: ResourceStatus.UPDATE_FAILED,
            }),
            errorEvent(100, {
              logicalResourceId: 'nestedStackLogicalResourceId',
              physicalResourceId: 'nestedStackPhysicalResourceId',
              resourceType: 'AWS::CloudFormation::Stack',
              resourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
            }),
          ],
        })
        .resolvesOnce({
          StackEvents: [
            errorEvent(101, {
              logicalResourceId: 'nestedResource',
              resourceType: 'AWS::Nested::Resource',
              resourceStatusReason: 'actual failure error message (Error Code: Explosion)',
            }),
          ],
        });
    });

    async function monitorSettled() {
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
    }

    test('error message', async () => {
      await monitorSettled();
      expect(monitor.allErrorMessages).toStrictEqual(['actual failure error message (Error Code: Explosion)']);
    });

    test('error code', async () => {
      await monitorSettled();
      expect(monitor.rootCauseErrorCode).toStrictEqual('NestedResource:Explosion');
    });
  });

  test('does not consider events without physical resource id for monitoring nested stacks', async () => {
    mockCloudFormationClient
      .on(DescribeStackEventsCommand)
      .resolvesOnce({
        StackEvents: [
          errorEvent(100, {
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
          errorEvent(101, {
            logicalResourceId: 'OtherResource',
            resourceType: 'Some::Other::Resource',
            resourceStatusReason: 'some failure',
          }),
        ],
      });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(monitor.allErrorMessages).toStrictEqual(['some failure']);
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
        errorEvent(100, {
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

    expect(monitor.allErrorMessages).toStrictEqual([]);
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

function errorEvent(nr: number, props?: Parameters<typeof addErrorToStackEvent>[1]) {
  return addErrorToStackEvent(event(nr), props);
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
  eventToUpdate.ResourceType = props.resourceType ?? 'AWS::Resource::Type';
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

describe('GuardHook GetHookResult fetching', () => {
  test('fetches annotations and replaces HookStatusReason when HookInvocationId is present', async () => {
    const hookInvocationId = '6dbedd85-c808-45b7-ad63-3c717d137a32';

    mockCloudFormationClient.on(GetHookResultCommand).resolvesOnce({
      HookResultId: hookInvocationId,
      InvocationPoint: 'PRE_PROVISION',
      FailureMode: 'FAIL',
      TypeName: 'Private::Guard::TestHook',
      OriginalTypeName: 'AWS::Hooks::GuardHook',
      Status: 'HOOK_COMPLETE_FAILED',
      HookStatusReason: 'Template failed validation, the following rule(s) failed: AWS_S3_Bucket_AccessControl. Full output was written to s3://bucket/path/file.json',
      Target: {
        TargetType: 'RESOURCE',
        TargetTypeName: 'AWS::S3::Bucket',
        TargetId: 'NonCompliantBucket',
        Action: 'CREATE',
      },
      Annotations: [
        {
          AnnotationName: 'AWS_S3_Bucket_AccessControl',
          Status: 'FAILED',
          StatusMessage: 'Check was not compliant as property [/Resources/NonCompliantBucket/Properties/AccessControl[L:0,C:91]] existed.',
          RemediationMessage: '\n            AccessControl is deprecated\n        ',
        },
      ],
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        {
          ...event(101),
          StackName: 'TestStack',
          LogicalResourceId: 'NonCompliantBucket',
          ResourceType: 'AWS::S3::Bucket',
          ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
          HookStatus: 'HOOK_COMPLETE_FAILED',
          HookType: 'Private::Guard::TestHook',
          HookInvocationId: hookInvocationId,
          HookStatusReason: 'Template failed validation, the following rule(s) failed: AWS_S3_Bucket_AccessControl. Full output was written to s3://bucket/path/file.json',
        },
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(GetHookResultCommand, 1);
    expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetHookResultCommand, {
      HookResultId: hookInvocationId,
    });

    expect(ioHost.notify).toHaveBeenCalledTimes(3);
    expect(ioHost.notify).toHaveBeenNthCalledWith(1, expectStart());
    // RemediationMessage whitespace/newlines are collapsed to a single space
    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: [
              'NonCompliant Rules:',
              '',
              '[AWS_S3_Bucket_AccessControl]',
              '• Check was not compliant as property [/Resources/NonCompliantBucket/Properties/AccessControl[L:0,C:91]] existed.',
              'Remediation: AccessControl is deprecated',
            ].join('\n'),
          }),
        }),
      }),
    );
    expect(ioHost.notify).toHaveBeenNthCalledWith(3, expectStop());
  });

  test('keeps original HookStatusReason when GetHookResult fails', async () => {
    const hookInvocationId = 'failing-invocation-id';
    const originalMessage = 'Template failed validation, the following rule(s) failed: AWS_S3_Bucket_AccessControl.';

    const errorMessage = 'Hook result not found';
    mockCloudFormationClient.on(GetHookResultCommand).rejectsOnce(errorMessage);

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        {
          ...event(101),
          StackName: 'TestStack',
          LogicalResourceId: 'NonCompliantBucket',
          ResourceType: 'AWS::S3::Bucket',
          ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
          HookStatus: 'HOOK_COMPLETE_FAILED',
          HookType: 'Private::Guard::TestHook',
          HookInvocationId: hookInvocationId,
          HookStatusReason: originalMessage,
        },
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(GetHookResultCommand, 1);

    expect(ioHost.notify).toHaveBeenCalledTimes(4);
    expect(ioHost.notify).toHaveBeenNthCalledWith(1, expectStart());
    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        level: 'warn',
        message: `Failed to fetch Guard Hook details for invocation ${hookInvocationId}: ${errorMessage}`,
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

  test('warns with bootstrap upgrade message when GetHookResult fails due to permissions', async () => {
    const hookInvocationId = 'failing-invocation-id';
    const originalMessage = 'Template failed validation, the following rule(s) failed: AWS_S3_Bucket_AccessControl.';

    const errorMessage = 'User: arn:aws:iam::123456789012:role/test is not authorized to perform: cloudformation:GetHookResult';
    const currentVersion = 30;
    mockCloudFormationClient.on(GetHookResultCommand).rejectsOnce(errorMessage);

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        {
          ...event(101),
          StackName: 'TestStack',
          LogicalResourceId: 'NonCompliantBucket',
          ResourceType: 'AWS::S3::Bucket',
          ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
          HookStatus: 'HOOK_COMPLETE_FAILED',
          HookType: 'Private::Guard::TestHook',
          HookInvocationId: hookInvocationId,
          HookStatusReason: originalMessage,
        },
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(GetHookResultCommand, 1);

    expect(ioHost.notify).toHaveBeenCalledTimes(4);
    expect(ioHost.notify).toHaveBeenNthCalledWith(1, expectStart());
    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        level: 'warn',
        message: `Failed to fetch result details for Hook invocation ${hookInvocationId}: ${errorMessage}. Make sure you have permissions to call the GetHookResult API, or re-bootstrap your environment by running 'cdk bootstrap' to update the Bootstrap CDK Toolkit stack.
            'Bootstrap toolkit stack version 31 or later is needed; current version: ${currentVersion}.`,
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

  test('does not call GetHookResult when HookInvocationId is absent', async () => {
    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        {
          ...event(101),
          StackName: 'TestStack',
          LogicalResourceId: 'SomeResource',
          ResourceType: 'AWS::S3::Bucket',
          ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
          HookStatus: 'HOOK_COMPLETE_FAILED',
          HookType: 'Private::Guard::TestHook',
          HookStatusReason: 'Template failed validation.',
          // No HookInvocationId
        },
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(GetHookResultCommand, 0);

    expect(ioHost.notify).toHaveBeenCalledTimes(3);
    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: 'Template failed validation.',
          }),
        }),
      }),
    );
  });

  test('keeps original HookStatusReason when annotations are empty', async () => {
    const hookInvocationId = 'empty-annotations-id';
    const originalMessage = 'Template failed validation.';

    mockCloudFormationClient.on(GetHookResultCommand).resolvesOnce({
      HookResultId: hookInvocationId,
      Status: 'HOOK_COMPLETE_FAILED',
      Annotations: [],
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        {
          ...event(101),
          HookInvocationId: hookInvocationId,
          HookStatusReason: originalMessage,
          ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
        },
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(mockCloudFormationClient).toHaveReceivedCommandTimes(GetHookResultCommand, 1);
    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: originalMessage,
          }),
        }),
      }),
    );
  });

  test('formats multiple failed annotations', async () => {
    const hookInvocationId = 'multi-annotation-id';

    mockCloudFormationClient.on(GetHookResultCommand).resolvesOnce({
      HookResultId: hookInvocationId,
      Status: 'HOOK_COMPLETE_FAILED',
      Annotations: [
        {
          AnnotationName: 'AWS_S3_Bucket_PublicAccessBlock',
          Status: 'FAILED',
          StatusMessage: 'PublicAccessBlock configuration is missing.',
        },
        {
          AnnotationName: 'AWS_S3_Bucket_Encryption',
          Status: 'FAILED',
          StatusMessage: 'Bucket encryption is not configured.',
          RemediationMessage: 'Enable AES256 encryption.',
        },
        {
          AnnotationName: 'AWS_S3_Bucket_Versioning',
          Status: 'PASSED',
          StatusMessage: 'Versioning is enabled.',
        },
      ],
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [
        {
          ...event(101),
          HookInvocationId: hookInvocationId,
          HookStatusReason: 'Template failed validation.',
          ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS,
        },
      ],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    const expectedReason = [
      'NonCompliant Rules:',
      '',
      '[AWS_S3_Bucket_PublicAccessBlock]',
      '• PublicAccessBlock configuration is missing.',
      '',
      '[AWS_S3_Bucket_Encryption]',
      '• Bucket encryption is not configured.',
      'Remediation: Enable AES256 encryption.',
    ].join('\n');

    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: expectedReason,
          }),
        }),
      }),
    );
  });

  test('collapses newlines and extra whitespace to a single space in StatusMessage', async () => {
    const hookInvocationId = 'normalize-status-id';

    mockCloudFormationClient.on(GetHookResultCommand).resolvesOnce({
      HookResultId: hookInvocationId,
      Status: 'HOOK_COMPLETE_FAILED',
      Annotations: [
        {
          AnnotationName: 'AWS_S3_Bucket_Rule',
          Status: 'FAILED',
          StatusMessage: '  Line 1\n  Line 2\n\n  Line 3   ',
        },
      ],
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [{ ...event(101), HookInvocationId: hookInvocationId, ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS }],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: ['NonCompliant Rules:', '', '[AWS_S3_Bucket_Rule]', '• Line 1 Line 2 Line 3'].join('\n'),
          }),
        }),
      }),
    );
  });

  test('collapses newlines and extra whitespace to a single space in RemediationMessage', async () => {
    const hookInvocationId = 'normalize-remediation-id';

    mockCloudFormationClient.on(GetHookResultCommand).resolvesOnce({
      HookResultId: hookInvocationId,
      Status: 'HOOK_COMPLETE_FAILED',
      Annotations: [
        {
          AnnotationName: 'AWS_S3_Bucket_Rule',
          Status: 'FAILED',
          StatusMessage: 'Non-compliant.',
          RemediationMessage: '\n    Do this.\n    Then do that.\n  ',
        },
      ],
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [{ ...event(101), HookInvocationId: hookInvocationId, ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS }],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: [
              'NonCompliant Rules:',
              '',
              '[AWS_S3_Bucket_Rule]',
              '• Non-compliant.',
              'Remediation: Do this. Then do that.',
            ].join('\n'),
          }),
        }),
      }),
    );
  });

  test('truncates StatusMessage exceeding 400 characters', async () => {
    const hookInvocationId = 'truncate-status-id';
    const longMessage = 'A'.repeat(500);

    mockCloudFormationClient.on(GetHookResultCommand).resolvesOnce({
      HookResultId: hookInvocationId,
      Status: 'HOOK_COMPLETE_FAILED',
      Annotations: [
        {
          AnnotationName: 'AWS_S3_Bucket_Rule',
          Status: 'FAILED',
          StatusMessage: longMessage,
        },
      ],
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [{ ...event(101), HookInvocationId: hookInvocationId, ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS }],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: [
              'NonCompliant Rules:',
              '',
              '[AWS_S3_Bucket_Rule]',
              `• ${'A'.repeat(400)}[...truncated]`,
            ].join('\n'),
          }),
        }),
      }),
    );
  });

  test('truncates RemediationMessage exceeding 400 characters', async () => {
    const hookInvocationId = 'truncate-remediation-id';
    const longRemediation = 'B'.repeat(500);

    mockCloudFormationClient.on(GetHookResultCommand).resolvesOnce({
      HookResultId: hookInvocationId,
      Status: 'HOOK_COMPLETE_FAILED',
      Annotations: [
        {
          AnnotationName: 'AWS_S3_Bucket_Rule',
          Status: 'FAILED',
          StatusMessage: 'Non-compliant.',
          RemediationMessage: longRemediation,
        },
      ],
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [{ ...event(101), HookInvocationId: hookInvocationId, ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS }],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: [
              'NonCompliant Rules:',
              '',
              '[AWS_S3_Bucket_Rule]',
              '• Non-compliant.',
              `Remediation: ${'B'.repeat(400)}[...truncated]`,
            ].join('\n'),
          }),
        }),
      }),
    );
  });

  test('does not truncate messages at exactly 400 characters', async () => {
    const hookInvocationId = 'no-truncate-id';
    const exactMessage = 'C'.repeat(400);

    mockCloudFormationClient.on(GetHookResultCommand).resolvesOnce({
      HookResultId: hookInvocationId,
      Status: 'HOOK_COMPLETE_FAILED',
      Annotations: [
        {
          AnnotationName: 'AWS_S3_Bucket_Rule',
          Status: 'FAILED',
          StatusMessage: exactMessage,
        },
      ],
    });

    mockCloudFormationClient.on(DescribeStackEventsCommand).resolvesOnce({
      StackEvents: [{ ...event(101), HookInvocationId: hookInvocationId, ResourceStatus: ResourceStatus.UPDATE_IN_PROGRESS }],
    });

    await eventually(() => expect(mockCloudFormationClient).toHaveReceivedCommand(DescribeStackEventsCommand), 2);
    await monitor.stop();

    expect(ioHost.notify).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        code: 'CDK_TOOLKIT_I5502',
        data: expect.objectContaining({
          event: expect.objectContaining({
            HookStatusReason: [
              'NonCompliant Rules:',
              '',
              '[AWS_S3_Bucket_Rule]',
              `• ${'C'.repeat(400)}`,
            ].join('\n'),
          }),
        }),
      }),
    );
  });
});
