import {
  ChangeSetStatus,
  DescribeStackResourcesCommand,
  GetHookResultCommand,
  ListHookResultsCommand,
  ResourceStatus,
} from '@aws-sdk/client-cloudformation';
import { LookupEventsCommand } from '@aws-sdk/client-cloudtrail';
import type { StackDiagnosis } from '../../../lib/actions/diagnose';
import type { Diagnosis } from '../../../lib/api/diagnosing/diagnosis';
import { CloudFormationStackDiagnoser } from '../../../lib/api/diagnosing/stack-diagnoser';
import type { ISourceTracer } from '../../../lib/api/source-tracing/private/source-tracing';
import type { SourceTrace } from '../../../lib/api/source-tracing/types';
import { ResourceErrors } from '../../../lib/api/stack-events/resource-errors';
import { FakeCloudFormation } from '../../_helpers/fake-aws/fake-cloudformation';
import { mockCloudFormationClient, mockCloudTrailClient, MockSdk, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

let sdk: MockSdk;
let fakeCfn: FakeCloudFormation;
let ioHost: TestIoHost;
let fakeTracer: FakeSourceTracer;

beforeEach(() => {
  sdk = new MockSdk();
  fakeCfn = new FakeCloudFormation();
  restoreSdkMocksToDefault();
  fakeCfn.installUsingAwsMock(mockCloudFormationClient);
  ioHost = new TestIoHost();
  fakeTracer = new FakeSourceTracer();
});

function makeDiagnoser(topLevelStackHierarchicalId = 'TestStack') {
  return new CloudFormationStackDiagnoser({
    sdk,
    sourceTracer: fakeTracer,
    ioHelper: ioHost.asHelper('diagnose'),
    topLevelStackHierarchicalId,
  });
}

function makeHookFetchingDiagnoser() {
  return new CloudFormationStackDiagnoser({
    sdk,
    sourceTracer: fakeTracer,
    ioHelper: ioHost.asHelper('diagnose'),
    topLevelStackHierarchicalId: 'TestStack',
    fetchHookFailureDetails: true,
  });
}

/**
 * A fake source tracer that records all calls and returns a fixed trace
 */
class FakeSourceTracer implements ISourceTracer {
  public readonly resourceCalls: Array<{ stackName: string; nestedStackLogicalIds: string[]; logicalId: string }> = [];
  public readonly stackCalls: Array<{ stackName: string; nestedStackLogicalIds: string[] }> = [];
  public traceToReturn: SourceTrace | undefined = undefined;

  async traceResource(stackName: string, nestedStackLogicalIds: string[], logicalId: string): Promise<SourceTrace | undefined> {
    this.resourceCalls.push({ stackName, nestedStackLogicalIds: [...nestedStackLogicalIds], logicalId });
    return this.traceToReturn;
  }

  async traceStack(stackName: string, nestedStackLogicalIds: string[]): Promise<SourceTrace | undefined> {
    this.stackCalls.push({ stackName, nestedStackLogicalIds: [...nestedStackLogicalIds] });
    return this.traceToReturn;
  }
}

/**
 * Assert the diagnosis is the 'problem' variant, and return it narrowed to that variant
 */
function assertProblem(diagnosis: Diagnosis): Extract<StackDiagnosis, { type: 'problem' }> {
  expect(diagnosis.type).toBe('problem');
  if (diagnosis.result.type !== 'problem') {
    throw new Error(`Expected a 'problem' diagnosis, got '${diagnosis.type}'`);
  }
  return diagnosis.result;
}

describe('CloudFormationStackDiagnoser', () => {
  describe('diagnoseFromFresh', () => {
    test('returns no-problem for a stack in a good state with no failed change sets', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'CREATE_COMPLETE' });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result.result).toMatchObject({ type: 'no-problem' });
    });

    test('returns error-diagnosing when stack does not exist', async () => {
      const result = await makeDiagnoser().diagnoseFromFresh('NonExistent');

      expect(result.result).toMatchObject({
        type: 'error-diagnosing',
        message: expect.stringContaining('NonExistent'),
      });
    });

    test('returns error-diagnosing when stack is in progress', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'UPDATE_IN_PROGRESS' });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result.result).toMatchObject({
        type: 'error-diagnosing',
        message: expect.stringContaining('currently being updated'),
      });
    });

    test('diagnoses deployment failure from stack events', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'UPDATE_FAILED' });
      const stack = fakeCfn.accessStack('MyStack');

      stack.events.unshift({
        StackId: stack.id,
        StackName: 'MyStack',
        EventId: 'evt-1',
        LogicalResourceId: 'MyBucket',
        PhysicalResourceId: 'my-bucket-123',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'Access Denied',
        Timestamp: new Date(),
      });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result.result).toMatchObject({
        type: 'problem',
        detectedBy: { type: 'deployment' },
        problems: [expect.objectContaining({
          logicalId: 'MyBucket',
          message: 'Access Denied',
          resourceType: 'AWS::S3::Bucket',
        })],
      });
    });

    test('finds the failure on a rolled-back stack, across the rollback and create operations', async () => {
      // A rolled-back deployment spans two CloudFormation operations: the failed create
      // (operation A) and the rollback that follows (operation B). describeStackEvents returns
      // newest-first, so the rollback's (successful) DELETE events come first and the actual
      // CREATE_FAILED belongs to the older operation A. The poll range must include both.
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'ROLLBACK_COMPLETE' });
      const stack = fakeCfn.accessStack('MyStack');
      const opCreate = 'op-create-aaaa';
      const opRollback = 'op-rollback-bbbb';

      // Pushed oldest-first; unshift makes the final array newest-first.
      // Operation A (create): the real failure.
      stack.events.unshift({
        StackId: stack.id,
        StackName: 'MyStack',
        EventId: 'evt-create-failed',
        LogicalResourceId: 'MyResource',
        PhysicalResourceId: 'phys-1',
        ResourceType: 'Custom::MyThing',
        ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'Received response status [FAILED] from custom resource',
        OperationId: opCreate,
        Timestamp: new Date('2026-06-25T18:32:12Z'),
      });
      // Operation B (rollback): only successful deletes — no failure signal here.
      stack.events.unshift({
        StackId: stack.id,
        StackName: 'MyStack',
        EventId: 'evt-delete',
        LogicalResourceId: 'MyResource',
        PhysicalResourceId: 'phys-1',
        ResourceType: 'Custom::MyThing',
        ResourceStatus: 'DELETE_COMPLETE',
        OperationId: opRollback,
        Timestamp: new Date('2026-06-25T18:32:16Z'),
      });
      stack.events.unshift({
        StackId: stack.id,
        StackName: 'MyStack',
        EventId: 'evt-rollback-complete',
        LogicalResourceId: 'MyStack',
        PhysicalResourceId: stack.id,
        ResourceType: 'AWS::CloudFormation::Stack',
        ResourceStatus: 'ROLLBACK_COMPLETE',
        OperationId: opRollback,
        Timestamp: new Date('2026-06-25T18:32:31Z'),
      });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result.result).toMatchObject({
        type: 'problem',
        detectedBy: { type: 'deployment' },
        problems: [expect.objectContaining({
          logicalId: 'MyResource',
          message: 'Received response status [FAILED] from custom resource',
        })],
      });
    });

    test('diagnoses change set creation failure', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'CREATE_COMPLETE' });
      fakeCfn.createChangeSetSync({
        StackName: 'MyStack',
        ChangeSetName: 'my-cs',
        Status: 'FAILED',
        StatusReason: 'Some template error occurred',
      });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result.result).toMatchObject({
        type: 'problem',
        detectedBy: {
          type: 'change-set',
          changeSetName: 'my-cs',
          statusReason: 'Some template error occurred',
        },
      });
    });

    test('ignores change sets that failed because of no changes', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'CREATE_COMPLETE' });
      fakeCfn.createChangeSetSync({
        StackName: 'MyStack',
        ChangeSetName: 'my-cs',
        Status: 'FAILED',
        StatusReason: "The submitted information didn't contain changes.",
      });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result.result).toMatchObject({ type: 'no-problem' });
    });

    test('diagnoses auto-import failure', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'CREATE_COMPLETE' });
      fakeCfn.createChangeSetSync({
        StackName: 'MyStack',
        ChangeSetName: 'my-cs',
        Status: 'FAILED',
        StatusReason: "CloudFormation is attempting to import some resources because they already exist in your account. The resources must have the DeletionPolicy attribute set to 'Retain' or 'RetainExceptOnCreate' in the template for successful import. The affected resources are MyBucket ({BucketName=my-bucket})",
      });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');
      const problem = assertProblem(result);

      expect(result.result).toMatchObject({
        detectedBy: { type: 'change-set' },
        problems: [expect.objectContaining({
          logicalId: 'MyBucket',
          message: expect.stringContaining('DeletionPolicy'),
        })],
      });
      expect(problem.problems[0].message).toContain('RemovalPolicy.RETAIN');
    });

    test('diagnoses nested change set failure', async () => {
      fakeCfn.createStackSync({ StackName: 'ParentStack', StackStatus: 'CREATE_COMPLETE' });
      fakeCfn.createStackSync({ StackName: 'NestedStack', StackStatus: 'CREATE_COMPLETE' });
      fakeCfn.createChangeSetSync({
        StackName: 'NestedStack',
        ChangeSetName: 'nested-cs',
        Status: 'FAILED',
        StatusReason: 'Some nested error',
      });

      const nestedCsId = fakeCfn.accessStack('NestedStack').changeSets[0].id;

      fakeCfn.createChangeSetSync({
        StackName: 'ParentStack',
        ChangeSetName: 'parent-cs',
        Status: 'FAILED',
        StatusReason: `Nested change set ${nestedCsId} failed`,
        Changes: [{
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'NestedStackResource',
            ResourceType: 'AWS::CloudFormation::Stack',
            PhysicalResourceId: 'NestedStack',
            ChangeSetId: nestedCsId,
          },
        }],
      });

      const result = await makeDiagnoser().diagnoseFromFresh('ParentStack');

      expect(result.result).toMatchObject({
        type: 'problem',
        detectedBy: { type: 'change-set' },
        problems: [expect.anything()],
      });
      expect(fakeTracer.stackCalls.length + fakeTracer.resourceCalls.length).toBeGreaterThan(0);
    });

    test('diagnoses early validation failure', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'CREATE_COMPLETE' });
      fakeCfn.createChangeSetSync({
        StackName: 'MyStack',
        ChangeSetName: 'my-cs',
        Status: 'FAILED',
        StatusReason: 'AWS::EarlyValidation failed for some resources',
      });

      // Prime early validation errors on the change set
      fakeCfn.accessStack('MyStack').changeSets[0].earlyValidationErrors = [
        {
          logicalId: 'MyBucket',
          resourceType: 'AWS::S3::Bucket',
          validationStatusReason: 'Resource already exists',
          validationPath: '/Resources/MyBucket',
          validationName: 'NAME_CONFLICT_VALIDATION',
        },
      ];

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result.result).toMatchObject({
        type: 'problem',
        detectedBy: { type: 'early-validation' },
        problems: [expect.objectContaining({
          logicalId: 'MyBucket',
          message: expect.stringContaining('Resource already exists'),
        })],
      });
    });

    test('calls source tracer for each resource error', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'UPDATE_FAILED' });
      const stack = fakeCfn.accessStack('MyStack');

      stack.events.unshift({
        StackId: stack.id,
        StackName: 'MyStack',
        EventId: 'evt-1',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'Access Denied',
        Timestamp: new Date(),
      });

      fakeTracer.traceToReturn = { constructPath: 'MyStack/MyBucket/Resource' };

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');
      const problem = assertProblem(result);

      expect(fakeTracer.resourceCalls).toEqual([
        expect.objectContaining({ logicalId: 'MyBucket', nestedStackLogicalIds: [] }),
      ]);
      expect(problem.problems[0].sourceTrace).toEqual({ constructPath: 'MyStack/MyBucket/Resource' });
    });

    test('calls source tracer for non-specific change set errors (stack-level)', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'CREATE_COMPLETE' });
      fakeCfn.createChangeSetSync({
        StackName: 'MyStack',
        ChangeSetName: 'my-cs',
        Status: 'FAILED',
        StatusReason: 'Some generic error',
      });

      await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(fakeTracer.stackCalls).toHaveLength(1);
    });

    test('sets topLevelStackHierarchicalId on traced errors', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'UPDATE_FAILED' });
      const stack = fakeCfn.accessStack('MyStack');

      stack.events.unshift({
        StackId: stack.id,
        StackName: 'MyStack',
        EventId: 'evt-1',
        LogicalResourceId: 'MyBucket',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_FAILED',
        ResourceStatusReason: 'fail',
        Timestamp: new Date(),
      });

      const result = await makeDiagnoser('MyApp/MyStack').diagnoseFromFresh('MyStack');

      expect(result.result).toMatchObject({
        type: 'problem',
        problems: [expect.objectContaining({ topLevelStackHierarchicalId: 'MyApp/MyStack' })],
      });
    });
  });

  describe('diagnoseChangeSet', () => {
    test('returns no-problem for a non-failed change set', async () => {
      const result = await makeDiagnoser().diagnoseChangeSet({
        ChangeSetName: 'my-cs',
        StackName: 'MyStack',
        Status: ChangeSetStatus.CREATE_COMPLETE,
      });

      expect(result.result).toMatchObject({ type: 'no-problem' });
    });

    test('reports a change set that has not settled yet as not executable', async () => {
      const result = await makeDiagnoser().diagnoseChangeSet({
        ChangeSetName: 'my-cs',
        StackName: 'MyStack',
        Status: ChangeSetStatus.CREATE_IN_PROGRESS,
      }, { requireExecutable: true });

      expect(result.result).toMatchObject({
        type: 'problem',
        detectedBy: { type: 'change-set-not-ready', changeSetStatus: 'CREATE_IN_PROGRESS' },
      });
    });

    test('diagnoses a failed change set', async () => {
      const result = await makeDiagnoser().diagnoseChangeSet({
        ChangeSetId: 'arn:aws:cloudformation:us-east-1:123456789012:changeSet/my-cs/123',
        ChangeSetName: 'my-cs',
        StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/123',
        StackName: 'MyStack',
        Status: ChangeSetStatus.FAILED,
        StatusReason: 'Template error: something went wrong',
      });

      expect(result.result).toMatchObject({
        type: 'problem',
        detectedBy: { type: 'change-set' },
      });
    });

    test('multiple problems from DescribeEvents are all returned', async () => {
      fakeCfn.createStackSync({
        StackName: 'MyStack',
      });
      fakeCfn.createChangeSetSync({
        StackName: 'MyStack',
        ChangeSetName: 'my-cs',
        Status: ChangeSetStatus.FAILED,
        StatusReason: 'AWS::EarlyValidation failed',
      });
      fakeCfn.accessChangeSet('MyStack', 'my-cs').changeSetFailureEvents = [
        {
          EventId: '4a71cc61-289f-40dc-90ab-933a93bbbf63',
          StackId: 'arn:aws:cloudformation:eu-west-1:111111111111:stack/MyStack/9bca3980-37f6-11f1-9b72-0230792d700d',
          OperationId: '345a3ffd-e545-437c-b32f-f71647308416',
          OperationType: 'CREATE_CHANGESET',
          EventType: 'VALIDATION_ERROR',
          LogicalResourceId: 'BadPolicy',
          PhysicalResourceId: '',
          ResourceType: 'AWS::IAM::Policy',
          Timestamp: new Date(),
          ValidationFailureMode: 'FAIL',
          ValidationName: 'PROPERTY_VALIDATION',
          ValidationStatus: 'FAILED',
          ValidationStatusReason: 'Required property [PolicyDocument] not found',
          ValidationPath: '/Resources/BadPolicy/Properties',
        },
        {
          EventId: '3f399b2a-6fed-4652-a682-9a8a30816f02',
          StackId: 'arn:aws:cloudformation:eu-west-1:111111111111:stack/MyStack/9bca3980-37f6-11f1-9b72-0230792d700d',
          OperationId: '345a3ffd-e545-437c-b32f-f71647308416',
          OperationType: 'CREATE_CHANGESET',
          EventType: 'VALIDATION_ERROR',
          LogicalResourceId: 'BadPolicy',
          PhysicalResourceId: '',
          ResourceType: 'AWS::IAM::Policy',
          Timestamp: new Date(),
          ValidationFailureMode: 'FAIL',
          ValidationName: 'PROPERTY_VALIDATION',
          ValidationStatus: 'FAILED',
          ValidationStatusReason: 'Required property [PolicyName] not found',
          ValidationPath: '/Resources/BadPolicy/Properties',
        },
      ];

      const result = await makeDiagnoser().diagnoseChangeSet({
        ChangeSetName: 'my-cs',
        StackName: 'MyStack',
        Status: ChangeSetStatus.FAILED,
        StatusReason: 'AWS::EarlyValidation failed',
      });

      expect(result.result).toMatchObject({
        type: 'problem',
        detectedBy: {
          type: 'early-validation',
          changeSetName: 'my-cs',
        },
        problems: [
          {
            errorCode: 'PROPERTY_VALIDATION_VALIDATION_ERROR',
            logicalId: 'BadPolicy',
            message: 'Required property [PolicyDocument] not found (at /Resources/BadPolicy/Properties)',
            parentStackLogicalIds: [],
            physicalId: undefined,
            resourceType: 'AWS::IAM::Policy',
            sourceTrace: undefined,
            stackArn: '',
            topLevelStackHierarchicalId: 'TestStack',
          },
          {
            errorCode: 'PROPERTY_VALIDATION_VALIDATION_ERROR',
            logicalId: 'BadPolicy',
            message: 'Required property [PolicyName] not found (at /Resources/BadPolicy/Properties)',
            parentStackLogicalIds: [],
            physicalId: undefined,
            resourceType: 'AWS::IAM::Policy',
            sourceTrace: undefined,
            stackArn: '',
            topLevelStackHierarchicalId: 'TestStack',
          },
        ],
      } satisfies StackDiagnosis);
    });
  });

  describe('change set hook failures', () => {
    const CS_ARN = 'arn:aws:cloudformation:us-east-1:123456789012:changeSet/my-cs/00000000-0000-0000-0000-000000000000';
    const STACK_ARN = 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/123';
    const HOOK_RESULT_ID = '00000000-0000-0000-0000-000000000000';
    const LAMBDA_HOOK_REASON = '22dict Ingress May Not Allow All IPs to Non-HTTP(s) or Syslog Ports, ';

    function failedChangeSet() {
      return {
        ChangeSetId: CS_ARN,
        ChangeSetName: 'my-cs',
        StackId: STACK_ARN,
        StackName: 'MyStack',
        Status: ChangeSetStatus.FAILED,
        StatusReason: 'Change set creation failed. The following hook(s) failed: [Example::CFNHook::Full]',
      };
    }

    function lambdaHookResultSummary() {
      return {
        HookResultId: HOOK_RESULT_ID,
        InvocationPoint: 'PRE_PROVISION' as const,
        FailureMode: 'FAIL' as const,
        TypeName: 'Example::CFNHook::Full',
        Status: 'HOOK_COMPLETE_FAILED' as const,
        HookStatusReason: LAMBDA_HOOK_REASON,
        TargetType: 'CHANGE_SET' as const,
        TargetId: CS_ARN,
      };
    }

    test('surfaces the detailed HookStatusReason of a failed Lambda hook (no annotations)', async () => {
      mockCloudFormationClient.on(ListHookResultsCommand).resolves({
        HookResults: [lambdaHookResultSummary()],
      });
      mockCloudFormationClient.on(GetHookResultCommand).resolves({
        HookResultId: HOOK_RESULT_ID,
        InvocationPoint: 'PRE_PROVISION',
        FailureMode: 'FAIL',
        TypeName: 'Example::CFNHook::Full',
        OriginalTypeName: 'AWS::Hooks::LambdaHook',
        Status: 'HOOK_COMPLETE_FAILED',
        HookStatusReason: LAMBDA_HOOK_REASON,
        Target: {
          TargetType: 'CHANGE_SET',
          TargetTypeName: 'CHANGE_SET',
          TargetId: CS_ARN,
          Action: 'CREATE',
        },
        Annotations: [],
      } as any);

      const result = await makeDiagnoser().diagnoseChangeSet(failedChangeSet());

      expect(mockCloudFormationClient).toHaveReceivedCommandWith(ListHookResultsCommand, {
        TargetType: 'CHANGE_SET',
        TargetId: CS_ARN,
      });
      const problem = assertProblem(result);
      expect(problem.problems).toEqual([expect.objectContaining({
        errorCode: 'HookFailed',
        message: `Hook 'Example::CFNHook::Full' failed: ${LAMBDA_HOOK_REASON.trim()}`,
        stackArn: STACK_ARN,
      })]);
    });

    test('formats annotations of a failed Guard hook', async () => {
      mockCloudFormationClient.on(ListHookResultsCommand).resolves({
        HookResults: [{ ...lambdaHookResultSummary(), TypeName: 'Private::Guard::TestHook' }],
      });
      mockCloudFormationClient.on(GetHookResultCommand).resolves({
        HookResultId: HOOK_RESULT_ID,
        Status: 'HOOK_COMPLETE_FAILED',
        Annotations: [{
          AnnotationName: 'AWS_S3_Bucket_AccessControl',
          Status: 'FAILED',
          StatusMessage: 'Check was not compliant.',
          RemediationMessage: 'AccessControl is deprecated',
        }],
      } as any);

      const result = await makeDiagnoser().diagnoseChangeSet(failedChangeSet());

      const problem = assertProblem(result);
      expect(problem.problems[0].message).toContain("Hook 'Private::Guard::TestHook' failed");
      expect(problem.problems[0].message).toContain('NonCompliant Rules:');
      expect(problem.problems[0].message).toContain('[AWS_S3_Bucket_AccessControl]');
      expect(problem.problems[0].message).toContain('Remediation: AccessControl is deprecated');
    });

    test('falls back to the summary HookStatusReason when GetHookResult fails', async () => {
      mockCloudFormationClient.on(ListHookResultsCommand).resolves({
        HookResults: [lambdaHookResultSummary()],
      });
      mockCloudFormationClient.on(GetHookResultCommand).rejects(new Error('not authorized'));

      const result = await makeDiagnoser().diagnoseChangeSet(failedChangeSet());

      const problem = assertProblem(result);
      expect(problem.problems).toEqual([expect.objectContaining({
        errorCode: 'HookFailed',
        message: `Hook 'Example::CFNHook::Full' failed: ${LAMBDA_HOOK_REASON.trim()}`,
      })]);
    });

    test('ignores failed hooks with failure mode WARN', async () => {
      mockCloudFormationClient.on(ListHookResultsCommand).resolves({
        HookResults: [{ ...lambdaHookResultSummary(), FailureMode: 'WARN' }],
      });

      const result = await makeDiagnoser().diagnoseChangeSet(failedChangeSet());

      // Falls through to the non-specific change set error
      const problem = assertProblem(result);
      expect(problem.problems).toEqual([expect.objectContaining({
        message: expect.stringContaining('The following hook(s) failed'),
      })]);
      expect(problem.problems[0].errorCode).not.toEqual('HookFailed');
    });

    test('reports the non-specific change set error when ListHookResults fails', async () => {
      mockCloudFormationClient.on(ListHookResultsCommand).rejects(new Error('not authorized'));

      const result = await makeDiagnoser().diagnoseChangeSet(failedChangeSet());

      const problem = assertProblem(result);
      expect(problem.problems).toEqual([expect.objectContaining({
        message: expect.stringContaining('The following hook(s) failed'),
      })]);
    });

    test('errors from DescribeEvents take precedence over hook results', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack' });
      fakeCfn.createChangeSetSync({
        StackName: 'MyStack',
        ChangeSetName: 'my-cs',
        Status: 'FAILED',
        StatusReason: 'AWS::EarlyValidation failed',
      });
      fakeCfn.accessChangeSet('MyStack', 'my-cs').changeSetFailureEvents = [{
        EventId: 'evt-1',
        StackId: STACK_ARN,
        OperationType: 'CREATE_CHANGESET',
        EventType: 'VALIDATION_ERROR',
        LogicalResourceId: 'BadPolicy',
        ResourceType: 'AWS::IAM::Policy',
        Timestamp: new Date(),
        ValidationFailureMode: 'FAIL',
        ValidationName: 'PROPERTY_VALIDATION',
        ValidationStatus: 'FAILED',
        ValidationStatusReason: 'Required property [PolicyDocument] not found',
        ValidationPath: '/Resources/BadPolicy/Properties',
      }];
      mockCloudFormationClient.on(ListHookResultsCommand).resolves({
        HookResults: [lambdaHookResultSummary()],
      });

      const result = await makeDiagnoser().diagnoseChangeSet({
        ChangeSetName: 'my-cs',
        StackName: 'MyStack',
        Status: ChangeSetStatus.FAILED,
        StatusReason: 'AWS::EarlyValidation failed',
      });

      const problem = assertProblem(result);
      expect(problem.problems).toEqual([expect.objectContaining({ logicalId: 'BadPolicy' })]);
      expect(mockCloudFormationClient).not.toHaveReceivedCommand(ListHookResultsCommand);
    });
  });

  describe('diagnoseFromErrorCollection', () => {
    test('returns no-problem for empty errors', async () => {
      const errors = new ResourceErrors();

      const result = await makeDiagnoser().diagnoseFromErrorCollection(errors, {
        StackName: 'MyStack',
        StackStatus: 'UPDATE_FAILED',
        CreationTime: new Date(),
      });

      expect(result.result).toMatchObject({ type: 'no-problem' });
    });

    test('returns problem with traced errors', async () => {
      const errors = new ResourceErrors();
      errors.update({
        event: {
          EventId: 'evt-1',
          StackId: 'arn:stack',
          StackName: 'MyStack',
          LogicalResourceId: 'MyFunc',
          ResourceType: 'AWS::Lambda::Function',
          ResourceStatus: 'CREATE_FAILED',
          ResourceStatusReason: 'Handler error',
          Timestamp: new Date(),
        },
        parentStackLogicalIds: [],
        isRootStackEvent: false,
      });

      fakeTracer.traceToReturn = { constructPath: 'MyStack/MyFunc/Resource' };

      const result = await makeDiagnoser().diagnoseFromErrorCollection(errors, {
        StackName: 'MyStack',
        StackStatus: 'UPDATE_FAILED',
        StackStatusReason: 'Resource update failed',
        CreationTime: new Date(),
      });

      expect(result.result).toMatchObject({
        type: 'problem',
        problems: [expect.objectContaining({
          sourceTrace: { constructPath: 'MyStack/MyFunc/Resource' },
        })],
      });
    });

    test('enriches a resource error with fetched hook failure details', async () => {
      const errors = new ResourceErrors();
      errors.update(
        {
          event: {
            EventId: 'evt-hook',
            StackId: 'arn:stack',
            StackName: 'MyStack',
            LogicalResourceId: 'MyBucket',
            ResourceType: 'AWS::S3::Bucket',
            ResourceStatus: 'UPDATE_IN_PROGRESS',
            HookStatus: 'HOOK_COMPLETE_FAILED',
            HookType: 'Private::Guard::TestHook',
            HookInvocationId: 'hook-invocation-1',
            HookStatusReason: 'terse reason',
            Timestamp: new Date(),
          },
          parentStackLogicalIds: [],
          isRootStackEvent: false,
        },
        {
          event: {
            EventId: 'evt-fail',
            StackId: 'arn:stack',
            StackName: 'MyStack',
            LogicalResourceId: 'MyBucket',
            ResourceType: 'AWS::S3::Bucket',
            ResourceStatus: 'CREATE_FAILED',
            ResourceStatusReason: 'The following hook(s) failed: [Private::Guard::TestHook]',
            Timestamp: new Date(),
          },
          parentStackLogicalIds: [],
          isRootStackEvent: false,
        },
      );

      mockCloudFormationClient.on(GetHookResultCommand).resolves({
        HookResultId: 'hook-invocation-1',
        Status: 'HOOK_COMPLETE_FAILED',
        Annotations: [{
          AnnotationName: 'AWS_S3_Bucket_AccessControl',
          Status: 'FAILED',
          StatusMessage: 'Check was not compliant.',
          RemediationMessage: 'AccessControl is deprecated',
        }],
      } as any);

      const result = await makeHookFetchingDiagnoser().diagnoseFromErrorCollection(errors, {
        StackName: 'MyStack',
        StackStatus: 'UPDATE_FAILED',
        CreationTime: new Date(),
      });

      expect(mockCloudFormationClient).toHaveReceivedCommandWith(GetHookResultCommand, {
        HookResultId: 'hook-invocation-1',
      });
      assertProblem(result);
      const context = result.problems[0].additionalContext ?? [];
      expect(context).toEqual([
        expect.objectContaining({
          source: 'CloudFormation Hook (Private::Guard::TestHook)',
          messages: expect.arrayContaining([
            expect.stringContaining("Hook 'Private::Guard::TestHook' failed"),
            '[AWS_S3_Bucket_AccessControl]',
          ]),
        }),
      ]);
    });

    test('does not fetch hook details when fetchHookFailureDetails is off (deploy)', async () => {
      const errors = new ResourceErrors();
      errors.update(
        {
          event: {
            EventId: 'evt-hook',
            StackId: 'arn:stack',
            StackName: 'MyStack',
            LogicalResourceId: 'MyBucket',
            ResourceType: 'AWS::S3::Bucket',
            ResourceStatus: 'UPDATE_IN_PROGRESS',
            HookStatus: 'HOOK_COMPLETE_FAILED',
            HookType: 'Private::Guard::TestHook',
            HookInvocationId: 'hook-invocation-1',
            HookStatusReason: 'terse reason',
            Timestamp: new Date(),
          },
          parentStackLogicalIds: [],
          isRootStackEvent: false,
        },
        {
          event: {
            EventId: 'evt-fail',
            StackId: 'arn:stack',
            StackName: 'MyStack',
            LogicalResourceId: 'MyBucket',
            ResourceType: 'AWS::S3::Bucket',
            ResourceStatus: 'CREATE_FAILED',
            ResourceStatusReason: 'The following hook(s) failed: [Private::Guard::TestHook]',
            Timestamp: new Date(),
          },
          parentStackLogicalIds: [],
          isRootStackEvent: false,
        },
      );

      const result = await makeDiagnoser().diagnoseFromErrorCollection(errors, {
        StackName: 'MyStack',
        StackStatus: 'UPDATE_FAILED',
        CreationTime: new Date(),
      });

      expect(mockCloudFormationClient).not.toHaveReceivedCommand(GetHookResultCommand);
      assertProblem(result);
      expect(result.problems[0].additionalContext).toBeUndefined();
    });

    test('falls back to the hook status reason when GetHookResult returns no details', async () => {
      const errors = new ResourceErrors();
      errors.update(
        {
          event: {
            EventId: 'evt-hook',
            StackId: 'arn:stack',
            StackName: 'MyStack',
            LogicalResourceId: 'MyBucket',
            ResourceType: 'AWS::S3::Bucket',
            ResourceStatus: 'UPDATE_IN_PROGRESS',
            HookStatus: 'HOOK_COMPLETE_FAILED',
            HookType: 'Private::Guard::TestHook',
            HookInvocationId: 'hook-invocation-1',
            HookStatusReason: 'the terse fallback reason',
            Timestamp: new Date(),
          },
          parentStackLogicalIds: [],
          isRootStackEvent: false,
        },
        {
          event: {
            EventId: 'evt-fail',
            StackId: 'arn:stack',
            StackName: 'MyStack',
            LogicalResourceId: 'MyBucket',
            ResourceType: 'AWS::S3::Bucket',
            ResourceStatus: 'CREATE_FAILED',
            ResourceStatusReason: 'The following hook(s) failed: [Private::Guard::TestHook]',
            Timestamp: new Date(),
          },
          parentStackLogicalIds: [],
          isRootStackEvent: false,
        },
      );

      mockCloudFormationClient.on(GetHookResultCommand).rejects(new Error('not authorized'));

      const result = await makeHookFetchingDiagnoser().diagnoseFromErrorCollection(errors, {
        StackName: 'MyStack',
        StackStatus: 'UPDATE_FAILED',
        CreationTime: new Date(),
      });

      assertProblem(result);
      const context = result.problems[0].additionalContext ?? [];
      expect(context).toEqual([
        expect.objectContaining({
          messages: ["Hook 'Private::Guard::TestHook' failed: the terse fallback reason"],
        }),
      ]);
    });
  });

  describe('CloudTrail investigation wiring', () => {
    const STACK_ARN = 'arn:aws:cloudformation:us-east-1:123456789012:stack/MyStack/abc';
    const FAILURE_TIME = new Date('2026-06-19T12:00:00.000Z');

    function makeErrors(): ResourceErrors {
      const errors = new ResourceErrors();
      errors.update({
        event: {
          EventId: 'evt-1',
          StackId: STACK_ARN,
          StackName: 'MyStack',
          LogicalResourceId: 'CrHandler',
          PhysicalResourceId: 'MyStack-CrHandler-abc123def456',
          ResourceType: 'AWS::Lambda::Function',
          ResourceStatus: 'CREATE_FAILED',
          ResourceStatusReason: 'Handler error',
          Timestamp: FAILURE_TIME,
        },
        parentStackLogicalIds: [],
        isRootStackEvent: false,
      });
      return errors;
    }

    function makeExploringDiagnoser() {
      return new CloudFormationStackDiagnoser({
        sdk,
        sourceTracer: fakeTracer,
        ioHelper: ioHost.asHelper('diagnose'),
        topLevelStackHierarchicalId: 'MyStack',
        additionalExplorationSdkProvider: async () => sdk,
      });
    }

    test('attaches correlated CloudTrail errors to the failed resource on any path', async () => {
      // No cloudTrailEnabled gating anymore: the investigation runs for deploy-originating
      // error collections too (a recent failure just yields fewer delivered events).
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'UPDATE_FAILED', StackId: STACK_ARN });
      mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
        StackResources: [{
          LogicalResourceId: 'CrHandler',
          ResourceType: 'AWS::Lambda::Function',
          PhysicalResourceId: 'MyStack-CrHandler-abc123def456',
          ResourceStatus: ResourceStatus.CREATE_FAILED,
          Timestamp: FAILURE_TIME,
        }],
      });
      mockCloudTrailClient.on(LookupEventsCommand).resolves({
        Events: [{
          CloudTrailEvent: JSON.stringify({
            eventTime: '2026-06-19T11:59:00Z',
            eventSource: 's3.amazonaws.com',
            eventName: 'CreateBucket',
            errorCode: 'AccessDenied',
            errorMessage: 'not authorized to perform: s3:CreateBucket',
            userIdentity: { arn: 'arn:aws:sts::123456789012:assumed-role/some-role/MyStack-CrHandler-abc123def456' },
          }),
        }],
      });

      const result = await makeExploringDiagnoser().diagnoseFromErrorCollection(makeErrors(), {
        StackName: 'MyStack',
        StackStatus: 'UPDATE_FAILED',
        CreationTime: new Date(),
      });

      const problem = assertProblem(result);
      const context = problem.problems[0].additionalContext?.find((c) => c.source === 'CloudTrail Errors');
      expect(context).toBeDefined();
      expect(context!.messages[0]).toMatch(/AccessDenied on s3\.amazonaws\.com:CreateBucket/);
    });

    test('does not run the investigation without an exploration SDK', async () => {
      const result = await makeDiagnoser().diagnoseFromErrorCollection(makeErrors(), {
        StackName: 'MyStack',
        StackStatus: 'UPDATE_FAILED',
        CreationTime: new Date(),
      });

      assertProblem(result);
      expect(mockCloudTrailClient).not.toHaveReceivedCommand(LookupEventsCommand);
    });
  });
});
