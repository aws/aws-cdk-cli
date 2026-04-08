import {
  DescribeStackResourcesCommand,
  DescribeStacksCommand,
  GetTemplateCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { Deployments } from '../../../lib/api/deployments';
import { ResourceOrphaner } from '../../../lib/api/orphan/orphaner';
import { testStack } from '../../_helpers/assembly';
import { MockSdkProvider, MockSdk, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
import { TestIoHost } from '../../_helpers/test-io-host';

const DEPLOYED_TEMPLATE = {
  Resources: {
    MyTable: {
      Type: 'AWS::DynamoDB::Table',
      Metadata: { 'aws:cdk:path': 'TestStack/MyTable/Resource' },
      Properties: {
        TableName: 'my-table',
        KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
      },
    },
    MyTableReplica: {
      Type: 'Custom::DynamoDBReplica',
      Metadata: { 'aws:cdk:path': 'TestStack/MyTable/Replicaeu-north-1/Default' },
      Properties: {
        TableName: { Ref: 'MyTable' },
        Region: 'eu-north-1',
      },
      DependsOn: ['MyTable'],
    },
    MyFunction: {
      Type: 'AWS::Lambda::Function',
      Metadata: { 'aws:cdk:path': 'TestStack/MyFunction/Resource' },
      Properties: {
        Environment: {
          Variables: {
            TABLE_NAME: { Ref: 'MyTable' },
            TABLE_ARN: { 'Fn::GetAtt': ['MyTable', 'Arn'] },
            STREAM_ARN: { 'Fn::GetAtt': ['MyTable', 'StreamArn'] },
          },
        },
      },
    },
  },
  Outputs: {
    TableName: { Value: { Ref: 'MyTable' } },
    TableArn: { Value: { 'Fn::GetAtt': ['MyTable', 'Arn'] } },
  },
};

const STACK = testStack({
  stackName: 'TestStack',
  template: DEPLOYED_TEMPLATE,
});

let sdkProvider: MockSdkProvider;
let deployments: Deployments;
let ioHost: TestIoHost;
let orphaner: ResourceOrphaner;
let deployedTemplates: any[];

beforeEach(() => {
  restoreSdkMocksToDefault();
  jest.resetAllMocks();

  sdkProvider = new MockSdkProvider();
  ioHost = new TestIoHost();
  const ioHelper = ioHost.asHelper('deploy');
  deployments = new Deployments({ sdkProvider, ioHelper });

  orphaner = new ResourceOrphaner({ deployments, ioHelper });
  deployedTemplates = [];

  mockCloudFormationClient.on(GetTemplateCommand).resolves({
    TemplateBody: JSON.stringify(DEPLOYED_TEMPLATE),
  });

  mockCloudFormationClient.on(DescribeStacksCommand).resolves({
    Stacks: [{
      StackName: 'TestStack',
      StackStatus: StackStatus.UPDATE_COMPLETE,
      CreationTime: new Date(),
      Outputs: [
        { OutputKey: 'CdkOrphanMyTableArn', OutputValue: 'arn:aws:dynamodb:us-east-1:123456789012:table/my-table' },
        { OutputKey: 'CdkOrphanMyTableStreamArn', OutputValue: 'arn:aws:dynamodb:us-east-1:123456789012:table/my-table/stream/2026-01-01T00:00:00.000' },
      ],
    }],
  });

  mockCloudFormationClient.on(DescribeStackResourcesCommand).resolves({
    StackResources: [
      { LogicalResourceId: 'MyTable', PhysicalResourceId: 'my-table' },
      { LogicalResourceId: 'MyTableReplica', PhysicalResourceId: 'eu-north-1' },
      { LogicalResourceId: 'MyFunction', PhysicalResourceId: 'my-function-xyz' },
    ],
  });

  jest.spyOn(deployments, 'deployStack').mockImplementation(async (opts: any) => {
    deployedTemplates.push(opts.overrideTemplate);
    return { type: 'did-deploy-stack', noOp: false, outputs: {}, stackArn: 'arn' };
  });

  jest.spyOn(deployments, 'stackSdk').mockResolvedValue(new MockSdk() as any);
});

describe('ResourceOrphaner (path-based)', () => {
  test('finds all resources under construct path and removes them in step 3', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const step3 = deployedTemplates[2];
    expect(step3.Resources.MyTable).toBeUndefined();
    expect(step3.Resources.MyTableReplica).toBeUndefined();
    expect(step3.Resources.MyFunction).toBeDefined();
  });

  test('sets RETAIN on all matched resources in step 1', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const step1 = deployedTemplates[0];
    expect(step1.Resources.MyTable.DeletionPolicy).toBe('Retain');
    expect(step1.Resources.MyTableReplica.DeletionPolicy).toBe('Retain');
  });

  test('resolves Ref to physical resource ID', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const step1 = deployedTemplates[0];
    expect(step1.Resources.MyFunction.Properties.Environment.Variables.TABLE_NAME).toBe('my-table');
  });

  test('injects temporary outputs for GetAtt in step 1', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const step1 = deployedTemplates[0];
    expect(step1.Outputs.CdkOrphanMyTableArn).toEqual({
      Value: { 'Fn::GetAtt': ['MyTable', 'Arn'] },
    });
    expect(step1.Outputs.CdkOrphanMyTableStreamArn).toEqual({
      Value: { 'Fn::GetAtt': ['MyTable', 'StreamArn'] },
    });
  });

  test('resolves GetAtt to literal from temporary outputs in step 2', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const step2 = deployedTemplates[1];
    expect(step2.Resources.MyFunction.Properties.Environment.Variables.TABLE_ARN)
      .toBe('arn:aws:dynamodb:us-east-1:123456789012:table/my-table');
    expect(step2.Resources.MyFunction.Properties.Environment.Variables.STREAM_ARN)
      .toBe('arn:aws:dynamodb:us-east-1:123456789012:table/my-table/stream/2026-01-01T00:00:00.000');
  });

  test('resolves refs in Outputs', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const step1 = deployedTemplates[0];
    expect(step1.Outputs.TableName.Value).toBe('my-table');
  });

  test('removes temporary outputs in step 2', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const step2 = deployedTemplates[1];
    expect(step2.Outputs.CdkOrphanMyTableArn).toBeUndefined();
    expect(step2.Outputs.CdkOrphanMyTableStreamArn).toBeUndefined();
  });

  test('removes DependsOn in step 3', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const step3 = deployedTemplates[2];
    expect(step3.Resources.MyFunction.DependsOn).toBeUndefined();
  });

  test('calls deployStack three times', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    expect(deployments.deployStack).toHaveBeenCalledTimes(3);
  });

  test('throws if no resources match path', async () => {
    await expect(orphaner.orphan({ stack: STACK, constructPath: 'NonExistent' }))
      .rejects.toThrow(/No resources found/);
  });

  test('throws if step 3 is a no-op', async () => {
    let callCount = 0;
    (deployments.deployStack as jest.Mock).mockImplementation(async (opts: any) => {
      callCount++;
      deployedTemplates.push(opts.overrideTemplate);
      return { type: 'did-deploy-stack', noOp: callCount > 2, outputs: {}, stackArn: 'arn' };
    });

    await expect(orphaner.orphan({ stack: STACK, constructPath: 'MyTable' }))
      .rejects.toThrow(/Step 3 was a no-op/);
  });

  test('outputs inline import command with primary resource', async () => {
    await orphaner.orphan({ stack: STACK, constructPath: 'MyTable' });
    const messages = ioHost.messages.map((m: any) => m.message ?? m);
    const importCmd = messages.find((m: string) => m.includes('cdk import'));
    expect(importCmd).toContain('{"MyTable":{"TableName":"my-table"}}');
  });
});
