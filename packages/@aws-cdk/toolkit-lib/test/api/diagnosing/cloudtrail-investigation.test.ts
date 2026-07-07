import type { StackResource } from '@aws-sdk/client-cloudformation';
import { DescribeStackResourcesCommand, GetTemplateCommand, ResourceStatus } from '@aws-sdk/client-cloudformation';
import { LookupEventsCommand } from '@aws-sdk/client-cloudtrail';
import { investigateStackViaCloudTrail } from '../../../lib/api/diagnosing/cloudtrail-investigation';
import type { ResourceError } from '../../../lib/api/stack-events/resource-errors';
import {
  mockCloudFormationClient,
  mockCloudTrailClient,
  MockSdk,
  restoreSdkMocksToDefault,
} from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

// Fixtures modeled on real events captured while validating the design against two failed
// stacks: (A) a custom resource whose handler was denied s3:CreateBucket, and (B) a
// VPC-attached Lambda whose execution role could not call ec2:CreateNetworkInterface (the
// denied call is made by the Lambda *service* under an unpredictable session name).

const ACCOUNT = '123456789012';
const STACK_ARN = `arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/MyStack/abc`;
const FAILURE_TIME = new Date('2026-06-19T12:00:00.000Z');

const CR_FUNCTION_NAME = 'MyStack-CrHandler8F2F7DBF-mMR596IDq0hl';
const CR_ROLE_NAME = 'MyStack-CrHandlerServiceRole2D0F6-hA5P1ui2vtp5';
const VPC_ROLE_NAME = 'MyStack-VpcFnRole-MD1RNDeRclyR';

let sdk: MockSdk;
let ioHost: TestIoHost;

beforeEach(() => {
  restoreSdkMocksToDefault();
  jest.useFakeTimers().setSystemTime(FAILURE_TIME.valueOf() + 60 * 60 * 1000); // an hour after the failure
  sdk = new MockSdk();
  ioHost = new TestIoHost('debug');

  mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
    StackResources: [
      resource('CrHandler', 'AWS::Lambda::Function', CR_FUNCTION_NAME),
      resource('CrHandlerRole', 'AWS::IAM::Role', CR_ROLE_NAME),
      resource('VpcFn', 'AWS::Lambda::Function', 'MyStack-VpcFn-iB66SjyhkS37'),
      resource('VpcFnRole', 'AWS::IAM::Role', VPC_ROLE_NAME),
      resource('MyCustomResource', 'Custom::MyThing', '2026/06/19/[$LATEST]abc123'),
    ],
  });
  mockCloudFormationClient.on(GetTemplateCommand).resolves({
    TemplateBody: JSON.stringify({
      Resources: {
        CrHandler: { Type: 'AWS::Lambda::Function', Properties: { Role: { 'Fn::GetAtt': ['CrHandlerRole', 'Arn'] } } },
        VpcFn: { Type: 'AWS::Lambda::Function', Properties: { Role: { 'Fn::GetAtt': ['VpcFnRole', 'Arn'] } } },
        MyCustomResource: {
          Type: 'Custom::MyThing',
          Properties: { ServiceToken: { 'Fn::GetAtt': ['CrHandler', 'Arn'] } },
        },
      },
    }),
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function resource(logicalId: string, type: string, physicalId: string): StackResource {
  return {
    LogicalResourceId: logicalId,
    ResourceType: type,
    PhysicalResourceId: physicalId,
    Timestamp: FAILURE_TIME,
    ResourceStatus: ResourceStatus.CREATE_FAILED,
  };
}

function resourceError(overrides: Partial<ResourceError> = {}): ResourceError {
  return {
    stackArn: STACK_ARN,
    parentStackLogicalIds: [],
    logicalId: 'MyCustomResource',
    resourceType: 'Custom::MyThing',
    message: 'Received response status [FAILED] from custom resource',
    timestamp: FAILURE_TIME,
    ...overrides,
  };
}

/** A CloudTrail event as made by the custom resource's handler (Lambda role session). */
function handlerEvent(fields: Record<string, unknown> = {}) {
  return {
    CloudTrailEvent: JSON.stringify({
      eventTime: '2026-06-19T11:59:00Z',
      eventSource: 's3.amazonaws.com',
      eventName: 'CreateBucket',
      errorCode: 'AccessDenied',
      errorMessage: `User: arn:aws:sts::${ACCOUNT}:assumed-role/${CR_ROLE_NAME}/${CR_FUNCTION_NAME} is not authorized to perform: s3:CreateBucket`,
      userIdentity: {
        arn: `arn:aws:sts::${ACCOUNT}:assumed-role/${CR_ROLE_NAME}/${CR_FUNCTION_NAME}`,
        sessionContext: { sessionIssuer: { arn: `arn:aws:iam::${ACCOUNT}:role/${CR_ROLE_NAME}` } },
        inScopeOf: { credentialsIssuedTo: `arn:aws:lambda:us-east-1:${ACCOUNT}:function:${CR_FUNCTION_NAME}` },
      },
      ...fields,
    }),
  };
}

/** The service-on-your-behalf shape: Lambda service assuming the role with a generated session name. */
function serviceOnBehalfEvent(fields: Record<string, unknown> = {}) {
  return {
    CloudTrailEvent: JSON.stringify({
      eventTime: '2026-06-19T11:58:00Z',
      eventSource: 'ec2.amazonaws.com',
      eventName: 'CreateNetworkInterface',
      errorCode: 'Client.UnauthorizedOperation',
      errorMessage:
        `User: arn:aws:sts::${ACCOUNT}:assumed-role/${VPC_ROLE_NAME}/awslambda_320_20260619115800000 ` +
        'is not authorized to perform: ec2:CreateNetworkInterface',
      userIdentity: {
        arn: `arn:aws:sts::${ACCOUNT}:assumed-role/${VPC_ROLE_NAME}/awslambda_320_20260619115800000`,
        sessionContext: { sessionIssuer: { arn: `arn:aws:iam::${ACCOUNT}:role/${VPC_ROLE_NAME}` } },
      },
      ...fields,
    }),
  };
}

/** An errored event from an unrelated principal in the same account (concurrent deployment noise). */
function unrelatedEvent() {
  return {
    CloudTrailEvent: JSON.stringify({
      eventTime: '2026-06-19T11:59:30Z',
      eventSource: 'lambda.amazonaws.com',
      eventName: 'GetFunction20150331v2',
      errorCode: 'ResourceNotFoundException',
      errorMessage: 'Function not found: arn:aws:lambda:us-east-1:123456789012:function:other-stack-OtherFn-zzz',
      userIdentity: {
        arn: `arn:aws:sts::${ACCOUNT}:assumed-role/other-stack-OtherRole-yyy/session`,
        sessionContext: { sessionIssuer: { arn: `arn:aws:iam::${ACCOUNT}:role/other-stack-OtherRole-yyy` } },
      },
    }),
  };
}

describe('correlation', () => {
  test('attributes a handler AccessDenied to the custom resource via the role-session ARN', async () => {
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: [handlerEvent(), unrelatedEvent()] });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(1);
    expect(result!.errors[0].message).toMatch(/AccessDenied on s3\.amazonaws\.com:CreateBucket/);
    expect(result!.errors[0].message).toMatch(/not authorized to perform: s3:CreateBucket/);
  });

  test('attributes a service-on-your-behalf denial via the role name in the session ARN', async () => {
    // The ENI case: session name is service-generated, so only the bare role name embedded in
    // the session ARN can tie the event to the stack.
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: [serviceOnBehalfEvent()] });

    const result = await investigateStackViaCloudTrail(
      sdk,
      [resourceError({ logicalId: 'VpcFn', resourceType: 'AWS::Lambda::Function' })],
      ioHost.asHelper('diagnose'),
    );

    expect(result!.errors).toHaveLength(1);
    expect(result!.errors[0].logicalId).toEqual('VpcFnRole');
    expect(result!.errors[0].message).toMatch(/Client\.UnauthorizedOperation on ec2\.amazonaws\.com:CreateNetworkInterface/);
  });

  test('excludes errored events from unrelated principals in the same account', async () => {
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: [unrelatedEvent(), unrelatedEvent()] });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(0);
  });

  test('excludes errored calls made by the deploying principal (already in StatusReason)', async () => {
    // CloudFormation's own denied calls carry no stack identity in userIdentity (and often an
    // empty resources list); their message is already surfaced via the resource StatusReason.
    mockCloudTrailClient.on(LookupEventsCommand).resolves({
      Events: [{
        CloudTrailEvent: JSON.stringify({
          eventTime: '2026-06-19T11:59:00Z',
          eventSource: 'sns.amazonaws.com',
          eventName: 'GetTopicAttributes',
          errorCode: 'AccessDenied',
          userIdentity: {
            arn: `arn:aws:sts::${ACCOUNT}:assumed-role/deploy-role/AWSCloudFormation`,
            sessionContext: { sessionIssuer: { arn: `arn:aws:iam::${ACCOUNT}:role/deploy-role` } },
            invokedBy: 'cloudformation.amazonaws.com',
          },
        }),
      }],
    });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(0);
  });

  test('does not correlate via resources[].ARN — only the calling principal counts', async () => {
    // An unrelated principal's denied call AGAINST a stack resource is not the stack's
    // failure. Matching on touched resources would attribute foreign activity to the stack.
    mockCloudTrailClient.on(LookupEventsCommand).resolves({
      Events: [{
        CloudTrailEvent: JSON.stringify({
          eventTime: '2026-06-19T11:59:00Z',
          eventSource: 's3.amazonaws.com',
          eventName: 'PutBucketPolicy',
          errorCode: 'AccessDenied',
          userIdentity: {
            arn: `arn:aws:sts::${ACCOUNT}:assumed-role/some-unrelated-ci-role/ci-session`,
            sessionContext: { sessionIssuer: { arn: `arn:aws:iam::${ACCOUNT}:role/some-unrelated-ci-role` } },
          },
          resources: [{ ARN: `arn:aws:lambda:us-east-1:${ACCOUNT}:function:${CR_FUNCTION_NAME}` }],
        }),
      }],
    });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(0);
  });

  test('does not match an identity that is a prefix of another principal name', async () => {
    // 'MyStack-VpcFn-iB66SjyhkS37' must not claim events from a hypothetical
    // 'MyStack-VpcFn-iB66SjyhkS37x' principal: matching is by whole ARN segment.
    mockCloudTrailClient.on(LookupEventsCommand).resolves({
      Events: [{
        CloudTrailEvent: JSON.stringify({
          eventTime: '2026-06-19T11:59:00Z',
          eventSource: 's3.amazonaws.com',
          eventName: 'CreateBucket',
          errorCode: 'AccessDenied',
          userIdentity: {
            arn: `arn:aws:sts::${ACCOUNT}:assumed-role/other-role/MyStack-VpcFn-iB66SjyhkS37x`,
            sessionContext: { sessionIssuer: { arn: `arn:aws:iam::${ACCOUNT}:role/other-role` } },
          },
        }),
      }],
    });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(0);
  });

  test('correlates roles referenced by nested template properties', async () => {
    // Role references are often nested (Firehose destination configs, EventBridge targets);
    // the identity scan must find them at any depth. The role here is NOT a stack resource
    // (imported by ARN), so only the template scan can index it.
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          DeliveryStream: {
            Type: 'AWS::KinesisFirehose::DeliveryStream',
            Properties: {
              S3DestinationConfiguration: {
                BucketARN: 'arn:aws:s3:::some-bucket',
                RoleARN: `arn:aws:iam::${ACCOUNT}:role/imported-firehose-role`,
              },
            },
          },
        },
      }),
    });
    mockCloudTrailClient.on(LookupEventsCommand).resolves({
      Events: [{
        CloudTrailEvent: JSON.stringify({
          eventTime: '2026-06-19T11:59:00Z',
          eventSource: 's3.amazonaws.com',
          eventName: 'PutBucketPolicy',
          errorCode: 'AccessDenied',
          userIdentity: {
            arn: `arn:aws:sts::${ACCOUNT}:assumed-role/imported-firehose-role/firehose-session`,
            sessionContext: { sessionIssuer: { arn: `arn:aws:iam::${ACCOUNT}:role/imported-firehose-role` } },
          },
        }),
      }],
    });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(1);
    expect(result!.errors[0].logicalId).toEqual('DeliveryStream');
  });

  test('correlates a role expressed as Fn::Sub with a literal name segment', async () => {
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          Project: {
            Type: 'AWS::CodeBuild::Project',
            Properties: { ServiceRole: { 'Fn::Sub': 'arn:aws:iam::${AWS::AccountId}:role/my-codebuild-role' } },
          },
        },
      }),
    });
    mockCloudTrailClient.on(LookupEventsCommand).resolves({
      Events: [{
        CloudTrailEvent: JSON.stringify({
          eventTime: '2026-06-19T11:59:00Z',
          eventSource: 'ec2.amazonaws.com',
          eventName: 'CreateNetworkInterface',
          errorCode: 'Client.UnauthorizedOperation',
          userIdentity: {
            arn: `arn:aws:sts::${ACCOUNT}:assumed-role/my-codebuild-role/codebuild-session`,
            sessionContext: { sessionIssuer: { arn: `arn:aws:iam::${ACCOUNT}:role/my-codebuild-role` } },
          },
        }),
      }],
    });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(1);
    expect(result!.errors[0].logicalId).toEqual('Project');
  });

  test('still collects template-derived identities when DescribeStackResources fails', async () => {
    // A denied/throttled resource listing must not abort the investigation: a literal
    // ServiceToken ARN in the template is resolvable without physical IDs.
    const denied = new Error('not authorized');
    denied.name = 'AccessDeniedException';
    mockCloudFormationClient.on(DescribeStackResourcesCommand).rejects(denied);
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify({
        Resources: {
          MyCustomResource: {
            Type: 'Custom::MyThing',
            Properties: { ServiceToken: `arn:aws:lambda:us-east-1:${ACCOUNT}:function:${CR_FUNCTION_NAME}` },
          },
        },
      }),
    });
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: [handlerEvent()] });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(1);
    expect(result!.errors[0].logicalId).toEqual('MyCustomResource');
  });
});

describe('presentation', () => {
  test('collapses repeated identical errors and leads with the earliest distinct event', async () => {
    // Regression from validation: rollback/retry polling produced 67 identical
    // ResourceNotFoundException events *after* the single root-cause denial. Chronological
    // "last 5" would show only the noise; dedup + earliest-first must surface the root cause.
    const noise = Array.from({ length: 67 }, (_, i) => handlerEvent({
      eventTime: `2026-06-19T11:59:${String(10 + Math.floor(i / 10))}Z`,
      eventSource: 'lambda.amazonaws.com',
      eventName: 'GetFunctionConfiguration20150331v2',
      errorCode: 'ResourceNotFoundException',
      errorMessage: 'Function not found',
    }));
    mockCloudTrailClient.on(LookupEventsCommand).resolves({
      Events: [...noise, serviceOnBehalfEvent({ eventTime: '2026-06-19T11:58:00Z' })],
    });

    const result = await investigateStackViaCloudTrail(
      sdk,
      [resourceError({ logicalId: 'VpcFn' })],
      ioHost.asHelper('diagnose'),
    );

    expect(result!.errors).toHaveLength(2);
    expect(result!.errors[0].message).toMatch(/CreateNetworkInterface/);
    expect(result!.errors[1].message).toMatch(/ResourceNotFoundException/);
    expect(result!.errors[1].message).toMatch(/67 occurrences/);
  });

  test('caps distinct events at 5 and discloses the cut as a note', async () => {
    const events = Array.from({ length: 7 }, (_, i) => handlerEvent({
      eventName: `DistinctCall${i}`,
      eventTime: `2026-06-19T11:59:0${i}Z`,
    }));
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: events });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(5);
    expect(result!.errors[0].message).toMatch(/DistinctCall0/);
    // The overflow disclosure is scan metadata, not an error attributed to a resource.
    expect(result!.notes.join('\n')).toMatch(/2 more distinct CloudTrail error event\(s\) not shown/);
  });

  test('keeps the earlier event\'s own attribution when dedup replaces a later duplicate', async () => {
    // Two events with the same (eventSource, eventName, errorCode) from DIFFERENT resources:
    // LookupEvents returns newest-first, so the later (12:01) event is seen first. The dedup
    // must keep the earlier (11:58) event AND its resource, not mix event A with identity B.
    mockCloudTrailClient.on(LookupEventsCommand).resolves({
      Events: [
        handlerEvent({
          eventTime: '2026-06-19T12:01:00Z',
          eventSource: 'iam.amazonaws.com',
          eventName: 'PassRole',
          errorCode: 'AccessDenied',
          errorMessage: 'handler denied',
        }),
        serviceOnBehalfEvent({
          eventTime: '2026-06-19T11:58:00Z',
          eventSource: 'iam.amazonaws.com',
          eventName: 'PassRole',
          errorCode: 'AccessDenied',
          errorMessage: 'vpc role denied',
        }),
      ],
    });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(1);
    // The earlier event came from the VPC role's principal, so the attribution follows it.
    expect(result!.errors[0].logicalId).toEqual('VpcFnRole');
    expect(result!.errors[0].message).toMatch(/vpc role denied/);
    expect(result!.errors[0].message).toMatch(/2 occurrences/);
  });
});

describe('sweep mechanics', () => {
  test('sweeps without a LookupAttribute, bounded to the failure window', async () => {
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: [] });

    await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(mockCloudTrailClient).toHaveReceivedCommandWith(LookupEventsCommand, {
      StartTime: new Date(FAILURE_TIME.valueOf() - 5 * 60 * 1000),
      EndTime: new Date(FAILURE_TIME.valueOf() + 2 * 60 * 1000),
      MaxResults: 50,
    });
    const input = mockCloudTrailClient.commandCalls(LookupEventsCommand)[0].args[0].input as any;
    expect(input.LookupAttributes).toBeUndefined();
  });

  test('pages through results and discloses truncation with the number of events checked', async () => {
    // Two events per page (one errored, one clean): the disclosure must count events
    // CHECKED (20), not errored events kept (10).
    mockCloudTrailClient.on(LookupEventsCommand).resolves({
      Events: [
        handlerEvent(),
        { CloudTrailEvent: JSON.stringify({ eventTime: '2026-06-19T11:59:00Z', eventSource: 's3.amazonaws.com', eventName: 'CreateBucket' }) },
      ],
      NextToken: 'more',
    });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(mockCloudTrailClient).toHaveReceivedCommandTimes(LookupEventsCommand, 10);
    expect(result!.notes.join('\n')).toMatch(/only the most recent 20 CloudTrail events in the window were checked/);
  });

  test('skips the sweep when no failure has a timestamp to bound the window', async () => {
    const result = await investigateStackViaCloudTrail(
      sdk,
      [resourceError({ timestamp: undefined })],
      ioHost.asHelper('diagnose'),
    );

    expect(mockCloudTrailClient).not.toHaveReceivedCommand(LookupEventsCommand);
    expect(result).toBeUndefined();
  });

  test('hints at delivery latency when the failure is recent', async () => {
    jest.setSystemTime(FAILURE_TIME.valueOf() + 3 * 60 * 1000); // 3 minutes after failure
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: [] });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(0);
    expect(result!.notes.join('\n')).toMatch(/can lag up to 15 minutes/);
    expect(result!.notes.join('\n')).toMatch(/cdk diagnose/);
  });

  test('hints at delivery latency even when some events already correlated', async () => {
    // An early benign error being delivered does not mean the fatal one has been: the hint
    // must not be suppressed by partial delivery.
    jest.setSystemTime(FAILURE_TIME.valueOf() + 3 * 60 * 1000);
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: [handlerEvent()] });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(1);
    expect(result!.notes.join('\n')).toMatch(/can lag up to 15 minutes/);
  });

  test('stays quiet when nothing correlates and the failure is old', async () => {
    mockCloudTrailClient.on(LookupEventsCommand).resolves({ Events: [] });

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result!.errors).toHaveLength(0);
    expect(result!.notes).toHaveLength(0);
  });
});

describe('lookup failures are tooling warnings, not diagnosis', () => {
  test('a denied LookupEvents emits an actionable warning and returns no investigation', async () => {
    const denied = new Error('User is not authorized to perform: cloudtrail:LookupEvents');
    denied.name = 'AccessDeniedException';
    mockCloudTrailClient.on(LookupEventsCommand).rejects(denied);

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result).toBeUndefined();
    ioHost.expectMessage({ level: 'warn', containing: 'cloudtrail:LookupEvents' });
  });

  test('other lookup failures degrade silently to debug', async () => {
    mockCloudTrailClient.on(LookupEventsCommand).rejects(new Error('ThrottlingException: rate exceeded'));

    const result = await investigateStackViaCloudTrail(sdk, [resourceError()], ioHost.asHelper('diagnose'));

    expect(result).toBeUndefined();
    expect(ioHost.messages.filter((m) => m.level === 'warn')).toHaveLength(0);
    ioHost.expectMessage({ level: 'debug', containing: 'lookup failed' });
  });
});
