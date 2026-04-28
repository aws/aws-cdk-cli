import {
  ChangeSetStatus,
} from '@aws-sdk/client-cloudformation';
import type { StackDiagnosis } from '../../../lib/actions/diagnose';
import { CloudFormationStackDiagnoser } from '../../../lib/api/diagnosing/stack-diagnoser';
import type { ISourceTracer } from '../../../lib/api/source-tracing/private/source-tracing';
import type { SourceTrace } from '../../../lib/api/source-tracing/types';
import { ResourceErrors } from '../../../lib/api/stack-events/resource-errors';
import { FakeCloudFormation } from '../../_helpers/fake-aws/fake-cloudformation';
import { mockCloudFormationClient, MockSdk, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
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
 * Type guard to narrow a StackDiagnosis to the 'problem' variant
 */
function assertProblem(result: StackDiagnosis): asserts result is Extract<StackDiagnosis, { type: 'problem' }> {
  expect(result.type).toBe('problem');
}

describe('CloudFormationStackDiagnoser', () => {
  describe('diagnoseFromFresh', () => {
    test('returns no-problem for a stack in a good state with no failed change sets', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'CREATE_COMPLETE' });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result).toMatchObject({ type: 'no-problem' });
    });

    test('returns error-diagnosing when stack does not exist', async () => {
      const result = await makeDiagnoser().diagnoseFromFresh('NonExistent');

      expect(result).toMatchObject({
        type: 'error-diagnosing',
        message: expect.stringContaining('NonExistent'),
      });
    });

    test('returns error-diagnosing when stack is in progress', async () => {
      fakeCfn.createStackSync({ StackName: 'MyStack', StackStatus: 'UPDATE_IN_PROGRESS' });

      const result = await makeDiagnoser().diagnoseFromFresh('MyStack');

      expect(result).toMatchObject({
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

      expect(result).toMatchObject({
        type: 'problem',
        detectedBy: { type: 'deployment' },
        problems: [expect.objectContaining({
          logicalId: 'MyBucket',
          message: 'Access Denied',
          resourceType: 'AWS::S3::Bucket',
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

      expect(result).toMatchObject({
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

      expect(result).toMatchObject({ type: 'no-problem' });
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
      assertProblem(result);

      expect(result).toMatchObject({
        detectedBy: { type: 'change-set' },
        problems: [expect.objectContaining({
          logicalId: 'MyBucket',
          message: expect.stringContaining('DeletionPolicy'),
        })],
      });
      expect(result.problems[0].message).toContain('RemovalPolicy.RETAIN');
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

      expect(result).toMatchObject({
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

      expect(result).toMatchObject({
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
      assertProblem(result);

      expect(fakeTracer.resourceCalls).toEqual([
        expect.objectContaining({ logicalId: 'MyBucket', nestedStackLogicalIds: [] }),
      ]);
      expect(result.problems[0].sourceTrace).toEqual({ constructPath: 'MyStack/MyBucket/Resource' });
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

      expect(result).toMatchObject({
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

      expect(result).toMatchObject({ type: 'no-problem' });
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

      expect(result).toMatchObject({
        type: 'problem',
        detectedBy: { type: 'change-set' },
      });
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

      expect(result).toMatchObject({ type: 'no-problem' });
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

      expect(result).toMatchObject({
        type: 'problem',
        problems: [expect.objectContaining({
          sourceTrace: { constructPath: 'MyStack/MyFunc/Resource' },
        })],
      });
    });
  });
});
