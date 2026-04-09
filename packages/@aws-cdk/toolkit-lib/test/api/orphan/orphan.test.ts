import {
  DescribeStacksCommand,
  GetTemplateCommand,
  GetTemplateSummaryCommand,
  ListStackResourcesCommand,
  StackStatus,
} from '@aws-sdk/client-cloudformation';
import { Deployments } from '../../../lib/api/deployments';
import { ResourceOrphaner } from '../../../lib/actions/orphan/orphaner';
import { testStack } from '../../_helpers/assembly';
import { MockSdkProvider, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';
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

let deployments: Deployments;
let ioHost: TestIoHost;
let orphaner: ResourceOrphaner;
let deployedTemplates: any[];

beforeEach(() => {
  restoreSdkMocksToDefault();
  jest.resetAllMocks();

  const sdkProvider = new MockSdkProvider();
  ioHost = new TestIoHost();
  const ioHelper = ioHost.asHelper('orphan');
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

  mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
    StackResourceSummaries: [
      { LogicalResourceId: 'MyTable', PhysicalResourceId: 'my-table', ResourceType: 'AWS::DynamoDB::Table', ResourceStatus: 'CREATE_COMPLETE', LastUpdatedTimestamp: new Date() },
      { LogicalResourceId: 'MyTableReplica', PhysicalResourceId: 'eu-north-1', ResourceType: 'Custom::DynamoDBReplica', ResourceStatus: 'CREATE_COMPLETE', LastUpdatedTimestamp: new Date() },
      { LogicalResourceId: 'MyFunction', PhysicalResourceId: 'my-function-xyz', ResourceType: 'AWS::Lambda::Function', ResourceStatus: 'CREATE_COMPLETE', LastUpdatedTimestamp: new Date() },
    ],
  });

  mockCloudFormationClient.on(GetTemplateSummaryCommand).resolves({
    ResourceIdentifierSummaries: [
      { ResourceType: 'AWS::DynamoDB::Table', ResourceIdentifiers: ['TableName'] },
    ],
  });

  jest.spyOn(deployments, 'deployStack').mockImplementation(async (opts: any) => {
    deployedTemplates.push(opts.overrideTemplate);
    return { type: 'did-deploy-stack', noOp: false, outputs: {}, stackArn: 'arn' };
  });
});

describe('ResourceOrphaner', () => {
  describe('makePlan', () => {
    test('returns orphaned resources with metadata', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      expect(plan.stackName).toBe('TestStack');
      expect(plan.orphanedResources).toHaveLength(2);
      expect(plan.orphanedResources).toEqual(expect.arrayContaining([
        expect.objectContaining({ logicalId: 'MyTable', resourceType: 'AWS::DynamoDB::Table' }),
        expect.objectContaining({ logicalId: 'MyTableReplica', resourceType: 'Custom::DynamoDBReplica' }),
      ]));
    });

    test('throws if no resources match path', async () => {
      await expect(orphaner.makePlan(STACK, ['NonExistent']))
        .rejects.toThrow(/No resources found/);
    });

    test('hints about disabled metadata when no metadata exists', async () => {
      mockCloudFormationClient.on(GetTemplateCommand).resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            SomeResource: { Type: 'AWS::SNS::Topic', Properties: {} },
          },
        }),
      });

      await expect(orphaner.makePlan(STACK, ['MyTable']))
        .rejects.toThrow(/metadata.*disabled/);
    });

    test('does not deploy anything', async () => {
      await orphaner.makePlan(STACK, ['MyTable']);
      expect(deployments.deployStack).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    test('finds all resources under construct path and removes them in step 3', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      const step3 = deployedTemplates[2];
      expect(step3.Resources.MyTable).toBeUndefined();
      expect(step3.Resources.MyTableReplica).toBeUndefined();
      expect(step3.Resources.MyFunction).toBeDefined();
    });

    test('sets RETAIN on all matched resources in step 1', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      const step1 = deployedTemplates[0];
      expect(step1.Resources.MyTable.DeletionPolicy).toBe('Retain');
      expect(step1.Resources.MyTableReplica.DeletionPolicy).toBe('Retain');
    });

    test('resolves Ref to physical resource ID', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      const step1 = deployedTemplates[0];
      expect(step1.Resources.MyFunction.Properties.Environment.Variables.TABLE_NAME).toBe('my-table');
    });

    test('injects temporary outputs for GetAtt in step 1', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      const step1 = deployedTemplates[0];
      expect(step1.Outputs.CdkOrphanMyTableArn).toEqual({
        Value: { 'Fn::GetAtt': ['MyTable', 'Arn'] },
      });
      expect(step1.Outputs.CdkOrphanMyTableStreamArn).toEqual({
        Value: { 'Fn::GetAtt': ['MyTable', 'StreamArn'] },
      });
    });

    test('resolves GetAtt to literal from temporary outputs in step 2', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      const step2 = deployedTemplates[1];
      expect(step2.Resources.MyFunction.Properties.Environment.Variables.TABLE_ARN)
        .toBe('arn:aws:dynamodb:us-east-1:123456789012:table/my-table');
      expect(step2.Resources.MyFunction.Properties.Environment.Variables.STREAM_ARN)
        .toBe('arn:aws:dynamodb:us-east-1:123456789012:table/my-table/stream/2026-01-01T00:00:00.000');
    });

    test('resolves refs in Outputs', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      const step1 = deployedTemplates[0];
      expect(step1.Outputs.TableName.Value).toBe('my-table');
    });

    test('removes temporary outputs in step 2', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      const step2 = deployedTemplates[1];
      expect(step2.Outputs.CdkOrphanMyTableArn).toBeUndefined();
      expect(step2.Outputs.CdkOrphanMyTableStreamArn).toBeUndefined();
    });

    test('removes DependsOn in step 3', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      const step3 = deployedTemplates[2];
      expect(step3.Resources.MyFunction.DependsOn).toBeUndefined();
    });

    test('calls deployStack three times', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await plan.execute();
      expect(deployments.deployStack).toHaveBeenCalledTimes(3);
    });

    test('throws if step 3 is a no-op', async () => {
      let callCount = 0;
      (deployments.deployStack as jest.Mock).mockImplementation(async (opts: any) => {
        callCount++;
        deployedTemplates.push(opts.overrideTemplate);
        return { type: 'did-deploy-stack', noOp: callCount > 2, outputs: {}, stackArn: 'arn' };
      });

      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      await expect(plan.execute()).rejects.toThrow(/unexpectedly a no-op/);
    });

    test('returns resource mapping only for primary resources (path ends with /Resource)', async () => {
      const plan = await orphaner.makePlan(STACK, ['MyTable']);
      const result = await plan.execute();
      // MyTableReplica (path ends with /Default) should NOT be included
      expect(result.resourceMapping).toEqual({
        MyTable: { TableName: 'my-table' },
      });
    });
  });
});
