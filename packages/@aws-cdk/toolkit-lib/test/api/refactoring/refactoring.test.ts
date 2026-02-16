const mockLoadResourceModel = jest.fn();
jest.mock('@aws-cdk/cloudformation-diff/lib/diff/util', () => ({
  loadResourceModel: mockLoadResourceModel,
}));

import { GetTemplateCommand, ListStacksCommand } from '@aws-sdk/client-cloudformation';
import { expect } from '@jest/globals';
import { ToolkitInfo } from '../../../lib/api';
import { usePrescribedMappings } from '../../../lib/api/refactoring';
import type { CloudFormationStack, CloudFormationTemplate } from '../../../lib/api/refactoring/cloudformation';
import { ResourceLocation, ResourceMapping } from '../../../lib/api/refactoring/cloudformation';
import { computeResourceDigests } from '../../../lib/api/refactoring/digest';
import { generateStackDefinitions } from '../../../lib/api/refactoring/stack-definitions';
import { MockSdkProvider, mockBootstrapStack, mockCloudFormationClient } from '../../_helpers/mock-sdk';

describe(computeResourceDigests, () => {
  function makeStacks(templates: CloudFormationTemplate[]): CloudFormationStack[] {
    return templates.map((template, index) => ({
      environment: { account: '123456789012', region: 'us-east-1', name: '' },
      stackName: `Stack${index + 1}`,
      template,
    }));
  }

  test('returns empty map for empty stacks', () => {
    const stacks = makeStacks([{}]);
    const result = computeResourceDigests(stacks);
    expect(Object.keys(result).length).toBe(0);
  });

  test('computes digest for single resource without properties', () => {
    const template = {
      Resources: {
        MyResource: {
          Type: 'AWS::S3::Bucket',
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(Object.keys(result).length).toBe(1);
    expect(result['Stack1.MyResource']).toBeDefined();
  });

  test('computes digest for single resource without dependencies', () => {
    const template = {
      Resources: {
        MyResource: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'example-bucket' },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(Object.keys(result).length).toBe(1);
    expect(result['Stack1.MyResource']).toBeDefined();
  });

  test('order of properties does not matter', () => {
    const template = {
      Resources: {
        MyResource1: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'example-bucket', AnotherProp: 'another-value' },
        },
        MyResource2: {
          Type: 'AWS::S3::Bucket',
          Properties: { AnotherProp: 'another-value', Prop: 'example-bucket' },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(Object.keys(result).length).toBe(2);
    expect(result['Stack1.MyResource1']).toEqual(result['Stack1.MyResource2']);
  });

  test('computes digests with multiple resources referencing each other', () => {
    const template = {
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'my-bucket' },
        },
        Topic: {
          Type: 'AWS::SNS::Topic',
          Properties: {
            DisplayName: 'my-topic',
            Subscription: [{ Endpoint: { Ref: 'Bucket' } }],
          },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(Object.keys(result).length).toBe(2);
    expect(result['Stack1.Bucket']).toBeDefined();
    expect(result['Stack1.Topic']).toBeDefined();
  });

  test('computes different digests if top-level properties are different', () => {
    const template = {
      Resources: {
        Q1: {
          Type: 'AWS::SQS::Queue',
          Properties: { QueueName: 'YYYYYYYYYY' },
          UpdateReplacePolicy: 'Retain',
          DeletionPolicy: 'Retain',
        },
        Q2: {
          Type: 'AWS::SQS::Queue',
          Properties: { QueueName: 'YYYYYYYYYY' },
          UpdateReplacePolicy: 'Delete',
          DeletionPolicy: 'Retain',
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Q1']).not.toBe(result['Stack1.Q2']);
  });

  test('computes the same digest for identical resources', () => {
    const template = {
      Resources: {
        Bucket1: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'XXXXXXXXX' },
        },
        Bucket2: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'XXXXXXXXX' },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(Object.keys(result).length).toBe(2);
    expect(result['Stack1.Bucket1']).toBe(result['Stack1.Bucket2']);
  });

  test('identical resources up to dependency names', () => {
    const template = {
      Resources: {
        Q1: {
          Type: 'AWS::SQS::Queue',
          Properties: { QueueName: 'YYYYYYYYYY' },
        },
        Q2: {
          Type: 'AWS::SQS::Queue',
          Properties: { QueueName: 'YYYYYYYYYY' },
        },
        // These buckets are identical, up to the name of their dependencies
        // (which are also identical). Therefore, they should have the same digest.
        Bucket1: {
          Type: 'AWS::S3::Bucket',
          Properties: { Dep: { Ref: 'Q1' } },
        },
        Bucket2: {
          Type: 'AWS::S3::Bucket',
          Properties: { Dep: { Ref: 'Q2' } },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Bucket1']).toBe(result['Stack1.Bucket2']);
  });

  test('identical resources up to dependency names - DependsOn', () => {
    const template = {
      Resources: {
        Bucket1: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'my-bucket' },
        },
        Bucket2: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'my-bucket' },
        },
        Topic1: {
          Type: 'AWS::SNS::Topic',
          DependsOn: 'Bucket1',
          Properties: {
            DisplayName: 'my-topic',
          },
        },
        Topic2: {
          Type: 'AWS::SNS::Topic',
          DependsOn: 'Bucket2',
          Properties: {
            DisplayName: 'my-topic',
          },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Topic1']).toEqual(result['Stack1.Topic2']);
  });

  test('different resources - DependsOn plus Ref in properties', () => {
    const template = {
      Resources: {
        Bucket1: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'my-bucket' },
        },
        Bucket2: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'my-bucket' },
        },
        Bucket3: {
          Type: 'AWS::S3::Bucket',
          Properties: { AnotherProp: 'foobar' },
        },
        Topic1: {
          Type: 'AWS::SNS::Topic',
          DependsOn: 'Bucket1',
          Properties: {
            DisplayName: 'my-topic',
          },
        },
        Topic2: {
          Type: 'AWS::SNS::Topic',
          DependsOn: 'Bucket2',
          Properties: {
            DisplayName: 'my-topic',
            SomeRef: { Ref: 'Bucket3' },
          },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Topic1']).not.toEqual(result['Stack1.Topic2']);
  });

  test('different resources - DependsOn', () => {
    const template = {
      Resources: {
        Bucket1: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'foo' },
        },
        Bucket2: {
          Type: 'AWS::S3::Bucket',
          Properties: { Prop: 'bar' },
        },
        Topic1: {
          Type: 'AWS::SNS::Topic',
          DependsOn: 'Bucket1',
          Properties: {
            DisplayName: 'my-topic',
          },
        },
        Topic2: {
          Type: 'AWS::SNS::Topic',
          DependsOn: 'Bucket2',
          Properties: {
            DisplayName: 'my-topic',
          },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Topic1']).not.toEqual(result['Stack1.Topic2']);
  });

  test('almost identical resources - dependency via different intrinsic functions', () => {
    const template = {
      Resources: {
        Q1: {
          Type: 'AWS::SQS::Queue',
          Properties: { QueueName: 'YYYYYYYYYY' },
        },
        Q2: {
          Type: 'AWS::SQS::Queue',
          Properties: { QueueName: 'YYYYYYYYYY' },
        },
        // These buckets are almost identical. Even though they depend on identical
        // resources, they should have different digests because the dependency
        // is via different functions.
        Bucket1: {
          Type: 'AWS::S3::Bucket',
          Properties: { Dep: { Ref: 'Q1' } },
        },
        Bucket2: {
          Type: 'AWS::S3::Bucket',
          Properties: { Dep: { 'Fn::GetAtt': ['Q2', 'QueueName'] } },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Bucket1']).not.toBe(result['Stack1.Bucket2']);
  });

  test('ignores references to unknown resources', () => {
    // These references could be to parameters, outputs etc.
    // We don't care about them.
    const template = {
      Resources: {
        MyResource: {
          Type: 'AWS::SNS::Topic',
          Properties: {
            DisplayName: 'my-topic',
            Subscription: [{ Endpoint: { Ref: 'NonExistentResource' } }],
          },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(Object.keys(result).length).toBe(1);
    expect(result['Stack1.MyResource']).toBeDefined();
  });

  test('ignores CDK construct path', () => {
    const template = {
      Resources: {
        Q1: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            Foo: 'Bar',
          },
          Metadata: {
            'aws:cdk:path': 'Stack/Q1/Resource',
          },
        },
        Q2: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            Foo: 'Bar',
          },
          Metadata: {
            'aws:cdk:path': 'Stack/Q2/Resource',
          },
        },
      },
    };
    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Q1']).toBeDefined();
    expect(result['Stack1.Q2']).toBeDefined();
    expect(result['Stack1.Q1']).toBe(result['Stack1.Q2']);
  });

  test('different physical IDs lead to different digests', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName'],
    });

    const template = {
      Resources: {
        Foo1: {
          Type: 'AWS::S3::Foo',
          Properties: {
            FooName: 'XXXXXXXXX',
            ShouldBeIgnored: true,
          },
        },
        Foo2: {
          Type: 'AWS::S3::Foo',
          Properties: {
            FooName: 'YYYYYYYYY',
            ShouldAlsoBeIgnored: true,
          },
        },
      },
    };

    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Foo1']).toBeDefined();
    expect(result['Stack1.Foo2']).toBeDefined();
    expect(result['Stack1.Foo1']).not.toEqual(result['Stack1.Foo2']);
  });

  test('primaryIdentifier is a composite field - different values', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName', 'BarName'],
    });

    const template = {
      Resources: {
        Foo1: {
          Type: 'AWS::S3::Foo',
          Properties: {
            FooName: 'XXXXXXXXX',
            BarName: 'YYYYYYYYY',
            ShouldBeIgnored: true,
          },
        },
        Foo2: {
          Type: 'AWS::S3::Foo',
          Properties: {
            FooName: 'XXXXXXXXX',
            BarName: 'ZZZZZZZZZ',
            ShouldAlsoBeIgnored: true,
          },
        },
      },
    };

    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Foo1']).toBeDefined();
    expect(result['Stack1.Foo2']).toBeDefined();
    expect(result['Stack1.Foo1']).not.toEqual(result['Stack1.Foo2']);
  });

  test('resource properties does not contain primaryIdentifier - different values', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName'],
    });

    const template = {
      Resources: {
        Foo1: {
          Type: 'AWS::S3::Foo',
          Properties: {
            ShouldNotBeIgnored: true,
          },
        },
        Foo2: {
          Type: 'AWS::S3::Foo',
          Properties: {
            ShouldNotBeIgnoredEither: true,
          },
        },
      },
    };

    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Foo1']).toBeDefined();
    expect(result['Stack1.Foo2']).toBeDefined();
    expect(result['Stack1.Foo1']).not.toBe(result['Stack1.Foo2']);
  });

  test('resource properties does not contain primaryIdentifier - same value', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName'],
    });

    const template = {
      Resources: {
        Foo1: {
          Type: 'AWS::S3::Foo',
          Properties: {
            SomeProp: true,
          },
        },
        Foo2: {
          Type: 'AWS::S3::Foo',
          Properties: {
            SomeProp: true,
          },
        },
      },
    };

    const result = computeResourceDigests(makeStacks([template]));
    expect(result['Stack1.Foo1']).toBeDefined();
    expect(result['Stack1.Foo2']).toBeDefined();
    expect(result['Stack1.Foo1']).toEqual(result['Stack1.Foo2']);
  });

  test('identical resources from different stacks', () => {
    const template1 = {
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          // cross-stack reference
          Properties: { SomeProp: { 'Fn::ImportValue': 'Stack2:Bar' } },
        },
      },
    };

    const template2 = {
      Outputs: {
        ExportForTheBarResource: {
          Value: { Ref: 'Bar' },
          Export: { Name: 'Stack2:Bar' },
        },
      },
      Resources: {
        Bar: {
          Type: 'AWS::X::Y',
          Properties: { Banana: true },
        },
        AnotherBucket: {
          Type: 'AWS::S3::Bucket',
          // same stack reference
          Properties: { SomeProp: { Ref: 'Bar' } },
        },
      },
    };

    const stacks = makeStacks([template1, template2]);
    const result = computeResourceDigests(stacks);
    expect(Object.keys(result).length).toBe(3);
    expect(result['Stack1.Bucket']).toBeDefined();
    expect(result['Stack2.Bar']).toBeDefined();
    expect(result['Stack2.AnotherBucket']).toBeDefined();
    expect(result['Stack1.Bucket']).toEqual(result['Stack2.AnotherBucket']);
  });

  test('resources with same final values via different sources have identical digests', () => {
    const template1 = {
      Resources: {
        Bucket1: {
          Type: 'AWS::S3::Bucket',
          // Take the string from the export
          Properties: { SomeProp: { 'Fn::ImportValue': 'Stack2:Bar' } },
        },
        Bucket2: {
          Type: 'AWS::S3::Bucket',
          // Same string hard-coded here
          Properties: { SomeProp: 'SomeStringValue' },
        },
      },
    };

    const template2 = {
      Outputs: {
        PrimitiveExport: {
          Value: 'SomeStringValue',
          Export: { Name: 'Stack2:Bar' },
        },
      },
      Resources: {
        // Not referenced by anything
        Dummy: {
          Type: 'AWS::X::Y',
          Properties: { Banana: true },
        },
      },
    };

    const stacks = makeStacks([template1, template2]);
    const result = computeResourceDigests(stacks);
    expect(result['Stack1.Bucket1']).toBeDefined();
    expect(result['Stack1.Bucket2']).toBeDefined();

    // Regardless of the fact that Bucket1 gets its value from an import and Bucket2 has it hardcoded,
    // they should be considered identical because the final value of the property is the same.
    expect(result['Stack1.Bucket1']).toEqual(result['Stack1.Bucket2']);
  });

  test('different resources from different stacks', () => {
    const template1 = {
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { SomeProp: { 'Fn::ImportValue': 'Stack2:Foo' } },
        },
      },
    };

    const template2 = {
      Outputs: {
        ExportForTheFooResource: {
          Value: { Ref: 'Foo' },
          Export: { Name: 'Stack2:Foo' },
        },
      },
      Resources: {
        Foo: {
          Type: 'AWS::S3::Foo',
        },
        Bar: {
          Type: 'AWS::S3::Bar',
        },
        AnotherBucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { SomeProp: { Ref: 'Bar' } },
        },
      },
    };

    const stacks = makeStacks([template1, template2]);
    const result = computeResourceDigests(stacks);
    expect(Object.keys(result).length).toBe(4);
    expect(result['Stack1.Bucket']).toBeDefined();
    expect(result['Stack2.AnotherBucket']).toBeDefined();
    expect(result['Stack1.Bucket']).not.toEqual(result['Stack2.AnotherBucket']);
  });
});

describe(usePrescribedMappings, () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockCloudFormationClient.reset();
  });

  test('generates resource mappings', async () => {
    // GIVEN
    // A set of mappings that includes a source and destination stack
    const mappings = {
      environments: [
        {
          account: '123456789012',
          region: 'us-east-1',
          resources: {
            'Foo.Bucket1': 'Bar.Bucket2',
          },
        },
      ],
    };

    // and the fact that the source stack exists in the environment
    mockCloudFormationClient.on(ListStacksCommand).resolves({
      StackSummaries: [
        {
          StackName: 'Foo',
          StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Foo',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    });

    // and the fact that the logical ID exists in the stack
    mockCloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Foo',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket1: {
              Type: 'AWS::X::Y',
              Properties: {},
            },
          },
        }),
      });

    // WHEN
    const provider = new MockSdkProvider();
    const result = await usePrescribedMappings(mappings.environments, provider);

    // THEN
    // The mappings should be generated correctly, with the template included in the source.
    expect(result).toEqual([
      {
        source: {
          logicalResourceId: 'Bucket1',
          stack: {
            stackName: 'Foo',
            environment: {
              name: '',
              account: '123456789012',
              region: 'us-east-1',
            },
            template: {
              Resources: {
                Bucket1: {
                  Properties: {},
                  Type: 'AWS::X::Y',
                },
              },
            },
          },
        },
        destination: {
          logicalResourceId: 'Bucket2',
          stack: {
            template: {},
            stackName: 'Bar',
            environment: {
              name: '',
              account: '123456789012',
              region: 'us-east-1',
            },
          },
        },
      },
    ]);
  });

  test('mapping with duplicate destinations', async () => {
    // GIVEN
    // A set of mappings with the same destination appearing multiple times

    const mappings = {
      environments: [
        {
          account: '123456789012',
          region: 'us-east-1',
          resources: {
            'Foo.Bucket1': 'Bar.Bucket2',
            'Foo.Bucket3': 'Bar.Bucket2',
          },
        },
      ],
    };

    // and the fact that the source stack exists in the environment
    mockCloudFormationClient.on(ListStacksCommand).resolves({
      StackSummaries: [
        {
          StackName: 'Foo',
          StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Foo',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    });

    // and the fact that the logical ID exists in the stack
    mockCloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Foo',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket1: {
              Type: 'AWS::X::Y',
              Properties: {},
            },
            Bucket3: {
              Type: 'AWS::X::Y',
              Properties: {},
            },
          },
        }),
      });

    // WHEN
    const provider = new MockSdkProvider();

    // THEN
    await expect(usePrescribedMappings(mappings.environments, provider)).rejects.toThrow(
      "Duplicate destination resource 'Bar.Bucket2' in environment 123456789012/us-east-1",
    );
  });

  test('mapping with missing source stack', async () => {
    // GIVEN
    // A set of mappings with a source stack that does not exist
    const mappings = {
      environments: [
        {
          account: '123456789012',
          region: 'us-east-1',
          resources: {
            'Foo.Bucket1': 'Bar.Bucket2',
          },
        },
      ],
    };

    // and the fact that the source stack does not exist in the environment
    mockCloudFormationClient.on(ListStacksCommand).resolves({
      StackSummaries: [],
    });

    // WHEN
    const provider = new MockSdkProvider();

    // THEN
    await expect(usePrescribedMappings(mappings.environments, provider)).rejects.toThrow(
      "Source resource 'Foo.Bucket1' does not exist in environment 123456789012/us-east-1",
    );
  });

  test('destination resource already in use', async () => {
    // GIVEN
    // A set of mappings with a destination resource that is already in use
    const mappings = {
      environments: [
        {
          account: '123456789012',
          region: 'us-east-1',
          resources: {
            'Foo.Bucket1': 'Bar.Bucket2',
          },
        },
      ],
    };

    // and the fact that the source stack exists in the environment
    mockCloudFormationClient.on(ListStacksCommand).resolvesOnce({
      StackSummaries: [
        {
          StackName: 'Foo',
          StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Foo',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
        {
          StackName: 'Bar',
          StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Bar',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    });

    // and the fact that the source logical ID exists in the stack
    mockCloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Foo',
      })
      .resolvesOnce({
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket1: {
              Type: 'AWS::X::Y',
              Properties: {},
            },
          },
        }),
      });

    mockCloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Bar',
      })
      .resolvesOnce({
        TemplateBody: JSON.stringify({
          Resources: {
            // Location 'Bar.Bucket2' is already occupied by this resource
            Bucket2: {
              Type: 'AWS::Z::W',
              Properties: {},
            },
          },
        }),
      });

    // WHEN
    const provider = new MockSdkProvider();

    // THEN
    await expect(usePrescribedMappings(mappings.environments, provider)).rejects.toThrow(
      "Destination resource 'Bar.Bucket2' already in use in environment 123456789012/us-east-1",
    );
  });

  test('mapping with invalid location format', async () => {
    // GIVEN
    // A set of mappings with an invalid location format
    const mappings = {
      environments: [
        {
          account: '123456789012',
          region: 'us-east-1',
          resources: {
            'Foo.Bucket1': 'Bar.Bucket2',
            'InvalidLocation': 'Bar.Bucket3',
          },
        },
      ],
    };

    // and the fact that the source stack exists in the environment
    mockCloudFormationClient.on(ListStacksCommand).resolves({
      StackSummaries: [
        {
          StackName: 'Foo',
          StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Foo',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    });

    // and the fact that the logical ID exists in the stack
    mockCloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Foo',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket1: {
              Type: 'AWS::X::Y',
              Properties: {},
            },
          },
        }),
      });

    // WHEN
    const provider = new MockSdkProvider();

    // THEN
    await expect(usePrescribedMappings(mappings.environments, provider)).rejects.toThrow(
      "Invalid location 'InvalidLocation'",
    );
  });
});

describe(generateStackDefinitions, () => {
  const environment = {
    name: 'test',
    account: '333333333333',
    region: 'us-east-1',
  };

  let mockSdkProvider: MockSdkProvider;
  let mockIoHelper: any;

  beforeEach(() => {
    mockSdkProvider = new MockSdkProvider();
    mockSdkProvider.returnsDefaultAccounts(environment.account);

    // Setup bootstrap stack with S3 bucket for large templates
    const bootstrapStack = mockBootstrapStack();
    mockCloudFormationClient.on(ListStacksCommand).resolves({
      StackSummaries: [
        {
          StackName: 'CDKToolkit',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    });
    mockCloudFormationClient.on(GetTemplateCommand).resolves({
      TemplateBody: JSON.stringify(bootstrapStack.template),
    });

    // Mock ToolkitInfo.lookup to return a valid toolkit
    jest.spyOn(ToolkitInfo, 'lookup').mockResolvedValue(ToolkitInfo.fromStack(bootstrapStack));

    mockIoHelper = {
      defaults: {
        debug: jest.fn(),
      },
    };
  });

  test('moves a resource to another stack that has already been deployed', async () => {
    const deployedStack1: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
          },
          A: {
            Type: 'AWS::A::A',
          },
        },
      },
    };

    const deployedStack2: CloudFormationStack = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          B: {
            Type: 'AWS::B::B',
          },
        },
      },
    };
    const localStack1: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          A: {
            Type: 'AWS::A::A',
          },
        },
      },
    };

    const localStack2: CloudFormationStack = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          B: {
            Type: 'AWS::B::B',
          },
          Bucket2: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const mappings: ResourceMapping[] = [
      new ResourceMapping(
        new ResourceLocation(deployedStack1, 'Bucket1'),
        new ResourceLocation(deployedStack2, 'Bucket2'),
      ),
    ];

    const result = await generateStackDefinitions(
      mappings, [deployedStack1, deployedStack2], [localStack1, localStack2], environment, mockSdkProvider, mockIoHelper,
    );
    expect(result).toEqual([
      {
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            // Wasn't touched by the refactor
            A: {
              Type: 'AWS::A::A',
            },

            // Bucket1 doesn't exist anymore
          },
        }),
      },
      {
        StackName: 'Stack2',
        TemplateBody: JSON.stringify({
          Resources: {
            // Wasn't touched by the refactor
            B: {
              Type: 'AWS::B::B',
            },

            // Old Bucket1 is now Bucket2 here
            Bucket2: {
              Type: 'AWS::S3::Bucket',
            },
          },
        }),
      },
    ]);
  });

  test('with cross-stack references', async () => {
    const deployedStacks: CloudFormationStack[] = [
      {
        environment,
        stackName: 'StackX',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Props: { 'Fn::ImportValue': 'BFromOtherStack' },
              },
            },
          },
        },
      },
      {
        environment,
        stackName: 'StackY',
        template: {
          Outputs: {
            Bout: {
              Value: { Ref: 'B' },
              Export: {
                Name: 'BFromOtherStack',
              },
            },
          },
          Resources: {
            B: { Type: 'AWS::B::B' },
          },
        },
      },
    ];

    const localStacks: CloudFormationStack[] = [
      {
        environment,
        stackName: 'StackX',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Props: { Ref: 'B' },
              },
            },
            B: { Type: 'AWS::B::B' },
          },
        },
      },
      {
        environment,
        stackName: 'StackY',
        template: {
          Resources: {},
        },
      },
    ];

    const mappings: ResourceMapping[] = [
      new ResourceMapping(new ResourceLocation(deployedStacks[1], 'B'), new ResourceLocation(localStacks[0], 'B')),
    ];

    const result = await generateStackDefinitions(mappings, deployedStacks, localStacks, environment, mockSdkProvider, mockIoHelper);
    expect(result).toEqual([
      {
        StackName: 'StackX',
        TemplateBody: JSON.stringify({
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                // The reference has been updated to the moved resource
                Props: { Ref: 'B' },
              },
            },
            B: { Type: 'AWS::B::B' },
          },
        }),
      },
      {
        StackName: 'StackY',
        TemplateBody: JSON.stringify({
          Resources: {},
        }),
      },
    ]);
  });

  test('moves a resource to another stack that has not been deployed', async () => {
    const deployedStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
          },
          A: {
            Type: 'AWS::A::A',
          },
        },
      },
    };

    const localStack1: CloudFormationStack = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          Bucket2: {
            Type: 'AWS::S3::Bucket',
          },
          CDKMetadata: {
            Type: 'AWS::CDK::Metadata',
            Properties: {
              Analytics: 'v2:deflate64:AAA',
            },
            Metadata: {
              'aws:cdk:path': 'Data/CDKMetadata/Default',
            },
          },
        },
      },
    };

    const localStack2: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          A: {
            Type: 'AWS::A::A',
          },
        },
      },
    };

    const mappings: ResourceMapping[] = [
      new ResourceMapping(new ResourceLocation(deployedStack, 'Bucket1'), new ResourceLocation(localStack1, 'Bucket2')),
    ];

    const result = await generateStackDefinitions(mappings, [deployedStack], [localStack1, localStack2], environment, mockSdkProvider, mockIoHelper);
    expect(result).toEqual([
      {
        StackName: 'Stack2',
        TemplateBody: JSON.stringify({
          Resources: {
            // Old Bucket1 is now Bucket2 here
            Bucket2: {
              Type: 'AWS::S3::Bucket',
            },
            // CDKMetadata was not included
          },
        }),
      },
      {
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            // Wasn't touched by the refactor
            A: {
              Type: 'AWS::A::A',
            },

            // Bucket1 doesn't exist anymore
          },
        }),
      },
    ]);
  });

  test('multiple mappings', async () => {
    const deployedStack1: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
          },
          Bucket2: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const deployedStack2: CloudFormationStack = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          Bucket3: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const localStack1: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket6: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const localStack2: CloudFormationStack = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          Bucket4: {
            Type: 'AWS::S3::Bucket',
          },
          Bucket5: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const mappings: ResourceMapping[] = [
      new ResourceMapping(
        new ResourceLocation(deployedStack1, 'Bucket1'),
        new ResourceLocation(deployedStack2, 'Bucket4'),
      ),
      new ResourceMapping(
        new ResourceLocation(deployedStack1, 'Bucket2'),
        new ResourceLocation(deployedStack2, 'Bucket5'),
      ),
      new ResourceMapping(
        new ResourceLocation(deployedStack2, 'Bucket3'),
        new ResourceLocation(deployedStack1, 'Bucket6'),
      ),
    ];

    const result = await generateStackDefinitions(
      mappings, [deployedStack1, deployedStack2], [localStack1, localStack2], environment, mockSdkProvider, mockIoHelper,
    );
    expect(result).toEqual([
      {
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket6: {
              Type: 'AWS::S3::Bucket',
            },
          },
        }),
      },
      {
        StackName: 'Stack2',
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket4: {
              Type: 'AWS::S3::Bucket',
            },
            Bucket5: {
              Type: 'AWS::S3::Bucket',
            },
          },
        }),
      },
    ]);
  });

  test('deployed stacks that are not in any mapping', async () => {
    const deployedStack1: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const deployedStack2: CloudFormationStack = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          Bucket2: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const localStack1: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket3: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const localStack2: CloudFormationStack = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          Bucket2: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const mappings: ResourceMapping[] = [
      new ResourceMapping(
        new ResourceLocation(deployedStack1, 'Bucket1'),
        new ResourceLocation(deployedStack1, 'Bucket3'),
      ),
    ];

    const result = await generateStackDefinitions(
      mappings, [deployedStack1, deployedStack2], [localStack1, localStack2], environment, mockSdkProvider, mockIoHelper,
    );
    expect(result).toEqual([
      {
        // Stack2 and Stack3 are not involved in the refactoring. Only Stack1 is.
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket3: {
              Type: 'AWS::S3::Bucket',
            },
          },
        }),
      },
    ]);
  });

  test('stack definitions come from the local templates', async () => {
    const deployedStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              Foo: 'Bar',
            },
          },
          CDKMetadata: {
            Type: 'AWS::CDK::Metadata',
            Properties: {
              Analytics: 'v2:deflate64:deployed',
            },
            Metadata: {
              'aws:cdk:path': 'Stack1/CDKMetadata/Default',
            },
          },
        },
      },
    };

    const localStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket2: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              Foo: 'Bar',
            },
          },
          CDKMetadata: {
            Type: 'AWS::CDK::Metadata',
            Properties: {
              Analytics: 'v2:deflate64:local',
            },
            Metadata: {
              'aws:cdk:path': 'Stack1/CDKMetadata/Default',
            },
          },
        },
      },
    };

    const mappings: ResourceMapping[] = [
      new ResourceMapping(
        new ResourceLocation(deployedStack, 'Bucket1'),
        new ResourceLocation(deployedStack, 'Bucket2'),
      ),
    ];

    const result = await generateStackDefinitions(mappings, [deployedStack], [localStack], environment, mockSdkProvider, mockIoHelper);
    expect(result).toEqual([
      {
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            // For regular resources, we pick the local one
            Bucket2: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                Foo: 'Bar',
              },
            },
            CDKMetadata: {
              Type: 'AWS::CDK::Metadata',
              Properties: {
                // But for CDKMetadata, we pick the deployed one
                Analytics: 'v2:deflate64:deployed',
              },
              Metadata: {
                'aws:cdk:path': 'Stack1/CDKMetadata/Default',
              },
            },
          },
        }),
      },
    ]);
  });

  test('Rules and Parameters are removed for new stacks', async () => {
    const deployedStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              Foo: 'Bar',
            },
          },
          Bucket2: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              Foo: 'Zee',
            },
          },
        },
      },
    };

    const localStack1: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              Foo: 'Bar',
            },
          },
        },
      },
    };

    const localStack2: CloudFormationStack = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          // Moved out of the original stack to a new one.
          Bucket2: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              Foo: 'Zee',
            },
          },
        },
        Rules: {
          CheckBootstrapVersion: {
            Assertions: [],
          },
        },
        Parameters: {
          BootstrapVersion: {
            Type: 'AWS::SSM::Parameter::Value<String>',
            Default: '/cdk-bootstrap/hnb659fds/version',
            Description: 'Version of the CDK Bootstrap resources in this environment, automatically retrieved from SSM Parameter Store. [cdk:skip]',
          },
        },
      },
    };

    const mappings: ResourceMapping[] = [
      new ResourceMapping(new ResourceLocation(deployedStack, 'Bucket2'), new ResourceLocation(localStack2, 'Bucket2')),
    ];

    const result = await generateStackDefinitions(mappings, [deployedStack], [localStack1, localStack2], environment, mockSdkProvider, mockIoHelper);
    expect(result).toEqual([
      {
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket1: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                Foo: 'Bar',
              },
            },
          },
        }),
      },
      {
        StackName: 'Stack2',
        // No Rules or Parameters, even though they are present in the local stack
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket2: {
              Type: 'AWS::S3::Bucket',
              Properties: { Foo: 'Zee' },
            },
          },
        }),
      },
    ]);
  });

  test('uploads large templates to S3 and uses TemplateURL', async () => {
    // Create a large template (over 50KB)
    const largeResources: any = {};
    // Generate enough resources to exceed 50KB
    for (let i = 0; i < 500; i++) {
      largeResources[`Bucket${i}`] = {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: `my-bucket-${i}`,
          Tags: [
            { Key: 'Environment', Value: 'Production' },
            { Key: 'Application', Value: 'MyApp' },
            { Key: 'Owner', Value: 'TeamA' },
            { Key: 'CostCenter', Value: '12345' },
          ],
        },
      };
    }

    const deployedStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const localStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: largeResources,
      },
    };

    const mappings: ResourceMapping[] = [];

    const result = await generateStackDefinitions(
      mappings, [deployedStack], [localStack], environment, mockSdkProvider, mockIoHelper,
    );

    // Verify that TemplateURL is used instead of TemplateBody for large templates
    expect(result).toHaveLength(1);
    expect(result[0].StackName).toBe('Stack1');
    expect(result[0].TemplateURL).toBeDefined();
    expect(result[0].TemplateURL).toContain('cdk-refactor/Stack1/');
    expect(result[0].TemplateBody).toBeUndefined();

    // Verify the template size is indeed over 50KB
    const templateSize = JSON.stringify(largeResources).length;
    expect(templateSize).toBeGreaterThan(50 * 1024);
  });

  test('uses TemplateBody for small templates', async () => {
    // Create a small template (under 50KB)
    const smallResources: any = {
      Bucket1: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: 'my-bucket',
        },
      },
      Bucket2: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: 'my-other-bucket',
        },
      },
    };

    const deployedStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
          },
        },
      },
    };

    const localStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: smallResources,
      },
    };

    const mappings: ResourceMapping[] = [];

    const result = await generateStackDefinitions(
      mappings, [deployedStack], [localStack], environment, mockSdkProvider, mockIoHelper,
    );

    // Verify that TemplateBody is used for small templates
    expect(result).toHaveLength(1);
    expect(result[0].StackName).toBe('Stack1');
    expect(result[0].TemplateBody).toBeDefined();
    expect(result[0].TemplateURL).toBeUndefined();

    // Verify the template size is under 50KB
    const templateSize = JSON.stringify(smallResources).length;
    expect(templateSize).toBeLessThan(50 * 1024);
  });
});
