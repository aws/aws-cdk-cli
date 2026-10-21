import { GetResourceCommand } from '@aws-sdk/client-cloudcontrol';
import { DescribeStacksCommand, ListExportsCommand, ListStackResourcesCommand, StackStatus } from '@aws-sdk/client-cloudformation';
import type { Template } from '../../../lib/api/cloudformation';
import {
  CfnEvaluationException,
  EvaluateCloudFormationTemplate,
  SharedLookups,
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

    test('lists the resources of a nested stack once across several references to it', async () => {
      restoreSdkMocksToDefault();

      const nestedTemplate: Template = {
        Resources: {
          Bucket: { Type: 'AWS::S3::Bucket' },
        },
        Outputs: {
          BucketName: { Value: { Ref: 'Bucket' } },
        },
      };

      const parentTemplate: Template = {
        Resources: {
          NestedStack: {
            Type: 'AWS::CloudFormation::Stack',
            Properties: {},
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

      mockCloudFormationClient.on(ListStackResourcesCommand, { StackName: 'parent-stack' }).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'NestedStack',
          PhysicalResourceId: 'parent-stack-NestedStack-123',
          ResourceType: 'AWS::CloudFormation::Stack',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });
      mockCloudFormationClient.on(ListStackResourcesCommand, { StackName: 'parent-stack-NestedStack-123' }).resolves({
        StackResourceSummaries: [{
          LogicalResourceId: 'Bucket',
          PhysicalResourceId: 'my-bucket',
          ResourceType: 'AWS::S3::Bucket',
          ResourceStatus: 'CREATE_COMPLETE',
          LastUpdatedTimestamp: new Date(),
        }],
      });

      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await evaluator.evaluateCfnExpression({
          'Fn::GetAtt': ['NestedStack', 'Outputs.BucketName'],
        }));
      }

      expect(results).toEqual(['my-bucket', 'my-bucket', 'my-bucket']);
      expect(mockCloudFormationClient.commandCalls(ListStackResourcesCommand, { StackName: 'parent-stack' })).toHaveLength(1);
      expect(mockCloudFormationClient.commandCalls(ListStackResourcesCommand, { StackName: 'parent-stack-NestedStack-123' })).toHaveLength(1);
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

describe('parameter values', () => {
  const template: Template = {
    Parameters: { Suffix: { Type: 'String', Default: 'default-suffix' }, Blank: { Type: 'String', Default: '' } },
  };
  const evaluator = (parameters: { [name: string]: string }, extra: object = {}) => new EvaluateCloudFormationTemplate({
    template,
    stackName: 'test-stack',
    parameters,
    account: '0123456789',
    region: 'ap-south-east-2',
    partition: 'aws',
    sdk,
    stackArtifact: {} as any,
    ...extra,
  });

  test('by default, an empty string deployed value falls back to the default', async () => {
    expect(await evaluator({ Suffix: '' }).evaluateCfnExpression({ Ref: 'Suffix' })).toEqual('default-suffix');
  });

  test('with strictValues, an empty string deployed value is used, not the default', async () => {
    expect(await evaluator({ Suffix: '' }, { strictValues: true }).evaluateCfnExpression({ Ref: 'Suffix' })).toEqual('');
  });

  test('with strictValues, an empty string default is used', async () => {
    expect(await evaluator({}, { strictValues: true }).evaluateCfnExpression({ Ref: 'Blank' })).toEqual('');
  });

  test('an unavailable parameter is not replaced by its default, including inside other functions', async () => {
    const evaluateCfnTemplate = evaluator({}, { unavailableParameters: ['Suffix'] });

    await expect(evaluateCfnTemplate.evaluateCfnExpression({ Ref: 'Suffix' }))
      .rejects.toThrow("Parameter 'Suffix' can't be used: its deployed value is not available");
    await expect(evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::Sub': 'name-${Suffix}' })).rejects.toThrow(CfnEvaluationException);
  });
});

describe('strictValues', () => {
  const evaluator = (strictValues: boolean) => new EvaluateCloudFormationTemplate({
    template: {},
    stackName: 'test-stack',
    parameters: {},
    account: '0123456789',
    region: 'ap-south-east-2',
    partition: 'aws',
    sdk,
    stackArtifact: {} as any,
    strictValues,
  });

  test('Fn::Select out of range is an evaluation failure with strictValues, and undefined without', async () => {
    const expr = { 'Fn::Select': [2, ['a', 'b']] };
    expect(await evaluator(false).evaluateCfnExpression(expr)).toBeUndefined();
    await expect(evaluator(true).evaluateCfnExpression(expr)).rejects.toThrow('Fn::Select: index 2 is out of range for a list of 2');
  });

  test('Fn::Sub ${!Literal} is the literal text with strictValues, and a reference without', async () => {
    const expr = { 'Fn::Sub': 'a-${!Literal}-b' };
    expect(await evaluator(true).evaluateCfnExpression(expr)).toEqual('a-${Literal}-b');
    await expect(evaluator(false).evaluateCfnExpression(expr)).rejects.toThrow(CfnEvaluationException);
  });
});

describe('shared lookups', () => {
  beforeEach(() => {
    restoreSdkMocksToDefault();
  });

  test('read each resource once, whatever attributes and evaluators ask for it', async () => {
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: 'Topic',
        PhysicalResourceId: 'arn:aws:sns:us-east-1:0123456789:topic',
        ResourceType: 'AWS::SNS::Topic',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    mockCloudControlClient.on(GetResourceCommand).resolves({ ResourceDescription: { Properties: JSON.stringify({ TopicName: 't', DisplayName: 'd' }) } });
    const lookups = new SharedLookups();
    const evaluator = () => new EvaluateCloudFormationTemplate({
      template: { Resources: { Topic: { Type: 'AWS::SNS::Topic' } } },
      stackName: 'test-stack',
      parameters: {},
      account: '0123456789',
      region: 'ap-south-east-2',
      partition: 'aws',
      sdk,
      stackArtifact: {} as any,
      lookups,
    });

    expect(await evaluator().evaluateCfnExpression({ 'Fn::GetAtt': ['Topic', 'TopicName'] })).toEqual('t');
    expect(await evaluator().evaluateCfnExpression({ 'Fn::GetAtt': ['Topic', 'DisplayName'] })).toEqual('d');
    expect(mockCloudControlClient).toHaveReceivedCommandTimes(GetResourceCommand, 1);
  });

  test('limit the number of lookups in flight', async () => {
    let running = 0;
    let maxRunning = 0;
    const cloudControl = {
      async getResource() {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return { ResourceDescription: { Properties: '{}' } };
      },
    } as any;
    const lookups = new SharedLookups(3);

    // start them all at once; the limit decides how many run
    const started = Array.from({ length: 10 }, (_, i) => lookups.resourceProperties(cloudControl, 'scope', 'AWS::SNS::Topic', `t${i}`));
    for (const lookup of started) {
      await lookup;
    }

    expect(maxRunning).toEqual(3);
  });

  test('read the outputs of a nested stack that is not CDK-managed, by its physical id', async () => {
    const nestedArn = 'arn:aws:cloudformation:us-east-1:0123456789:stack/plain-nested/1234';
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: 'Plain',
        PhysicalResourceId: nestedArn,
        ResourceType: 'AWS::CloudFormation::Stack',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    mockCloudFormationClient.on(DescribeStacksCommand, { StackName: nestedArn }).resolves({
      Stacks: [{
        StackName: 'plain-nested',
        StackStatus: StackStatus.CREATE_COMPLETE,
        CreationTime: new Date(),
        Outputs: [{ OutputKey: 'Endpoint', OutputValue: 'https://example.com' }],
      }],
    });
    const evaluateCfnTemplate = new EvaluateCloudFormationTemplate({
      template: { Resources: { Plain: { Type: 'AWS::CloudFormation::Stack', Properties: { TemplateURL: 'https://bucket/t.json' } } } },
      stackName: 'test-stack',
      parameters: {},
      account: '0123456789',
      region: 'ap-south-east-2',
      partition: 'aws',
      sdk,
      stackArtifact: {} as any,
      lookups: new SharedLookups(),
    });

    expect(await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::GetAtt': ['Plain', 'Outputs.Endpoint'] })).toEqual('https://example.com');
  });

  test('read nested stack outputs from the deployed nested stack', async () => {
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: 'Nested',
        PhysicalResourceId: 'arn:aws:cloudformation:us-east-1:0123456789:stack/test-stack-Nested-ABC/1234',
        ResourceType: 'AWS::CloudFormation::Stack',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    mockCloudFormationClient.on(DescribeStacksCommand, { StackName: 'arn:aws:cloudformation:us-east-1:0123456789:stack/test-stack-Nested-ABC/1234' }).resolves({
      Stacks: [{
        StackName: 'test-stack-Nested-ABC',
        StackStatus: StackStatus.CREATE_COMPLETE,
        CreationTime: new Date(),
        Outputs: [{ OutputKey: 'Name', OutputValue: 'deployed-name' }],
      }],
    });
    const evaluateCfnTemplate = new EvaluateCloudFormationTemplate({
      template: { Resources: { Nested: { Type: 'AWS::CloudFormation::Stack', Properties: {} } } },
      stackName: 'test-stack',
      parameters: {},
      account: '0123456789',
      region: 'ap-south-east-2',
      partition: 'aws',
      sdk,
      stackArtifact: {} as any,
      nestedStacks: {
        // an output the template can't evaluate
        Nested: {
          physicalName: 'test-stack-Nested-ABC',
          deployedTemplate: {},
          nestedStackTemplates: {},
          generatedTemplate: { Outputs: { Name: { Value: { 'Fn::GetAZs': '' } } } },
        },
      },
      lookups: new SharedLookups(),
    });

    expect(await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::GetAtt': ['Nested', 'Outputs.Name'] })).toEqual('deployed-name');
  });
});

describe('nested stack outputs', () => {
  test('a nested template without Outputs is an evaluation failure, not a crash', async () => {
    restoreSdkMocksToDefault();
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: 'Nested',
        PhysicalResourceId: 'arn:aws:cloudformation:us-east-1:0123456789:stack/test-stack-Nested-ABC/1234',
        ResourceType: 'AWS::CloudFormation::Stack',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    const evaluateCfnTemplate = new EvaluateCloudFormationTemplate({
      template: { Resources: { Nested: { Type: 'AWS::CloudFormation::Stack', Properties: {} } } },
      stackName: 'test-stack',
      parameters: {},
      account: '0123456789',
      region: 'ap-south-east-2',
      partition: 'aws',
      sdk,
      stackArtifact: {} as any,
      nestedStacks: {
        Nested: { physicalName: 'test-stack-Nested-ABC', generatedTemplate: { Resources: {} }, deployedTemplate: {}, nestedStackTemplates: {} },
      },
    });

    await expect(evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::GetAtt': ['Nested', 'Outputs.Missing'] }))
      .rejects.toThrow(CfnEvaluationException);
  });
});

describe('attribute values', () => {
  beforeEach(() => {
    restoreSdkMocksToDefault();
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: 'Topic',
        PhysicalResourceId: 'arn:aws:sns:us-east-1:0123456789:topic',
        ResourceType: 'AWS::SNS::Topic',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    mockCloudControlClient.on(GetResourceCommand).resolves({ ResourceDescription: { Properties: JSON.stringify({ TopicName: null }) } });
  });

  test.each([false, true])('a null attribute is not a value (strictValues: %s)', async (strictValues) => {
    const evaluateCfnTemplate = new EvaluateCloudFormationTemplate({
      template: { Resources: { Topic: { Type: 'AWS::SNS::Topic' } } },
      stackName: 'test-stack',
      parameters: {},
      account: '0123456789',
      region: 'ap-south-east-2',
      partition: 'aws',
      sdk,
      stackArtifact: {} as any,
      strictValues,
    });

    await expect(evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::GetAtt': ['Topic', 'TopicName'] }))
      .rejects.toThrow("Attribute 'TopicName' of resource 'Topic' could not be found for evaluation");
  });
});

describe('failed Cloud Control lookups', () => {
  beforeEach(() => {
    restoreSdkMocksToDefault();
  });

  test('keep the original error as the cause', async () => {
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: 'Topic',
        PhysicalResourceId: 'arn:aws:sns:us-east-1:0123456789:topic',
        ResourceType: 'AWS::SNS::Topic',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    const throttled = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    mockCloudControlClient.on(GetResourceCommand).rejects(throttled);
    const evaluateCfnTemplate = createEvaluateCloudFormationTemplate({ Resources: { Topic: { Type: 'AWS::SNS::Topic' } } });

    const error = await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::GetAtt': ['Topic', 'TopicName'] }).catch((e) => e);

    expect(error).toBeInstanceOf(CfnEvaluationException);
    expect(error.cause).toBe(throttled);
  });

  test('turn any other error while building the Cloud Control identifier into an evaluation failure', async () => {
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: 'User',
        PhysicalResourceId: 'some-user',
        ResourceType: 'AWS::Cognito::UserPoolUser',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    const evaluateCfnTemplate = createEvaluateCloudFormationTemplate({
      Resources: { User: { Type: 'AWS::Cognito::UserPoolUser', Properties: { UserPoolId: { 'Fn::ImportValue': 'PoolExport' } } } },
    });
    const throttled = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    mockCloudFormationClient.on(ListExportsCommand).rejects(throttled);

    const error = await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::GetAtt': ['User', 'Username'] }).catch((e) => e);

    expect(error).toBeInstanceOf(CfnEvaluationException);
    expect(error.cause).toBe(throttled);
  });

  test('report a Cloud Control identifier that cannot be evaluated as it is, not as a failed lookup', async () => {
    mockCloudFormationClient.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [{
        LogicalResourceId: 'User',
        PhysicalResourceId: 'some-user',
        ResourceType: 'AWS::Cognito::UserPoolUser',
        ResourceStatus: 'CREATE_COMPLETE',
        LastUpdatedTimestamp: new Date(),
      }],
    });
    const evaluateCfnTemplate = new EvaluateCloudFormationTemplate({
      template: {
        Parameters: { Pool: { Type: 'String', NoEcho: true, Default: 'not-the-deployed-value' } },
        Resources: { User: { Type: 'AWS::Cognito::UserPoolUser', Properties: { UserPoolId: { Ref: 'Pool' } } } },
      },
      stackName: 'test-stack',
      parameters: {},
      account: '0123456789',
      region: 'ap-south-east-2',
      partition: 'aws',
      sdk,
      stackArtifact: {} as any,
      unavailableParameters: ['Pool'],
    });

    const error = await evaluateCfnTemplate.evaluateCfnExpression({ 'Fn::GetAtt': ['User', 'Username'] }).catch((e) => e);

    expect(error).toBeInstanceOf(CfnEvaluationException);
    expect(error.message).toEqual("Parameter 'Pool' can't be used: its deployed value is not available");
    expect(error.cause).toBeUndefined();
    expect(mockCloudControlClient).not.toHaveReceivedCommand(GetResourceCommand);
  });
});

