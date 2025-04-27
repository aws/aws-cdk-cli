const mockLoadResourceModel = jest.fn();
jest.mock('@aws-cdk/cloudformation-diff/lib/diff/util', () => ({
  loadResourceModel: mockLoadResourceModel,
}));

import {
  GetTemplateCommand,
  ListStacksCommand,
  ResourceLocation as CfnResourceLocation,
  ResourceMapping as CfnResourceMapping,
} from '@aws-sdk/client-cloudformation';
import {
  ambiguousMovements,
  findResourceMovements,
  ResourceLocation,
  ResourceMapping,
  resourceMappings,
  resourceMovements,
} from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/refactoring';
import { computeResourceDigests } from '../../../../@aws-cdk/tmp-toolkit-helpers/src/api/refactoring/digest';
import { mockCloudFormationClient, MockSdkProvider } from '../../_helpers/mock-sdk';
import { expect } from '@jest/globals';

const cloudFormationClient = mockCloudFormationClient;

describe('computeResourceDigests', () => {
  test('returns empty map for empty template', () => {
    const template = {};
    const result = computeResourceDigests(template);
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
    const result = computeResourceDigests(template);
    expect(Object.keys(result).length).toBe(1);
    expect(result['MyResource']).toBeDefined();
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
    const result = computeResourceDigests(template);
    expect(Object.keys(result).length).toBe(1);
    expect(result['MyResource']).toBeDefined();
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
    const result = computeResourceDigests(template);
    expect(Object.keys(result).length).toBe(2);
    expect(result['MyResource1']).toEqual(result['MyResource2']);
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
    const result = computeResourceDigests(template);
    expect(Object.keys(result).length).toBe(2);
    expect(result['Bucket']).toBeDefined();
    expect(result['Topic']).toBeDefined();
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
    const result = computeResourceDigests(template);
    expect(result['Q1']).not.toBe(result['Q2']);
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
    const result = computeResourceDigests(template);
    expect(Object.keys(result).length).toBe(2);
    expect(result['Bucket1']).toBe(result['Bucket2']);
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
    const result = computeResourceDigests(template);
    expect(result['Bucket1']).toBe(result['Bucket2']);
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
    const result = computeResourceDigests(template);
    expect(result['Topic1']).toEqual(result['Topic2']);
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
    const result = computeResourceDigests(template);
    expect(result['Topic1']).not.toEqual(result['Topic2']);
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
    const result = computeResourceDigests(template);
    expect(result['Bucket1']).not.toBe(result['Bucket2']);
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
    const result = computeResourceDigests(template);
    expect(Object.keys(result).length).toBe(1);
    expect(result['MyResource']).toBeDefined();
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
    const result = computeResourceDigests(template);
    expect(result['Q1']).toBe(result['Q2']);
  });

  test('uses physical ID if present', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName']
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
            FooName: 'XXXXXXXXX',
            ShouldAlsoBeIgnored: true,
          },
        },
      },
    };

    const result = computeResourceDigests(template);
    expect(result['Foo1']).toBe(result['Foo2']);
  });

  test('uses physical ID if present - with dependencies', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName']
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
            FooName: 'XXXXXXXXX',
            ShouldAlsoBeIgnored: true,
          },
        },
        Bucket1: {
          Type: 'AWS::S3::Bucket',
          Properties: { Dep: { Ref: 'Foo1' } },
        },
        Bucket2: {
          Type: 'AWS::S3::Bucket',
          Properties: { Dep: { Ref: 'Foo2' } },
        },
      },
    };

    const result = computeResourceDigests(template);
    expect(result['Bucket1']).toBe(result['Bucket2']);
  });

  test('different physical IDs lead to different digests', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName']
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

    const result = computeResourceDigests(template);
    expect(result['Foo1']).not.toBe(result['Foo2']);
  });

  test('primaryIdentifier is a composite field - different values', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName', 'BarName']
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

    const result = computeResourceDigests(template);
    expect(result['Foo1']).not.toBe(result['Foo2']);
  });

  test('primaryIdentifier is a composite field - same value', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName', 'BarName']
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
            BarName: 'YYYYYYYYY',
            ShouldAlsoBeIgnored: true,
          },
        },
      },
    };

    const result = computeResourceDigests(template);
    expect(result['Foo1']).toBe(result['Foo2']);
  });

  test('primaryIdentifier is a composite field but not all of them are set in the resource', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName', 'BarName']
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
            FooName: 'XXXXXXXXX',
            ShouldAlsoBeIgnored: true,
          },
        },
      },
    };

    const result = computeResourceDigests(template);
    expect(result['Foo1']).not.toBe(result['Foo2']);
  });

  test('resource properties does not contain primaryIdentifier - different values', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName']
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

    const result = computeResourceDigests(template);
    expect(result['Foo1']).not.toBe(result['Foo2']);
  });

  test('resource properties does not contain primaryIdentifier - same value', () => {
    mockLoadResourceModel.mockReturnValue({
      primaryIdentifier: ['FooName']
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

    const result = computeResourceDigests(template);
    expect(result['Foo1']).toBe(result['Foo2']);
  });
});

describe('typed mappings', () => {
  // The environment isn't important for these tests
  // Using the same for all stacks
  const environment = {
    name: 'prod',
    account: '123456789012',
    region: 'us-east-1',
  };

  test('returns empty mappings for identical sets of stacks', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);
    expect(mappings).toEqual([]);
  });

  test('returns empty mappings when there are only removals', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Foo',
      template: {
        // Resource was removed
        Resources: {},
      },
    };

    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);
    expect(mappings).toEqual([]);
  });

  test('returns empty mappings when there are only additions', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {},
      },
    };

    const stack2 = {
      environment,
      stackName: 'Foo',
      template: {
        // Resource was added
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };
    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);
    expect(mappings).toEqual([])
  });

  test('normal updates are not mappings', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'old value' },
          },
        },
      },
    };

    const stack2 = {
      environment,
      // Same stack name
      stackName: 'Foo',
      template: {
        Resources: {
          // Same resource name
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            // Updated property
            Properties: { Prop: 'old value' },
          },
        },
      },
    };
    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);
    expect(mappings).toEqual([]);
  });

  test('moving resources across stacks', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Bar',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);
    expect(mappings).toEqual([
      {
        Source: { LogicalResourceId: 'Bucket1', StackName: 'Foo' },
        Destination: { LogicalResourceId: 'Bucket1', StackName: 'Bar' },
      },
    ]);
  });

  test('renaming resources in the same stack', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          OldName: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          NewName: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };
    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);
    expect(mappings).toEqual([
      {
        Source: { LogicalResourceId: 'OldName', StackName: 'Foo' },
        Destination: { LogicalResourceId: 'NewName', StackName: 'Foo' },
      },
    ]);
  });

  test('moving and renaming resources across stacks', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          OldName: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Bar',
      template: {
        Resources: {
          NewName: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);
    expect(mappings).toEqual([
      {
        Source: { LogicalResourceId: 'OldName', StackName: 'Foo' },
        Destination: { LogicalResourceId: 'NewName', StackName: 'Bar' },
      },
    ]);
  });

  test('type is also part of the resources contents', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          OldName: {
            Type: 'AWS::S3::Bucket',
            Properties: {
              Xyz: 123,
            },
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Bar',
      template: {
        Resources: {
          NewName: {
            Type: 'AWS::EC2::Instance',
            Properties: {
              Xyz: 123,
            },
          },
        },
      },
    };

    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);

    // We don't consider that a resource was moved from Foo.OldName to Bar.NewName,
    // even though they have the same properties. Since they have different types,
    // they are considered different resources.
    expect(mappings).toEqual([]);

  });

  test('ambiguous resources from multiple stacks', () => {
    const stack1 = {
      environment,
      stackName: 'Stack1',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Stack2',
      template: {
        Resources: {
          Bucket2: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
    };

    const stack3 = {
      environment,
      stackName: 'Stack3',
      template: {
        Resources: {
          Bucket3: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
    };
    const movements = resourceMovements([stack1, stack2], [stack3]);
    const ambiguous = ambiguousMovements(movements);
    expect(ambiguous).toEqual([
      [
        [
          {
            stack: expect.objectContaining({
              stackName: 'Stack1',
            }),
            logicalResourceId: 'Bucket1',
          },
          {
            stack: expect.objectContaining({
              stackName: 'Stack2',
            }),
            logicalResourceId: 'Bucket2',
          },
        ],
        [
          {
            stack: expect.objectContaining({
              stackName: 'Stack3',
            }),
            logicalResourceId: 'Bucket3',
          },
        ],
      ],
    ]);
  });

  test('ambiguous pairs', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
          Bucket2: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Bar',
      template: {
        Resources: {
          Bucket3: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
          Bucket4: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
    };

    const movements = resourceMovements([stack1], [stack2]);
    const ambiguous = ambiguousMovements(movements);
    expect(ambiguous).toEqual([
      [
        [
          {
            stack: expect.objectContaining({
              stackName: 'Foo',
            }),
            logicalResourceId: 'Bucket1',
          },
          {
            stack: expect.objectContaining({
              stackName: 'Foo',
            }),
            logicalResourceId: 'Bucket2',
          },
        ],
        [
          {
            stack: expect.objectContaining({
              stackName: 'Bar',
            }),
            logicalResourceId: 'Bucket3',
          },
          {
            stack: expect.objectContaining({
              stackName: 'Bar',
            }),
            logicalResourceId: 'Bucket4',
          },
        ],
      ],
    ])
  });

  test('combines addition, deletion, update, and rename', () => {
    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          OldName: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'OldBucket' },
          },
          ToBeDeleted: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'DeleteMe' },
          },
          ToBeUpdated: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'UpdateMe' },
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          NewName: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'OldBucket' },
          },
          ToBeAdded: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'NewBucket' },
          },
          ToBeUpdated: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'UpdatedBucket' },
          },
        },
      },
    };

    const pairs = resourceMovements([stack1], [stack2]);
    const mappings = resourceMappings(pairs).map(toCfnMapping);
    expect(mappings).toEqual([
      {
        Source: { LogicalResourceId: 'OldName', StackName: 'Foo' },
        Destination: { LogicalResourceId: 'NewName', StackName: 'Foo' },
      },
    ]);
  });
});

describe('environment grouping', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    cloudFormationClient.reset();
  });

  test('produces mappings for the same environment', async () => {
    const environment = {
      name: 'test',
      account: '333333333333',
      region: 'us-east-1',
    };

    const stack1 = {
      environment,
      stackName: 'Foo',
      template: {
        Resources: {
          Dummy: {
            Type: 'AWS::X::Y',
            Properties: {},
          },
          Bucket: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const stack2 = {
      environment,
      stackName: 'Bar',
      template: {
        Resources: {
          Dummy: {
            Type: 'AWS::Z::W',
            Properties: {},
          },
        },
      },
    };

    cloudFormationClient.on(ListStacksCommand).resolves({
      // Both stacks are in the same environment, so they are returned in the same call
      StackSummaries: [
        {
          StackName: 'Foo',
          StackId: 'arn:aws:cloudformation:us-east-1:333333333333:stack/Foo',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
        {
          StackName: 'Bar',
          StackId: 'arn:aws:cloudformation:us-east-1:333333333333:stack/Bar',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
        },
      ],
    });

    cloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Foo',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            Dummy: {
              Type: 'AWS::X::Y',
              Properties: {},
            },
          },
        }),
      });

    cloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Bar',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            Dummy: {
              Type: 'AWS::Z::W',
              Properties: {},
            },
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: { Prop: 'XXXXXXXXX' },
            },
          },
        }),
      });

    const provider = new MockSdkProvider();
    provider.returnsDefaultAccounts(environment.account);

    const movements = await findResourceMovements([stack1, stack2], provider);
    expect(ambiguousMovements((movements))).toEqual([]);

    expect(resourceMappings(movements).map(toCfnMapping)).toEqual([
      {
        Destination: {
          LogicalResourceId: 'Bucket',
          StackName: 'Foo',
        },
        Source: {
          LogicalResourceId: 'Bucket',
          StackName: 'Bar',
        },
      },
    ]);
  });

  test('does not produce cross-environment mappings', async () => {
    const environment1 = {
      name: 'test',
      account: '333333333333',
      region: 'us-east-1',
    };

    const environment2 = {
      name: 'prod',
      account: '123456789012',
      region: 'us-east-1',
    };

    const stack1 = {
      environment: environment1,
      stackName: 'Foo',
      template: {
        Resources: {
          Dummy: {
            Type: 'AWS::X::Y',
            Properties: {},
          },
          Bucket: {
            Type: 'AWS::S3::Bucket',
            Properties: { Prop: 'XXXXXXXXX' },
          },
        },
      },
    };

    const stack2 = {
      environment: environment2,
      stackName: 'Bar',
      template: {
        Resources: {
          Dummy: {
            Type: 'AWS::Z::W',
            Properties: {},
          },
        },
      },
    };

    cloudFormationClient
      .on(ListStacksCommand)
      // We are relying on the fact that these calls are made in the order that the
      // stacks are passed. So the first call is for environment1 and the second is
      // for environment2. This is not ideal, but as far as I know there is no other
      // way to control the behavior of the mock SDK clients.
      .resolvesOnce({
        StackSummaries: [
          {
            StackName: 'Foo',
            StackId: 'arn:aws:cloudformation:us-east-1:333333333333:stack/Foo',
            StackStatus: 'CREATE_COMPLETE',
            CreationTime: new Date(),
          },
        ],
      })
      .resolvesOnce({
        StackSummaries: [
          {
            StackName: 'Bar',
            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/Bar',
            StackStatus: 'CREATE_COMPLETE',
            CreationTime: new Date(),
          },
        ],
      });

    cloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Foo',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            Dummy: {
              Type: 'AWS::X::Y',
              Properties: {},
            },
          },
        }),
      });

    cloudFormationClient
      .on(GetTemplateCommand, {
        StackName: 'Bar',
      })
      .resolves({
        TemplateBody: JSON.stringify({
          Resources: {
            Dummy: {
              Type: 'AWS::Z::W',
              Properties: {},
            },
            // This resource was "moved" from Foo to Bar
            // except that they are in different environments
            // so it should not be detected as a refactor
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: { Prop: 'XXXXXXXXX' },
            },
          },
        }),
      });

    const provider = new MockSdkProvider();
    provider.returnsDefaultAccounts(environment1.account, environment2.account);

    const movements = await findResourceMovements([stack1, stack2], provider);
    expect(ambiguousMovements((movements))).toEqual([]);

    expect(resourceMappings(movements).map(toCfnMapping)).toEqual([]);
  });
});

function toCfnMapping(m: ResourceMapping): CfnResourceMapping {
  return {
    Source: toCfnLocation(m.source),
    Destination: toCfnLocation(m.destination),
  };
}

function toCfnLocation(loc: ResourceLocation): CfnResourceLocation {
  return {
    LogicalResourceId: loc.logicalResourceId,
    StackName: loc.stack.stackName,
  };
}
