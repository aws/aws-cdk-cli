const mockLoadResourceModel = jest.fn();
jest.mock('@aws-cdk/cloudformation-diff/lib/diff/util', () => ({
  loadResourceModel: mockLoadResourceModel,
}));

import { GetTemplateCommand, ListStacksCommand } from '@aws-sdk/client-cloudformation';
import { expect } from '@jest/globals';
import { usePrescribedMappings } from '../../../lib/api/refactoring';
import type { CloudFormationStack, CloudFormationTemplate } from '../../../lib/api/refactoring/cloudformation';
import { ResourceLocation, ResourceMapping } from '../../../lib/api/refactoring/cloudformation';
import { computeResourceDigests } from '../../../lib/api/refactoring/digest';
import { generateStackDefinitions } from '../../../lib/api/refactoring/stack-definitions';
import { MockSdkProvider, mockCloudFormationClient } from '../../_helpers/mock-sdk';

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

  test('renames a resource within the same stack', () => {
    const stack1: CloudFormationStack = {
      environment: environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
          },
          NotInvolved: {
            Type: 'AWS::X::Y',
          },
          Consumer: {
            Type: 'AWS::X::Y',
            Properties: {
              Bucket: { Ref: 'Bucket1' },
            },
          },
        },
      },
    };

    const stack2: CloudFormationStack = {
      environment: environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Bucket2: {
            Type: 'AWS::S3::Bucket',
          },
          NotInvolved: {
            Type: 'AWS::X::Y',
          },
          Consumer: {
            Type: 'AWS::X::Y',
            Properties: {
              Bucket: { Ref: 'Bucket2' },
            },
          },
        },
      },
    };

    const mappings: ResourceMapping[] = [
      new ResourceMapping(new ResourceLocation(stack1, 'Bucket1'), new ResourceLocation(stack1, 'Bucket2')),
    ];

    const result = generateStackDefinitions(mappings, [stack1], [stack2]);
    expect(result).toEqual([
      {
        StackName: 'Foo',
        TemplateBody: JSON.stringify({
          Resources: {
            Consumer: {
              Type: 'AWS::X::Y',
              Properties: {
                // The reference has also been updated
                Bucket: { Ref: 'Bucket2' },
              },
            },
            Bucket2: {
              Type: 'AWS::S3::Bucket',
            },
            // Not involved in the refactor, but still part of the
            // original template. Should be included.
            NotInvolved: {
              Type: 'AWS::X::Y',
            },
          },
        }),
      },
    ]);
  });

  test('moves a resource to another stack that has already been deployed', () => {
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

    const result = generateStackDefinitions(
      mappings,
      [deployedStack1, deployedStack2],
      [localStack1, localStack2],
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
            // Old Bucket1 is now Bucket2 here
            Bucket2: {
              Type: 'AWS::S3::Bucket',
            },

            // Wasn't touched by the refactor
            B: {
              Type: 'AWS::B::B',
            },
          },
        }),
      },
    ]);
  });

  test('moves a resource to another stack that has not been deployed', () => {
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

    const result = generateStackDefinitions(mappings, [deployedStack], [localStack1, localStack2]);
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
            // Old Bucket1 is now Bucket2 here
            Bucket2: {
              Type: 'AWS::S3::Bucket',
            },
          },
        }),
      },
    ]);
  });

  test('multiple mappings', () => {
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

    const result = generateStackDefinitions(
      mappings,
      [deployedStack1, deployedStack2],
      [localStack1, localStack2],
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

  test('deployed stacks that are not in any mapping', () => {
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

    const result = generateStackDefinitions(
      mappings,
      [deployedStack1, deployedStack2],
      [localStack1, localStack2],
    );
    expect(result).toEqual([
      {
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

  test('local stacks have more resources than deployed stacks', async () => {
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
        Resources: {
          Bucket2: {
            Type: 'AWS::S3::Bucket',
          },
          ExtraStuff: {
            Type: 'AWS::X::Y',
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

    const result = generateStackDefinitions(mappings, [deployedStack], [localStack]);
    expect(result).toEqual([
      {
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket2: {
              Type: 'AWS::S3::Bucket',
            },
            // ExtraStuff is not involved in the refactor and was not part of the deployed stack, so we keep it out.
          },
        }),
      },
    ]);
  });

  test('local stacks have fewer resources than deployed stacks', () => {
    const deployedStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
          },
          ExtraStuff: {
            Type: 'AWS::X::Y',
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

    const result = generateStackDefinitions(mappings, [deployedStack], [localStack]);
    expect(result).toEqual([
      {
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket2: {
              Type: 'AWS::S3::Bucket',
            },
            // ExtraStuff is not involved in the refactor, but it was part of the deployed stack, so we keep it in.
            ExtraStuff: {
              Type: 'AWS::X::Y',
            },
          },
        }),
      },
    ]);
  });

  test('CDK path in Metadata is preserved', () => {
    const deployedStack: CloudFormationStack = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Metadata: {
              'aws:cdk:path': 'Stack1/Bucket1/Resource',
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
            Metadata: {
              // Here the CDK path is consistent with the new logical ID...
              'aws:cdk:path': 'Stack1/Bucket2/Resource',
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

    const result = generateStackDefinitions(mappings, [deployedStack], [localStack]);
    expect(result).toEqual([
      {
        StackName: 'Stack1',
        TemplateBody: JSON.stringify({
          Resources: {
            Bucket2: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                // ...but we keep the original CDK path from the deployed stack, to make CloudFormation happy.
                'aws:cdk:path': 'Stack1/Bucket1/Resource',
              },
            },
          },
        }),
      },
    ]);
  });

  describe('With references between resources', () => {
    describe('Divergence - reference starts within the same stack and, in some cases, crosses stacks', () => {
      test('No stack move', () => {
        const deployedStacks: CloudFormationStack[] = [
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
                B: {
                  Type: 'AWS::B::B',
                },
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
                    Props: { Ref: 'Bn' },
                  },
                },
                Bn: {
                  Type: 'AWS::B::B',
                },
              },
            },
          },
        ];

        const mappings: ResourceMapping[] = [
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'B'), new ResourceLocation(localStacks[0], 'Bn')),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
        expect(result).toEqual([
          {
            StackName: 'StackX',
            TemplateBody: JSON.stringify({
              Resources: {
                A: {
                  Type: 'AWS::A::A',
                  Properties: {
                    Props: { Ref: 'Bn' }, // Updated reference
                  },
                },
                Bn: {
                  Type: 'AWS::B::B',
                },
              },
            }),
          },
        ]);
      });

      test('tail of the reference moved', () => {
        const deployedStacks: CloudFormationStack[] = [
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
                B: {
                  Type: 'AWS::B::B',
                },
              },
            },
          },
        ];

        const localStacks: CloudFormationStack[] = [
          {
            environment,
            stackName: 'StackY',
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
            stackName: 'StackX',
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

        const mappings: ResourceMapping[] = [
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'A'), new ResourceLocation(localStacks[0], 'A')),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
        expect(result).toEqual([
          {
            StackName: 'StackY',
            TemplateBody: JSON.stringify({
              Resources: {
                A: {
                  Type: 'AWS::A::A',
                  Properties: {
                    Props: { 'Fn::ImportValue': 'BFromOtherStack' }, // Reference to the moved resource
                  },
                },
              },
            }),
          },
          {
            StackName: 'StackX',
            TemplateBody: JSON.stringify({
              Resources: {
                B: { Type: 'AWS::B::B' }, // The moved resource
              },
              Outputs: {
                Bout: {
                  Value: { Ref: 'B' },
                  Export: {
                    Name: 'BFromOtherStack',
                  },
                },
              },
            }),
          },
        ]);
      });

      test('head of the reference moved', () => {
        const deployedStacks: CloudFormationStack[] = [
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
                B: {
                  Type: 'AWS::B::B',
                },
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

        const mappings: ResourceMapping[] = [
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'B'), new ResourceLocation(localStacks[1], 'B')),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
        expect(result).toEqual([
          {
            StackName: 'StackX',
            TemplateBody: JSON.stringify({
              Resources: {
                // A was moved
                A: {
                  Type: 'AWS::A::A',
                  Properties: {
                    Props: { 'Fn::ImportValue': 'BFromOtherStack' }, // Reference to the resource that stayed behind
                  },
                },
              },
            }),
          },
          {
            StackName: 'StackY',
            TemplateBody: JSON.stringify({
              Resources: {
                B: { Type: 'AWS::B::B' },
              },
              Outputs: {
                Bout: {
                  Value: { Ref: 'B' },
                  Export: {
                    Name: 'BFromOtherStack',
                  },
                },
              },
            }),
          },
        ]);
      });

      test('both moved to the same stack', () => {
        const deployedStacks: CloudFormationStack[] = [
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
                B: {
                  Type: 'AWS::B::B',
                },
                C: {
                  Type: 'AWS::C::C',
                },
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
                C: {
                  Type: 'AWS::C::C',
                },
              },
            },
          },
          {
            environment,
            stackName: 'StackY',
            template: {
              Resources: {
                A: {
                  Type: 'AWS::A::A',
                  Properties: {
                    Props: { Ref: 'B' },
                  },
                },
                B: {
                  Type: 'AWS::B::B',
                },
              },
            },
          },
        ];

        const mappings: ResourceMapping[] = [
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'B'), new ResourceLocation(localStacks[1], 'B')),
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'A'), new ResourceLocation(localStacks[1], 'A')),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
        expect(result).toEqual([
          {
            StackName: 'StackY',
            TemplateBody: JSON.stringify({
              Resources: {
                A: {
                  Type: 'AWS::A::A',
                  Properties: {
                    Props: { Ref: 'B' },
                  },
                },
                B: { Type: 'AWS::B::B' },
              },
            }),
          },
          {
            StackName: 'StackX',
            TemplateBody: JSON.stringify({
              Resources: {
                C: {
                  Type: 'AWS::C::C',
                },
              },
            }),
          },
        ]);
      });

      test('both moved to different stacks', () => {
        const deployedStacks: CloudFormationStack[] = [
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
                B: {
                  Type: 'AWS::B::B',
                },
                C: {
                  Type: 'AWS::C::C',
                },
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
                C: {
                  Type: 'AWS::C::C',
                },
              },
            },
          },
          {
            environment,
            stackName: 'StackY',
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
            stackName: 'StackZ',
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
                B: {
                  Type: 'AWS::B::B',
                },
              },
            },
          },
        ];

        const mappings: ResourceMapping[] = [
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'A'), new ResourceLocation(localStacks[1], 'A')),
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'B'), new ResourceLocation(localStacks[2], 'B')),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
        expect(result).toEqual([
          {
            StackName: 'StackY',
            TemplateBody: JSON.stringify({
              Resources: {
                A: {
                  Type: 'AWS::A::A',
                  Properties: {
                    Props: { 'Fn::ImportValue': 'BFromOtherStack' },
                  },
                },
              },
            }),
          },
          {
            StackName: 'StackZ',
            TemplateBody: JSON.stringify({
              Resources: {
                B: {
                  Type: 'AWS::B::B',
                },
              },
              Outputs: {
                Bout: {
                  Value: { Ref: 'B' },
                  Export: {
                    Name: 'BFromOtherStack',
                  },
                },
              },
            }),
          },
          {
            StackName: 'StackX',
            TemplateBody: JSON.stringify({
              Resources: {
                C: {
                  Type: 'AWS::C::C',
                },
              },
            }),
          },
        ]);
      });
    });

    describe('Convergence - reference starts cross-stack and, in some cases, moves to within the same stack', () => {
      test('No stack move', () => {
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
                    Props: { 'Fn::ImportValue': 'BnFromOtherStack' },
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
                  Value: { Ref: 'Bn' },
                  Export: {
                    Name: 'BnFromOtherStack',
                  },
                },
              },
              Resources: {
                Bn: { Type: 'AWS::B::B' },
              },
            },
          },
        ];

        const mappings: ResourceMapping[] = [
          new ResourceMapping(
            new ResourceLocation(deployedStacks[1], 'B'),
            new ResourceLocation(deployedStacks[1], 'Bn'),
          ),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
        expect(result).toEqual([
          {
            StackName: 'StackX',
            TemplateBody: JSON.stringify({
              Resources: {
                A: {
                  Type: 'AWS::A::A',
                  Properties: { Props: { 'Fn::ImportValue': 'BnFromOtherStack' } },
                },
              },
            }),
          },
          {
            StackName: 'StackY',
            TemplateBody: JSON.stringify({
              Outputs: {
                Bout: {
                  Value: { Ref: 'Bn' },
                  Export: {
                    Name: 'BnFromOtherStack',
                  },
                },
              },
              Resources: {
                Bn: { Type: 'AWS::B::B' },
              },
            }),
          },
        ]);
      });

      test('tail of the reference moved', () => {
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
            stackName: 'StackY',
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
        ];

        const mappings: ResourceMapping[] = [
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'A'), new ResourceLocation(localStacks[0], 'A')),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
        expect(result).toEqual([
          {
            StackName: 'StackY',
            TemplateBody: JSON.stringify({
              Outputs: {
                Bout: { Value: { Ref: 'B' }, Export: { Name: 'BFromOtherStack' } },
              },
              Resources: {
                A: { Type: 'AWS::A::A', Properties: { Props: { Ref: 'B' } } },
                B: { Type: 'AWS::B::B' },
              },
            }),
          },
          {
            StackName: 'StackX',
            TemplateBody: JSON.stringify({ Resources: {} }),
          },
        ]);
      });

      test('head of the reference moved', () => {
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
        ];

        const mappings: ResourceMapping[] = [
          new ResourceMapping(new ResourceLocation(deployedStacks[1], 'B'), new ResourceLocation(localStacks[0], 'B')),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
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
              Outputs: {
                Bout: {
                  Value: { Ref: 'B' },
                  Export: { Name: 'BFromOtherStack' },
                },
              },
              Resources: {},
            }),
          },
        ]);
      });

      test('both moved', () => {
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
            // This is a third stack that will receive both resources
            stackName: 'StackZ',
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
        ];

        const mappings: ResourceMapping[] = [
          new ResourceMapping(new ResourceLocation(deployedStacks[0], 'A'), new ResourceLocation(localStacks[0], 'A')),
          new ResourceMapping(new ResourceLocation(deployedStacks[1], 'B'), new ResourceLocation(localStacks[0], 'B')),
        ];

        const result = generateStackDefinitions(mappings, deployedStacks, localStacks);
        expect(result).toEqual([
          {
            StackName: 'StackZ',
            TemplateBody: JSON.stringify({
              Resources: {
                A: {
                  Type: 'AWS::A::A',
                  Properties: {
                    Props: { Ref: 'B' },
                  },
                },
                B: { Type: 'AWS::B::B' },
              },
            }),
          },
          {
            StackName: 'StackX',
            TemplateBody: JSON.stringify({ Resources: {} }),
          },
          {
            StackName: 'StackY',
            TemplateBody: JSON.stringify({
              Outputs: {
                Bout: {
                  Value: { Ref: 'B' },
                  Export: { Name: 'BFromOtherStack' },
                },
              },
              Resources: {},
            }),
          },
        ]);
      });
    });
  });

  describe('Local and deployed resources are not identical', () => {
    // This may happen if the resource has a physical ID defined, which gives
    // the user freedom to change the resource properties, while the matching
    // algorithm still recognizes them as being the same.

    test('deployed resource configuration prevails', () => {
      const deployedStack: CloudFormationStack = {
        environment: environment,
        stackName: 'Foo',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Prop: { Ref: 'B' },
                Prop2: { 'Fn::GetAtt': ['C', 'Banana'] },
                Prop3: { 'Fn::Sub': ['${C} ${SomeVar} ${B.foo}', { SomeVar: { Ref: 'B' } }] },
                Foo: 123,
              },
              DependsOn: ['D'],
            },
            B: {
              Type: 'AWS::B::B',
              Properties: {
                Foo: 123,
              },
            },
            C: {
              Type: 'AWS::C::C',
              Properties: {
                Banana: 'BananaValue',
              },
            },
            D: {
              Type: 'AWS::D::D',
              Properties: {
                Foo: 123,
              },
            },
          },
        },
      };

      const localStack: CloudFormationStack = {
        environment: environment,
        stackName: 'Foo',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Prop: { Ref: 'Bn' },
                Prop2: { 'Fn::GetAtt': ['Cn', 'Banana'] },
                Prop3: { 'Fn::Sub': ['${Cn} ${SomeVar} ${Bn.foo}', { SomeVar: { Ref: 'Bn' } }] },
                Bar: 456, // Different property
              },
              DependsOn: ['Dn'],
            },
            Bn: {
              Type: 'AWS::B::B',
              Properties: {
                Bar: 456,
              },
            },
            Cn: {
              Type: 'AWS::C::C',
              Properties: {
                Banana: 'BananaValue',
              },
            },
            Dn: {
              Type: 'AWS::D::D',
              Properties: {
                Bar: 456,
              },
            },
          },
        },
      };

      const mappings: ResourceMapping[] = [
        new ResourceMapping(new ResourceLocation(deployedStack, 'B'), new ResourceLocation(deployedStack, 'Bn')),
        new ResourceMapping(new ResourceLocation(deployedStack, 'C'), new ResourceLocation(deployedStack, 'Cn')),
        new ResourceMapping(new ResourceLocation(deployedStack, 'D'), new ResourceLocation(deployedStack, 'Dn')),
      ];

      const result = generateStackDefinitions(mappings, [deployedStack], [localStack]);
      expect(result).toEqual([
        {
          StackName: 'Foo',
          TemplateBody: JSON.stringify({
            Resources: {
              A: {
                Type: 'AWS::A::A',
                Properties: {
                  Prop: { Ref: 'Bn' },
                  Prop2: { 'Fn::GetAtt': ['Cn', 'Banana'] },
                  Prop3: { 'Fn::Sub': ['${Cn} ${SomeVar} ${Bn.foo}', { SomeVar: { Ref: 'Bn' } }] },
                  Foo: 123,
                },
                DependsOn: ['Dn'],
              },
              Dn: {
                Type: 'AWS::D::D',
                Properties: {
                  Foo: 123,
                },
              },
              Bn: {
                Type: 'AWS::B::B',
                Properties: {
                  Foo: 123,
                },
              },
              Cn: {
                Type: 'AWS::C::C',
                Properties: {
                  Banana: 'BananaValue',
                },
              },
            },
          }),
        },
      ]);
    });

    test('within -> cross', () => {
      const deployedStack: CloudFormationStack = {
        environment: environment,
        stackName: 'Foo',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Prop: { Ref: 'B' }, // Reference to a resource in the same stack
                Foo: 123,
              },
              DependsOn: 'B',
            },
            B: {
              Type: 'AWS::B::B',
              Properties: {
                Foo: 123,
              },
            },
          },
        },
      };

      const localStack1: CloudFormationStack = {
        environment: environment,
        stackName: 'Foo',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Prop: { 'Fn::ImportValue': 'BFromOtherStack' }, // Reference to a resource in the same stack
                Bar: 456, // Different property
              },
            },
          },
        },
      };

      const localStack2: CloudFormationStack = {
        environment: environment,
        stackName: 'Bar',
        template: {
          Outputs: {
            Bout: {
              Value: { Ref: 'Bn' },
              Export: {
                Name: 'BFromOtherStack',
              },
            },
          },
          Resources: {
            Bn: {
              Type: 'AWS::B::B',
              Properties: {
                Bar: 456,
              },
            },
          },
        },
      };

      const mappings: ResourceMapping[] = [
        new ResourceMapping(new ResourceLocation(deployedStack, 'B'), new ResourceLocation(localStack2, 'Bn')),
      ];

      const result = generateStackDefinitions(mappings, [deployedStack], [localStack1, localStack2]);
      expect(result).toEqual([
        {
          StackName: 'Foo',
          TemplateBody: JSON.stringify({
            Resources: {
              A: {
                Type: 'AWS::A::A',
                Properties: {
                  Prop: { 'Fn::ImportValue': 'BFromOtherStack' }, // Reference to the moved resource
                  Foo: 123, // But we keep the original property from the deployed stack
                },
                // Note the absence of DependsOn
              },
            },
          }),
        },
        {
          StackName: 'Bar',
          TemplateBody: JSON.stringify({
            Resources: {
              Bn: {
                Type: 'AWS::B::B',
                Properties: {
                  Foo: 123,
                },
              },
            },
            Outputs: {
              Bout: {
                Value: { Ref: 'Bn' },
                Export: {
                  Name: 'BFromOtherStack',
                },
              },
            },
          }),
        },
      ]);
    });

    test('cross -> within', () => {
      const deployedStack1: CloudFormationStack = {
        environment: environment,
        stackName: 'Foo',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Prop: { 'Fn::ImportValue': 'BFromOtherStack' }, // Reference to a resource in the same stack
                Foo: 123,
              },
            },
          },
        },
      };

      const deployedStack2: CloudFormationStack = {
        environment: environment,
        stackName: 'Bar',
        template: {
          Outputs: {
            Bout: {
              Value: { Ref: 'Bn' },
              Export: {
                Name: 'BFromOtherStack',
              },
            },
          },
          Resources: {
            Bn: {
              Type: 'AWS::B::B',
              Properties: {
                Foo: 123,
              },
            },
          },
        },
      };

      const localStack: CloudFormationStack = {
        environment: environment,
        stackName: 'Foo',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Prop: { Ref: 'B' },
                Bar: 456,
              },
            },
            B: {
              Type: 'AWS::B::B',
              Properties: {
                Bar: 456,
              },
            },
          },
        },
      };

      const mappings: ResourceMapping[] = [
        new ResourceMapping(new ResourceLocation(deployedStack2, 'Bn'), new ResourceLocation(localStack, 'B')),
      ];

      const result = generateStackDefinitions(mappings, [deployedStack1, deployedStack2], [localStack]);
      expect(result).toEqual([
        {
          StackName: 'Foo',
          TemplateBody: JSON.stringify({
            Resources: {
              A: {
                Type: 'AWS::A::A',
                Properties: {
                  Prop: { Ref: 'B' },
                  Foo: 123, // We keep the original property from the deployed stack
                },
              },
              B: {
                Type: 'AWS::B::B',
                Properties: {
                  Foo: 123, // We keep the original property from the deployed stack
                },
              },
            },
          }),
        },
        {
          StackName: 'Bar',
          TemplateBody: JSON.stringify({
            Outputs: {
              Bout: {
                Value: { Ref: 'Bn' },
                Export: { Name: 'BFromOtherStack' },
              },
            },
            Resources: {},
          }),
        },
      ]);
    });

    test('cross -> cross', () => {
      const deployedStack1: CloudFormationStack = {
        environment: environment,
        stackName: 'Foo',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Prop: { 'Fn::ImportValue': 'BFromOtherStack' }, // Reference to a resource in the same stack
                Foo: 123,
              },
            },
          },
        },
      };

      const deployedStack2: CloudFormationStack = {
        environment: environment,
        stackName: 'Bar',
        template: {
          Outputs: {
            Bout: {
              Value: { Ref: 'Bn' },
              Export: {
                Name: 'BFromOtherStack',
              },
            },
          },
          Resources: {
            Bn: {
              Type: 'AWS::B::B',
              Properties: {
                Foo: 123,
              },
            },
          },
        },
      };

      const localStack1: CloudFormationStack = {
        environment: environment,
        stackName: 'Foo',
        template: {
          Resources: {
            A: {
              Type: 'AWS::A::A',
              Properties: {
                Prop: { 'Fn::ImportValue': 'BFromOtherStack' },
                Bar: 456,
              },
            },
          },
        },
      };

      const localStack2: CloudFormationStack = {
        environment: environment,
        stackName: 'Zee',
        template: {
          Outputs: {
            Bout: {
              Value: { Ref: 'Bn2' },
              Export: {
                Name: 'BFromOtherStack',
              },
            },
          },
          Resources: {
            Bn2: {
              Type: 'AWS::B::B',
              Properties: {
                Bar2: 456,
              },
            },
          },
        },
      };

      const mappings: ResourceMapping[] = [
        new ResourceMapping(new ResourceLocation(deployedStack2, 'Bn'), new ResourceLocation(localStack2, 'Bn2')),
      ];

      const result = generateStackDefinitions(
        mappings,
        [deployedStack1, deployedStack2],
        [localStack1, localStack2],
      );
      expect(result).toEqual([
        {
          StackName: 'Foo',
          TemplateBody: JSON.stringify({
            Resources: {
              A: {
                Type: 'AWS::A::A',
                Properties: { Prop: { 'Fn::ImportValue': 'BFromOtherStack' }, Foo: 123 },
              },
            },
          }),
        },
        {
          StackName: 'Zee',
          TemplateBody: JSON.stringify({
            Resources: {
              Bn2: {
                Type: 'AWS::B::B',
                Properties: {
                  Foo: 123,
                },
              },
            },
            Outputs: {
              Bout: {
                Value: { Ref: 'Bn2' },
                Export: {
                  Name: 'BFromOtherStack',
                },
              },
            },
          }),
        },
        {
          StackName: 'Bar',
          TemplateBody: JSON.stringify({
            Outputs: {
              Bout: {
                Value: { Ref: 'Bn' },
                Export: { Name: 'BFromOtherStack' },
              },
            },
            Resources: {},
          }),
        },
      ]);
    });
  });
});

