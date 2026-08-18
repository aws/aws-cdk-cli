import { GetResourceCommand } from '@aws-sdk/client-cloudcontrol';
import { ListExportsCommand, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import type { Template } from '../../../lib/api/cloudformation';
import {
  CfnEvaluationException,
  EvaluateCloudFormationTemplate,
} from '../../../lib/api/cloudformation';
import { MockSdk, mockCloudControlClient, mockCloudFormationClient, restoreSdkMocksToDefault } from '../../_helpers/mock-sdk';

const sdk = new MockSdk();

const createEvaluateCloudFormationTemplate = (template: Template) =>
  new EvaluateCloudFormationTemplate({
    template,
    stackName: 'test-stack',
    parameters: {},
    account: '0123456789',
    region: 'ap-south-east-2',
    partition: 'aws',
    sdk,
    stackArtifact: {} as any,
  });

describe('evaluateCfnExpression', () => {
  describe('simple literal expressions', () => {
    const template: Template = {};
    const evaluateCfnTemplate = createEvaluateCloudFormationTemplate(template);

    test('resolves Fn::Join correctly', async () => {
      // WHEN
      const result = await evaluateCfnTemplate.evaluateCfnExpression({
        'Fn::Join': [':', ['a', 'b', 'c']],
      });

      // THEN
      expect(result).toEqual('a:b:c');
    });

    test('resolves Fn::Split correctly', async () => {
      // WHEN
      const result = await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::Split': ['|', 'a|b|c'] });

      // THEN
      expect(result).toEqual(['a', 'b', 'c']);
    });

    test('resolves Fn::Select correctly', async () => {
      // WHEN
      const result = await evaluateCfnTemplate.evaluateCfnExpression({
        'Fn::Select': ['1', ['apples', 'grapes', 'oranges', 'mangoes']],
      });

      // THEN
      expect(result).toEqual('grapes');
    });

    test('resolves Fn::Sub correctly', async () => {
      // WHEN
      const result = await evaluateCfnTemplate.evaluateCfnExpression({
        'Fn::Sub': ['Testing Fn::Sub Foo=${Foo} Bar=${Bar}', { Foo: 'testing', Bar: 1 }],
      });

      // THEN
      expect(result).toEqual('Testing Fn::Sub Foo=testing Bar=1');
    });
  });

  describe('Fn::GetAtt with Cloud Control API fallback', () => {
    test('falls back to CCAPI for unsupported resource type', async () => {
      const template: Template = {
        Resources: {
          MyCustom: {
            Type: 'AWS::Custom::Thing',
            Properties: {
              Foo: { 'Fn::GetAtt': ['MyCustom', 'Bar'] },
            },
          },
        },
      };
      const evaluator = createEvaluateCloudFormationTemplate(template);
      mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'MyCustom',
          PhysicalResourceId: 'phys-id',
          ResourceType: 'AWS::Custom::Thing',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });
      mockCloudControlClient.on(GetResourceCommand).resolves({
        ResourceDescription: {
          Properties: JSON.stringify({ Bar: 'resolved-bar-value' }),
        },
      });

      const result = await evaluator.evaluateCfnExpression({ 'Fn::GetAtt': ['MyCustom', 'Bar'] });
      expect(result).toEqual('resolved-bar-value');
    });

    test('falls back to CCAPI for unsupported attribute on known resource type', async () => {
      const template: Template = {
        Resources: {
          MyBucket: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              Tag: { 'Fn::GetAtt': ['MyBucket', 'WebsiteURL'] },
            },
          },
        },
      };
      const evaluator = createEvaluateCloudFormationTemplate(template);
      mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'MyBucket',
          PhysicalResourceId: 'my-bucket',
          ResourceType: 'AWS::S3::Bucket',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });
      mockCloudControlClient.on(GetResourceCommand).resolves({
        ResourceDescription: {
          Properties: JSON.stringify({ WebsiteURL: 'http://my-bucket.s3-website.ap-south-east-2.amazonaws.com' }),
        },
      });

      const result = await evaluator.evaluateCfnExpression({ 'Fn::GetAtt': ['MyBucket', 'WebsiteURL'] });
      expect(result).toEqual('http://my-bucket.s3-website.ap-south-east-2.amazonaws.com');
    });

    test('throws CfnEvaluationException when CCAPI returns no matching attribute', async () => {
      const template: Template = {
        Resources: {
          MyCustom: {
            Type: 'AWS::Custom::Thing',
            Properties: {},
          },
        },
      };
      const evaluator = createEvaluateCloudFormationTemplate(template);
      mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'MyCustom',
          PhysicalResourceId: 'phys-id',
          ResourceType: 'AWS::Custom::Thing',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });
      mockCloudControlClient.on(GetResourceCommand).resolves({
        ResourceDescription: {
          Properties: JSON.stringify({ SomethingElse: 'value' }),
        },
      });

      await expect(
        evaluator.evaluateCfnExpression({ 'Fn::GetAtt': ['MyCustom', 'Missing'] }),
      ).rejects.toBeInstanceOf(CfnEvaluationException);
    });

    test('throws CfnEvaluationException when CCAPI call fails', async () => {
      const template: Template = {
        Resources: {
          MyCustom: {
            Type: 'AWS::Custom::Thing',
            Properties: {},
          },
        },
      };
      const evaluator = createEvaluateCloudFormationTemplate(template);
      mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'MyCustom',
          PhysicalResourceId: 'phys-id',
          ResourceType: 'AWS::Custom::Thing',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });
      mockCloudControlClient.on(GetResourceCommand).rejects(new Error('Resource not found'));

      await expect(
        evaluator.evaluateCfnExpression({ 'Fn::GetAtt': ['MyCustom', 'Bar'] }),
      ).rejects.toBeInstanceOf(CfnEvaluationException);
    });

    test('resolves Fn::GetAtt via CCAPI for attribute on unsupported resource', async () => {
      const template: Template = {
        Resources: {
          MyCustom: {
            Type: 'AWS::Custom::Thing',
            Properties: {
              Output: { 'Fn::GetAtt': ['MyCustom', 'Output'] },
            },
          },
        },
      };
      const evaluator = createEvaluateCloudFormationTemplate(template);
      mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'MyCustom',
          PhysicalResourceId: 'phys-id',
          ResourceType: 'AWS::Custom::Thing',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });
      mockCloudControlClient.on(GetResourceCommand).resolves({
        ResourceDescription: {
          Properties: JSON.stringify({ Output: 'the-output' }),
        },
      });

      const result = await evaluator.evaluateCfnExpression({ 'Fn::GetAtt': ['MyCustom', 'Output'] });
      expect(result).toEqual('the-output');
    });

    test('still uses hardcoded format when resource type is supported', async () => {
      // Lambda Arn is in the hardcoded map — should NOT fall back to CCAPI
      const template: Template = {
        Resources: {
          MyFunc: {
            Type: 'AWS::Lambda::Function',
            Properties: {},
          },
        },
      };
      const evaluator = createEvaluateCloudFormationTemplate(template);
      mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'MyFunc',
          PhysicalResourceId: 'my-func',
          ResourceType: 'AWS::Lambda::Function',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });

      const result = await evaluator.evaluateCfnExpression({ 'Fn::GetAtt': ['MyFunc', 'Arn'] });
      expect(result).toEqual('arn:aws:lambda:ap-south-east-2:0123456789:function:my-func');
    });
  });

  describe('intrinsic type guards', () => {
    const template: Template = {};
    const evaluateCfnTemplate = createEvaluateCloudFormationTemplate(template);

    test('Fn::Join throws CfnEvaluationException when args evaluate to non-array', async () => {
      const err = await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::Join': ['||', { Type: 'List<String>' }] })
        .catch((e: any) => e);
      expect(err).toBeInstanceOf(CfnEvaluationException);
      expect(err.message).toContain('Fn::Join');
      expect(err.message).toContain('{"Type":"List<String>"}');
    });

    test('Fn::Split throws CfnEvaluationException when args evaluate to non-string', async () => {
      const err = await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::Split': ['|', ['a', 'b']] })
        .catch((e: any) => e);
      expect(err).toBeInstanceOf(CfnEvaluationException);
      expect(err.message).toContain('Fn::Split');
      expect(err.message).toContain('["a","b"]');
    });

    test('Fn::Select throws CfnEvaluationException when args evaluate to non-array', async () => {
      const err = await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::Select': [0, 'not-an-array'] })
        .catch((e: any) => e);
      expect(err).toBeInstanceOf(CfnEvaluationException);
      expect(err.message).toContain('Fn::Select');
      expect(err.message).toContain('"not-an-array"');
    });
  });

  describe('nested stack parameter resolution', () => {
    test('resolves nested stack output that joins a List<> parameter using parent parameter values', async () => {
      const nestedTemplate: Template = {
        Parameters: {
          ListParam: { Type: 'AWS::SSM::Parameter::Value<List<String>>' },
        },
        Outputs: {
          JoinedOutput: {
            Value: { 'Fn::Join': ['||', { Ref: 'ListParam' }] },
          },
        },
      };

      const parentTemplate: Template = {
        Resources: {
          NestedStack: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {
              Parameters: {
                ListParam: ['val1', 'val2', 'val3'],
              },
            },
          },
        },
      };

      const evaluator = new EvaluateCloudFormationTemplate({
        template: parentTemplate,
        stackName: 'parent-stack',
        parameters: {},
        account: '0123456789',
        region: 'ap-south-east-2',
        partition: 'aws',
        sdk,
        stackArtifact: {} as any,
        nestedStacks: {
          NestedStack: {
            physicalName: 'parent-stack-NestedStack-123',
            deployedTemplate: nestedTemplate,
            generatedTemplate: nestedTemplate,
            nestedStackTemplates: {},
          },
        },
      });

      mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'NestedStack',
          PhysicalResourceId: 'parent-stack-NestedStack-123',
          ResourceType: 'AWS::CloudFormation::Stack',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });

      const result = await evaluator.evaluateCfnExpression({
        'Fn::GetAtt': ['NestedStack', 'Outputs.JoinedOutput'],
      });

      expect(result).toEqual('val1||val2||val3');
    });
  });

  describe('resolving Fn::ImportValue', () => {
    const template: Template = {};
    const evaluateCfnTemplate = createEvaluateCloudFormationTemplate(template);

    const createMockExport = (num: number) => ({
      ExportingStackId: `test-exporting-stack-id-${num}`,
      Name: `test-name-${num}`,
      Value: `test-value-${num}`,
    });

    beforeEach(async () => {
      restoreSdkMocksToDefault();
      mockCloudFormationClient
        .on(ListExportsCommand)
        .resolvesOnce({
          Exports: [createMockExport(1), createMockExport(2), createMockExport(3)],
          NextToken: 'next-token-1',
        })
        .resolvesOnce({
          Exports: [createMockExport(4), createMockExport(5), createMockExport(6)],
          NextToken: undefined,
        });
    });

    test('resolves Fn::ImportValue using lookup', async () => {
      const result = await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::ImportValue': 'test-name-5' });
      expect(result).toEqual('test-value-5');
    });

    test('throws error when Fn::ImportValue cannot be resolved', async () => {
      const evaluate = () =>
        evaluateCfnTemplate.evaluateCfnExpression({
          'Fn::ImportValue': 'blah',
        });
      await expect(evaluate).rejects.toBeInstanceOf(CfnEvaluationException);
    });
  });
});
