import type {
  ResourceLocation as CfnResourceLocation,
  ResourceMapping as CfnResourceMapping,
} from '@aws-sdk/client-cloudformation/dist-types/models/models_0';
import { expect } from '@jest/globals';
import type { ResourceLocation, ResourceMapping } from '../../../lib/api/refactoring/cloudformation';
import { RefactoringContext } from '../../../lib/api/refactoring/context';

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

    const context = new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    });
    expect(context.mappings).toEqual([]);
  });

  test('resource removal is not allowed', () => {
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

    expect(() => new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    })).toThrow(/A refactor operation cannot add, remove or update resources/);
  });

  test('resource addition is not allowed', () => {
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

    expect(() => new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    })).toThrow(/A refactor operation cannot add, remove or update resources/);
  });

  test('resource update is not allowed', () => {
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
            Properties: { Prop: 'new value' },
          },
        },
      },
    };

    expect(() => new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    })).toThrow(/A refactor operation cannot add, remove or update resources/);
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

    const context = new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    });
    expect(context.mappings.map(toCfnMapping)).toEqual([
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
    const context = new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    });
    expect(context.mappings.map(toCfnMapping)).toEqual([
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

    const context = new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    });
    expect(context.mappings.map(toCfnMapping)).toEqual([
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

    // We don't consider that a resource was moved from Foo.OldName to Bar.NewName,
    // even though they have the same properties. Since they have different types,
    // they are considered different resources.
    expect(() => new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    })).toThrow(/A refactor operation cannot add, remove or update resources/);
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

    expect(() => new RefactoringContext({
      environment,
      deployedStacks: [stack1, stack2],
      localStacks: [stack3],
    })).toThrow(/A refactor operation cannot add, remove or update resources/);
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

    const context = new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    });
    expect(context.ambiguousPaths).toEqual([
      [
        ['Foo.Bucket1', 'Foo.Bucket2'],
        ['Bar.Bucket3', 'Bar.Bucket4'],
      ],
    ]);
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

    expect(() => new RefactoringContext({
      environment,
      deployedStacks: [stack1],
      localStacks: [stack2],
    })).toThrow(/A refactor operation cannot add, remove or update resources/);
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
