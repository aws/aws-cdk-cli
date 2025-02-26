import { computeResourceDigests, typedMappings } from '../../../lib/api/refactoring';

describe('computeResourceDigests', () => {
  test('returns empty map for empty template', () => {
    const template = {};
    const result = computeResourceDigests(template);
    expect(Object.keys(result).length).toBe(0);
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

  test('almost identical resources - different dependency functions', () => {
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
            Metadata: {
              'aws:cdk:path': 'Stack/Q1/Resource',
            },
          },
        },
        Q2: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            Metadata: {
              'aws:cdk:path': 'Stack/Q2/Resource',
            },
          },
        },
      },
    };
    const result = computeResourceDigests(template);
    expect(result['Q1']).toBe(result['Q2']);
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

    expect(Object.keys(typedMappings([stack1], [stack2]))).toEqual([]);
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

    expect(Object.keys(typedMappings([stack1], [stack2]))).toEqual([]);
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

    expect(Object.keys(typedMappings([stack1], [stack2]))).toEqual([]);
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

    expect(typedMappings([stack1], [stack2])).toEqual([]);
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

    expect(typedMappings([stack1], [stack2])).toEqual([
      {
        Source: { LogicalResourceId: 'Bucket1', StackName: 'Foo' },
        Destination: { LogicalResourceId: 'Bucket1', StackName: 'Bar' },
        type: 'AWS::S3::Bucket',
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

    expect(typedMappings([stack1], [stack2])).toEqual([
      {
        Source: { LogicalResourceId: 'OldName', StackName: 'Foo' },
        Destination: { LogicalResourceId: 'NewName', StackName: 'Foo' },
        type: 'AWS::S3::Bucket',
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

    expect(typedMappings([stack1], [stack2])).toEqual([
      {
        Source: { LogicalResourceId: 'OldName', StackName: 'Foo' },
        Destination: { LogicalResourceId: 'NewName', StackName: 'Bar' },
        type: 'AWS::S3::Bucket',
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
          NewName: {
            Type: 'AWS::EC2::Instance',
            Properties: {},
          },
        },
      },
    };

    expect(typedMappings([stack1], [stack2])).toEqual([]);
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

    expect(() => typedMappings([stack1, stack2], [stack3])).toThrow(
      expect.objectContaining({
        pairs: [
          [
            [
              {
                StackName: 'Stack1',
                LogicalResourceId: 'Bucket1',
              },
              {
                StackName: 'Stack2',
                LogicalResourceId: 'Bucket2',
              },
            ],
            [
              {
                StackName: 'Stack3',
                LogicalResourceId: 'Bucket3',
              },
            ],
          ],
        ],
      }),
    );
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

    expect(() => typedMappings([stack1], [stack2])).toThrow(
      expect.objectContaining({
        pairs: [
          [
            [
              {
                StackName: 'Foo',
                LogicalResourceId: 'Bucket1',
              },
              {
                StackName: 'Foo',
                LogicalResourceId: 'Bucket2',
              },
            ],
            [
              {
                StackName: 'Bar',
                LogicalResourceId: 'Bucket3',
              },
              {
                StackName: 'Bar',
                LogicalResourceId: 'Bucket4',
              },
            ],
          ],
        ],
      }),
    );
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

    expect(typedMappings([stack1], [stack2])).toEqual([
      {
        Source: { LogicalResourceId: 'OldName', StackName: 'Foo' },
        Destination: { LogicalResourceId: 'NewName', StackName: 'Foo' },
        type: 'AWS::S3::Bucket',
      },
    ]);
  });
});
