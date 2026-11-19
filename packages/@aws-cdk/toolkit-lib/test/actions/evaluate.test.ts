import * as fs from 'fs';
import * as path from 'path';
import { GetResourceCommand } from '@aws-sdk/client-cloudcontrol';
import { DescribeStacksCommand, GetTemplateCommand, ListStackResourcesCommand, StackStatus } from '@aws-sdk/client-cloudformation';
import { StackSelectionStrategy } from '../../lib/api/cloud-assembly';
import { Toolkit } from '../../lib/toolkit';
import { cdkOutFixture, TestIoHost } from '../_helpers';
import {
  mockCloudControlClient,
  mockCloudFormationClient,
  mockSdkProvider,
  restoreSdkMocksToDefault,
  setDefaultSTSMocks,
} from '../_helpers/mock-sdk';

const FIXTURE = 'stack-with-references';
const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_fixtures', FIXTURE, 'cdk.out', 'Stack1.template.json'), 'utf-8'));
const nestedTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_fixtures', FIXTURE, 'cdk.out', 'Stack1Nested36ADE314.nested.template.json'), 'utf-8'));
const STACK_ID = 'arn:aws:cloudformation:us-east-1:123456789012:stack/Stack1/f1b0a1b0-0000-0000-0000-000000000000';
const NESTED_LOGICAL_ID = 'NestedNestedStackNestedNestedStackResourceDEFDAA4D';
const NESTED_STACK_NAME = 'Stack1-NestedNestedStack-ABC123';
const NESTED_STACK_ID = `arn:aws:cloudformation:us-east-1:123456789012:stack/${NESTED_STACK_NAME}/f1b0a1b0-0000-0000-0000-000000000001`;

let ioHost: TestIoHost;
let toolkit: Toolkit;

beforeEach(() => {
  jest.restoreAllMocks();
  restoreSdkMocksToDefault();
  setDefaultSTSMocks();
  mockSdkProvider();
  ioHost = new TestIoHost('info', true);
  toolkit = new Toolkit({ ioHost, unstableFeatures: ['evaluate'] });
});

function givenDeployedStack() {
  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{
      StackName: 'Stack1',
      StackId: STACK_ID,
      StackStatus: StackStatus.CREATE_COMPLETE,
      CreationTime: new Date(),
      Parameters: [{ ParameterKey: 'BootstrapVersion', ParameterValue: '/cdk-bootstrap/hnb659fds/version', ResolvedValue: '30' }],
    }],
  });
  mockCloudFormationClient.on(DescribeStacksCommand, { StackName: NESTED_STACK_NAME }).resolves({
    Stacks: [{ StackName: NESTED_STACK_NAME, StackId: NESTED_STACK_ID, StackStatus: StackStatus.CREATE_COMPLETE, CreationTime: new Date() }],
  });
  mockCloudFormationClient.on(GetTemplateCommand).resolves({ TemplateBody: JSON.stringify(template) });
  mockCloudFormationClient.on(GetTemplateCommand, { StackName: NESTED_STACK_NAME }).resolves({ TemplateBody: JSON.stringify(nestedTemplate) });
  mockCloudFormationClient.on(ListStackResourcesCommand, { StackName: NESTED_STACK_NAME }).resolves({
    StackResourceSummaries: [{
      LogicalResourceId: 'NestedBucketName7CD077DC',
      PhysicalResourceId: 'CFN-NestedBucketName7CD077DC-def',
      ResourceType: 'AWS::SSM::Parameter',
      ResourceStatus: 'CREATE_COMPLETE',
      LastUpdatedTimestamp: new Date(),
    }],
  });
  mockCloudFormationClient.on(ListStackResourcesCommand, { StackName: 'Stack1' }).resolves({
    StackResourceSummaries: [
      {
        LogicalResourceId: NESTED_LOGICAL_ID,
        PhysicalResourceId: NESTED_STACK_ID,
        ResourceType: 'AWS::CloudFormation::Stack',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      },
      {
        LogicalResourceId: 'MyBucketF68F3FF0',
        PhysicalResourceId: 'stack1-mybucket-1a2b3c',
        ResourceType: 'AWS::S3::Bucket',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      },
      {
        LogicalResourceId: 'BucketName742CD8B0',
        PhysicalResourceId: 'CFN-BucketName742CD8B0-abc',
        ResourceType: 'AWS::SSM::Parameter',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      },
    ],
  });
}

describe('evaluate', () => {
  test('requires the evaluate unstable feature', async () => {
    const stableToolkit = new Toolkit({ ioHost });
    const cx = await cdkOutFixture(stableToolkit, FIXTURE);

    await expect(stableToolkit.evaluate(cx)).rejects.toThrow(/Unstable feature 'evaluate' is not enabled/);
  });

  test('replaces references, attributes and pseudo parameters with their deployed values', async () => {
    // GIVEN
    givenDeployedStack();
    mockCloudControlClient.on(GetResourceCommand).rejects(Object.assign(new Error('Resource not found'), { name: 'ResourceNotFoundException' }));

    // WHEN
    const cx = await cdkOutFixture(toolkit, FIXTURE);
    const result = await toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    expect(result.stacks).toHaveLength(1);
    const stack = result.stacks[0];
    expect(stack.stackName).toEqual('Stack1');
    expect(stack.template.Resources.BucketName742CD8B0.Properties.Value).toEqual('stack1-mybucket-1a2b3c');
    expect(stack.template.Outputs.BucketArn.Value).toEqual('arn:aws:s3:::stack1-mybucket-1a2b3c');
    expect(stack.template.Outputs.Name.Value).toEqual('Stack1');
    expect(stack.template.Outputs.Joined.Value).toEqual('stack1-mybucket-1a2b3c-us-east-1');

    expect(result.notDeployed).toEqual([]);
    expect(stack.stackId).toEqual(STACK_ID);
    expect(stack.physicalResourceIds).toEqual(expect.objectContaining({
      MyBucketF68F3FF0: 'stack1-mybucket-1a2b3c',
      BucketName742CD8B0: 'CFN-BucketName742CD8B0-abc',
    }));

    // the attribute that needs a Cloud Control lookup is kept and reported
    expect(stack.template.Outputs.BucketDomain.Value).toEqual({ 'Fn::GetAtt': ['MyBucketF68F3FF0', 'RegionalDomainName'] });
    expect(stack.unresolved).toEqual([expect.objectContaining({
      path: 'Outputs.BucketDomain.Value',
      intrinsic: 'Fn::GetAtt',
    })]);
  });

  test('looks up attributes through Cloud Control, and leaves the other template sections as they are', async () => {
    // GIVEN
    givenDeployedStack();
    mockCloudControlClient.on(GetResourceCommand).resolves({
      ResourceDescription: { Properties: JSON.stringify({ RegionalDomainName: 'stack1-mybucket-1a2b3c.s3.us-east-1.amazonaws.com' }) },
    });

    // WHEN
    const cx = await cdkOutFixture(toolkit, FIXTURE);
    const result = await toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    const stack = result.stacks[0];
    expect(stack.unresolved).toEqual([]);
    expect(stack.template.Outputs.BucketDomain.Value).toEqual('stack1-mybucket-1a2b3c.s3.us-east-1.amazonaws.com');
    expect(stack.template.Rules.CheckBootstrapVersion).toEqual(template.Rules.CheckBootstrapVersion);
  });

  test('evaluates nested stacks with the parameter values their parent passes', async () => {
    // GIVEN
    givenDeployedStack();
    mockCloudControlClient.on(GetResourceCommand).rejects(Object.assign(new Error('Resource not found'), { name: 'ResourceNotFoundException' }));

    // WHEN
    const cx = await cdkOutFixture(toolkit, FIXTURE);
    const result = await toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    const nested = result.stacks[0].nestedStacks?.[NESTED_LOGICAL_ID];
    expect(nested).toEqual(expect.objectContaining({
      stackName: NESTED_STACK_NAME,
      hierarchicalId: `Stack1/${NESTED_LOGICAL_ID}`,
      stackId: NESTED_STACK_ID,
      physicalResourceIds: { NestedBucketName7CD077DC: 'CFN-NestedBucketName7CD077DC-def' },
      unresolved: [],
    }));
    expect(nested?.template.Resources.NestedBucketName7CD077DC.Properties.Value).toEqual('stack1-mybucket-1a2b3c');
  });

  test('reports expressions in nested stacks that use a parameter value the parent could not evaluate', async () => {
    // GIVEN: the bucket is missing from the parent's resources, so its Ref can't be evaluated
    givenDeployedStack();
    mockCloudFormationClient.on(ListStackResourcesCommand, { StackName: 'Stack1' }).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: NESTED_LOGICAL_ID,
        PhysicalResourceId: NESTED_STACK_ID,
        ResourceType: 'AWS::CloudFormation::Stack',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    mockCloudControlClient.on(GetResourceCommand).rejects(Object.assign(new Error('Resource not found'), { name: 'ResourceNotFoundException' }));

    // WHEN
    const cx = await cdkOutFixture(toolkit, FIXTURE);
    const result = await toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    const nested = result.stacks[0].nestedStacks?.[NESTED_LOGICAL_ID];
    expect(nested?.template.Resources.NestedBucketName7CD077DC.Properties.Value).toEqual({ Ref: 'referencetoStack1MyBucket3E4D6F6CRef' });
    expect(nested?.unresolved).toEqual([{
      path: 'Resources.NestedBucketName7CD077DC.Properties.Value',
      intrinsic: 'Ref',
      reason: "references parameter 'referencetoStack1MyBucket3E4D6F6CRef': the value passed by stack 'Stack1' could not be evaluated",
    }]);
  });

  test('fails, rather than reporting expressions as unresolved, when AWS calls fail', async () => {
    // GIVEN
    givenDeployedStack();
    mockCloudControlClient.on(GetResourceCommand).rejects(Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }));

    // WHEN
    const cx = await cdkOutFixture(toolkit, FIXTURE);

    // THEN
    await expect(toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } }))
      .rejects.toThrow(/Could not find 'RegionalDomainName' attribute/);
  });

  test('skips stacks that are not deployed, and lists them', async () => {
    // GIVEN
    mockCloudFormationClient.on(DescribeStacksCommand).rejects(Object.assign(new Error('Stack with id Stack1 does not exist'), { name: 'ValidationError' }));

    // WHEN
    const cx = await cdkOutFixture(toolkit, FIXTURE);
    const result = await toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    expect(result).toEqual({ stacks: [], notDeployed: ['Stack1'] });
    ioHost.expectMessage({ level: 'warn', containing: "Stack 'Stack1' is not deployed in aws://123456789012/us-east-1, skipping it" });
  });

  test.each(['REVIEW_IN_PROGRESS', 'ROLLBACK_IN_PROGRESS', 'ROLLBACK_COMPLETE', 'DELETE_IN_PROGRESS', 'CREATE_FAILED'])(
    'skips a stack that is %s, and lists it as not deployed', async (status) => {
      // GIVEN
      givenDeployedStack();
      mockCloudFormationClient.on(DescribeStacksCommand, { StackName: 'Stack1' }).resolves({
        Stacks: [{ StackName: 'Stack1', StackId: STACK_ID, StackStatus: status as StackStatus, CreationTime: new Date() }],
      });

      // WHEN
      const cx = await cdkOutFixture(toolkit, FIXTURE);
      const result = await toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

      // THEN
      expect(result).toEqual({ stacks: [], notDeployed: ['Stack1'] });
      ioHost.expectMessage({ level: 'warn', containing: `Stack 'Stack1' is ${status} in aws://123456789012/us-east-1, skipping it` });
    });

  test.each([true, 'True'])('treats a parameter that is NoEcho (%p) only in the deployed template as unavailable', async (noEcho) => {
    // GIVEN: DescribeStacks masks the value, and the deployed template says NoEcho
    givenDeployedStack();
    mockCloudFormationClient.on(DescribeStacksCommand, { StackName: 'Stack1' }).resolves({
      Stacks: [{
        StackName: 'Stack1',
        StackId: STACK_ID,
        StackStatus: StackStatus.CREATE_COMPLETE,
        CreationTime: new Date(),
        Parameters: [{ ParameterKey: 'Secret', ParameterValue: '****' }],
      }],
    });
    const deployed = { ...template, Parameters: { ...template.Parameters, Secret: { ...template.Parameters.Secret, NoEcho: noEcho } } };
    mockCloudFormationClient.on(GetTemplateCommand, { StackName: 'Stack1' }).resolves({ TemplateBody: JSON.stringify(deployed) });
    mockCloudControlClient.on(GetResourceCommand).rejects(Object.assign(new Error('Resource not found'), { name: 'ResourceNotFoundException' }));

    // WHEN
    const cx = await cdkOutFixture(toolkit, FIXTURE);
    const result = await toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN: neither the mask nor the template default is used
    expect(result.stacks[0].template.Outputs.SecretValue.Value).toEqual({ Ref: 'Secret' });
    expect(result.stacks[0].unresolved).toContainEqual(expect.objectContaining({ path: 'Outputs.SecretValue.Value', intrinsic: 'Ref' }));
  });

  test('warns when the deployed template has different resources than the evaluated one', async () => {
    // GIVEN
    givenDeployedStack();
    const { BucketName742CD8B0: _removed, ...resources } = template.Resources;
    mockCloudFormationClient.on(GetTemplateCommand, { StackName: 'Stack1' }).resolves({ TemplateBody: JSON.stringify({ ...template, Resources: resources }) });
    mockCloudControlClient.on(GetResourceCommand).rejects(Object.assign(new Error('Resource not found'), { name: 'ResourceNotFoundException' }));

    // WHEN
    const cx = await cdkOutFixture(toolkit, FIXTURE);
    await toolkit.evaluate(cx, { stacks: { strategy: StackSelectionStrategy.ALL_STACKS } });

    // THEN
    ioHost.expectMessage({ level: 'warn', containing: "The template of stack 'Stack1' differs from its deployed template" });
    ioHost.expectMessage({ level: 'warn', containing: 'Not deployed: BucketName742CD8B0 (AWS::SSM::Parameter)' });
  });

  test('rejects a concurrency that is not a positive integer', async () => {
    const cx = await cdkOutFixture(toolkit, FIXTURE);

    await expect(toolkit.evaluate(cx, { concurrency: 0 })).rejects.toThrow('concurrency must be a positive integer, got 0');
  });
});
