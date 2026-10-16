import * as fc from 'fast-check';
import { arbitraryTemplate } from './test-arbitraries';
import { fullDiff, propertiesHiddenByChangeSet, ResourceImpact } from '../lib/diff-template';

const POLICY_DOCUMENT = { foo: 'Bar' }; // Obviously a fake one!
const BUCKET_POLICY_RESOURCE = {
  Type: 'AWS::S3::BucketPolicy',
  Properties: {
    PolicyDocument: POLICY_DOCUMENT,
    Bucket: { Ref: 'BucketResource' },
  },
};

test('when there is no difference', () => {
  const bucketName = 'ShineyBucketName';
  const currentTemplate = {
    Resources: {
      BucketPolicyResource: BUCKET_POLICY_RESOURCE,
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: bucketName,
        },
      },
    },
  };
  // Making a JSON-clone, because === is cheating!
  const newTemplate = JSON.parse(JSON.stringify(currentTemplate));

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(0);
});

test('when a resource is created', () => {
  const currentTemplate = { Resources: {} };

  const newTemplate = { Resources: { BucketResource: { Type: 'AWS::S3::Bucket' } } };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketResource;
  expect(difference).not.toBeUndefined();
  expect(difference?.isAddition).toBeTruthy();
  expect(difference?.newResourceType).toEqual('AWS::S3::Bucket');
  expect(difference?.changeImpact).toBe(ResourceImpact.WILL_CREATE);
});

test('when a resource is deleted (no DeletionPolicy)', () => {
  const currentTemplate = {
    Resources: {
      BucketResource: { Type: 'AWS::S3::Bucket' },
      BucketPolicyResource: BUCKET_POLICY_RESOURCE,
    },
  };

  const newTemplate = {
    Resources: {
      BucketResource: { Type: 'AWS::S3::Bucket' },
    },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketPolicyResource;
  expect(difference).not.toBeUndefined();
  expect(difference?.isRemoval).toBeTruthy();
  expect(difference?.oldResourceType).toEqual('AWS::S3::BucketPolicy');
  expect(difference?.changeImpact).toBe(ResourceImpact.WILL_DESTROY);
});

test.each(['Retain', 'RetainExceptOnCreate'])('when a resource is deleted (DeletionPolicy=%s)', (deletionPolicy) => {
  const currentTemplate = {
    Resources: {
      BucketResource: { Type: 'AWS::S3::Bucket' },
      BucketPolicyResource: {
        Type: 'AWS::S3::BucketPolicy',
        DeletionPolicy: deletionPolicy,
        Properties: {
          PolicyDocument: POLICY_DOCUMENT,
          Bucket: { Ref: 'BucketResource' },
        },
      },
    },
  };

  const newTemplate = {
    Resources: { BucketResource: { Type: 'AWS::S3::Bucket' } },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketPolicyResource;
  expect(difference).not.toBeUndefined();
  expect(difference?.isRemoval).toBeTruthy();
  expect(difference?.oldResourceType).toEqual('AWS::S3::BucketPolicy');
  expect(difference?.changeImpact).toBe(ResourceImpact.WILL_ORPHAN);
});

test('when a property changes', () => {
  const bucketName = 'ShineyBucketName';
  const currentTemplate = {
    Resources: {
      QueueResource: {
        Type: 'AWS::SQS::Queue',
      },
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: bucketName,
        },
      },
    },
  };

  const newBucketName = `${bucketName}-v2`;
  const newTemplate = {
    Resources: {
      QueueResource: {
        Type: 'AWS::SQS::Queue',
      },
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: newBucketName,
        },
      },
    },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketResource;
  expect(difference).not.toBeUndefined();
  expect(difference?.oldResourceType).toEqual('AWS::S3::Bucket');
  expect(difference?.propertyUpdates).toEqual({
    BucketName: { oldValue: bucketName, newValue: newBucketName, changeImpact: ResourceImpact.WILL_REPLACE, isDifferent: true },
  });
});

test('change in dependencies counts as a simple update', () => {
  // GIVEN
  const currentTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        DependsOn: ['SomeResource'],
      },
    },
  };

  // WHEN
  const newTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        DependsOn: ['SomeResource', 'SomeOtherResource'],
      },
    },
  };
  const differences = fullDiff(currentTemplate, newTemplate);

  // THEN
  expect(differences.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketResource;
  expect(difference?.changeImpact).toBe(ResourceImpact.WILL_UPDATE);
});

test('when a property is deleted', () => {
  const bucketName = 'ShineyBucketName';
  const currentTemplate = {
    Resources: {
      QueueResource: {
        Type: 'AWS::SQS::Queue',
      },
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: bucketName,
        },
      },
    },
  };

  const newTemplate = {
    Resources: {
      QueueResource: {
        Type: 'AWS::SQS::Queue',
      },
      BucketResource: {
        Type: 'AWS::S3::Bucket',
      },
    },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketResource;
  expect(difference).not.toBeUndefined();
  expect(difference?.oldResourceType).toEqual('AWS::S3::Bucket');
  expect(difference?.propertyUpdates).toEqual({
    BucketName: { oldValue: bucketName, newValue: undefined, changeImpact: ResourceImpact.WILL_REPLACE, isDifferent: true },
  });
});

test('when a property is added', () => {
  const bucketName = 'ShineyBucketName';
  const currentTemplate = {
    Resources: {
      QueueResource: {
        Type: 'AWS::SQS::Queue',
      },
      BucketResource: {
        Type: 'AWS::S3::Bucket',
      },
    },
  };

  const newTemplate = {
    Resources: {
      QueueResource: {
        Type: 'AWS::SQS::Queue',
      },
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: bucketName,
        },
      },
    },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketResource;
  expect(difference).not.toBeUndefined();
  expect(difference?.oldResourceType).toEqual('AWS::S3::Bucket');
  expect(difference?.propertyUpdates).toEqual({
    BucketName: { oldValue: undefined, newValue: bucketName, changeImpact: ResourceImpact.WILL_REPLACE, isDifferent: true },
  });
});

test('when a resource type changed', () => {
  const currentTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::IAM::Policy',
        Properties: {
          PolicyName: 'PolicyName',
        },
      },
    },
  };

  const newTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: 'BucketName',
        },
      },
    },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketResource;
  expect(difference).not.toBe(undefined);
  expect(difference?.oldResourceType).toEqual('AWS::IAM::Policy');
  expect(difference?.newResourceType).toEqual('AWS::S3::Bucket');
  expect(difference?.changeImpact).toBe(ResourceImpact.WILL_REPLACE);
});

test('resource replacement is tracked through references', () => {
  // If a resource is replaced, then that change shows that references are
  // going to change. This may lead to replacement of downstream resources
  // if the reference is used in an immutable property, and so on.

  // GIVEN
  const currentTemplate = {
    Resources: {
      Bucket: {
        Type: 'AWS::S3::Bucket',
        Properties: { BucketName: 'Name1' }, // Immutable prop
      },
      Queue: {
        Type: 'AWS::SQS::Queue',
        Properties: { QueueName: { Ref: 'Bucket' } }, // Immutable prop
      },
      Topic: {
        Type: 'AWS::SNS::Topic',
        Properties: { TopicName: { Ref: 'Queue' } }, // Immutable prop
      },
    },
  };

  // WHEN
  const newTemplate = {
    Resources: {
      Bucket: {
        Type: 'AWS::S3::Bucket',
        Properties: { BucketName: 'Name2' },
      },
      Queue: {
        Type: 'AWS::SQS::Queue',
        Properties: { QueueName: { Ref: 'Bucket' } },
      },
      Topic: {
        Type: 'AWS::SNS::Topic',
        Properties: { TopicName: { Ref: 'Queue' } },
      },
    },
  };
  const differences = fullDiff(currentTemplate, newTemplate);

  // THEN
  expect(differences.resources.differenceCount).toBe(3);
});

test('adding and removing quotes from a numeric property causes no changes', () => {
  const currentTemplate = {
    Resources: {
      Bucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          CorsConfiguration: {
            CorsRules: [
              {
                AllowedMethods: [
                  'GET',
                ],
                AllowedOrigins: [
                  '*',
                ],
                MaxAge: 10,
              },
            ],
          },
        },
      },
    },
  };

  const newTemplate = {
    Resources: {
      Bucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          CorsConfiguration: {
            CorsRules: [
              {
                AllowedMethods: [
                  'GET',
                ],
                AllowedOrigins: [
                  '*',
                ],
                MaxAge: '10',
              },
            ],
          },
        },
      },
    },
  };
  let differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.resources.differenceCount).toBe(0);

  differences = fullDiff(newTemplate, currentTemplate);
  expect(differences.resources.differenceCount).toBe(0);
});

test('versions are correctly detected as not numbers', () => {
  const currentTemplate = {
    Resources: {
      ImageBuilderComponent: {
        Type: 'AWS::ImageBuilder::Component',
        Properties: {
          Platform: 'Linux',
          Version: '0.0.1',
        },
      },
    },
  };
  const newTemplate = {
    Resources: {
      ImageBuilderComponent: {
        Type: 'AWS::ImageBuilder::Component',
        Properties: {
          Platform: 'Linux',
          Version: '0.0.2',
        },
      },
    },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.resources.differenceCount).toBe(1);
});
test('boolean properties are considered equal with their stringified counterparts', () => {
  // GIVEN
  const currentTemplate = {
    Resources: {
      Bucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: 'true',
          },
        },
      },
    },
  };
  const newTemplate = {
    Resources: {
      Bucket: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
          },
        },
      },
    },
  };

  // WHEN
  const differences = fullDiff(currentTemplate, newTemplate);

  // THEN
  expect(differences.differenceCount).toBe(0);
});

test('when a property changes including equivalent DependsOn', () => {
  // GIVEN
  const bucketName = 'ShineyBucketName';
  const currentTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        DependsOn: ['SomeResource'],
        BucketName: bucketName,
      },
    },
  };

  // WHEN
  const newBucketName = `${bucketName}-v2`;
  const newTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        DependsOn: ['SomeResource'],
        BucketName: newBucketName,
      },
    },
  };

  // THEN
  let differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.resources.differenceCount).toBe(1);

  differences = fullDiff(newTemplate, currentTemplate);
  expect(differences.resources.differenceCount).toBe(1);
});

test.each([
  ['0.31.1-prod', '0.31.2-prod'],
  ['8.0.5.5.4-identifier', '8.0.5.5.5-identifier'],
  ['1.1.1.1', '1.1.1.2'],
  ['1.2.3', '1.2.4'],
  ['2.2.2.2', '2.2.3.2'],
  ['3.3.3.3', '3.4.3.3'],
  ['2021-10-23T06:07:08.000Z', '2021-10-23T09:10:11.123Z'],
])("reports a change when a string property with a number-like format changes from '%s' to '%s'", (oldValue, newValue) => {
  // GIVEN
  const currentTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          Tags: [oldValue],
        },
      },
    },
  };
  const newTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          Tags: [newValue],
        },
      },
    },
  };
  // WHEN
  const differences = fullDiff(currentTemplate, newTemplate);

  // THEN
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.BucketResource;
  expect(difference).not.toBeUndefined();
  expect(difference?.oldResourceType).toEqual('AWS::S3::Bucket');
  expect(difference?.propertyUpdates).toEqual({
    Tags: { oldValue: [oldValue], newValue: [newValue], changeImpact: ResourceImpact.WILL_UPDATE, isDifferent: true },
  });
});

test('when a property with a number-like format doesn\'t change', () => {
  const tags = ['0.31.1-prod', '8.0.5.5.4-identifier', '1.1.1.1', '1.2.3'];
  const currentTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          Tags: tags,
        },
      },
    },
  };
  const newTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        Properties: {
          Tags: tags,
        },
      },
    },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(0);
  expect(differences.resources.differenceCount).toBe(0);
  const difference = differences.resources.changes.BucketResource;
  expect(difference).toBeUndefined();
});

test('handles a resource changing its Type', () => {
  const currentTemplate = {
    Resources: {
      FunctionApi: {
        Type: 'AWS::Serverless::Api',
        Properties: {
          StageName: 'prod',
        },
      },
    },
  };
  const newTemplate = {
    Resources: {
      FunctionApi: {
        Type: 'AWS::ApiGateway::RestApi',
      },
    },
  };

  const differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);
  expect(differences.resources.differenceCount).toBe(1);
  const difference = differences.resources.changes.FunctionApi;
  expect(difference).toEqual({
    isAddition: false,
    isRemoval: false,
    newValue: { Type: 'AWS::ApiGateway::RestApi' },
    oldValue: { Properties: { StageName: 'prod' }, Type: 'AWS::Serverless::Api' },
    otherDiffs: {},
    propertyDiffs: {},
    resourceTypes: { newType: 'AWS::ApiGateway::RestApi', oldType: 'AWS::Serverless::Api' },
  });
});

test('diffing any two arbitrary templates should not crash', () => {
  // We're not interested in making sure we find the right differences here -- just
  // that we're not crashing.
  fc.assert(fc.property(arbitraryTemplate, arbitraryTemplate, (t1, t2) => {
    fullDiff(t1, t2);
  }), {
    // path: '1:0:0:0:3:0:1:1:1:1:1:1:1:1:1:1:1:1:1:2:1:1:1',
  });
});

test('metadata changes are rendered in the diff', () => {
  // GIVEN
  const currentTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        BucketName: 'magic-bucket',
        Metadata: {
          'aws:cdk:path': '/foo/BucketResource',
        },
      },
    },
  };

  // WHEN
  const newTemplate = {
    Resources: {
      BucketResource: {
        Type: 'AWS::S3::Bucket',
        BucketName: 'magic-bucket',
        Metadata: {
          'aws:cdk:path': '/bar/BucketResource',
        },
      },
    },
  };

  // THEN
  let differences = fullDiff(currentTemplate, newTemplate);
  expect(differences.differenceCount).toBe(1);

  differences = fullDiff(newTemplate, currentTemplate);
  expect(differences.resources.differenceCount).toBe(1);
});

describe('propertiesHiddenByChangeSet (https://github.com/aws/aws-cdk-cli/issues/2036)', () => {
  // `Stack.toJsonString({ stack: Aws.STACK_NAME, ...values })` stored in a string property
  const json = (values: Record<string, string>) => ({
    'Fn::Join': ['', ['{"stack":"', { Ref: 'AWS::StackName' }, `",${JSON.stringify(values).slice(1)}`]],
  });
  const hiddenValue = [{ resourceLogicalId: 'Param', propertyName: 'Value' }];
  const template = (properties: Record<string, any>) => ({
    Resources: { Param: { Type: 'AWS::SSM::Parameter', Properties: { Type: 'String', ...properties } } },
  });
  const change = (...properties: string[]) => ({
    Changes: [{
      Type: 'Resource' as const,
      ResourceChange: {
        Action: 'Modify' as const,
        LogicalResourceId: 'Param',
        ResourceType: 'AWS::SSM::Parameter',
        Details: properties.map((name) => ({ Target: { Attribute: 'Properties' as const, Name: name, RequiresRecreation: 'Never' as const } })),
      },
    }],
  });

  test('returns a property whose value contains a token when the change set leaves out the resource', () => {
    // A key added to the JSON: described with IncludePropertyValues, CloudFormation leaves this out
    const before = template({ Value: json({ a: '1' }) });
    const after = template({ Value: json({ a: '1', b: '2' }) });
    expect(propertiesHiddenByChangeSet(before, after, { Changes: [] })).toEqual(hiddenValue);
  });

  test('returns a property whose value contains a token when the change set lists the resource without it', () => {
    // Only the description change is mentioned, the value change is left out
    const before = template({ Value: json({ a: '1' }), Description: 'd1' });
    const after = template({ Value: json({ a: '1', b: '2' }), Description: 'd2' });
    expect(propertiesHiddenByChangeSet(before, after, change('Description'))).toEqual(hiddenValue);
  });

  test('returns nothing when the change set mentions the change', () => {
    const before = template({ Value: json({ a: '1' }) });
    const after = template({ Value: json({ a: '1', b: '2' }) });
    expect(propertiesHiddenByChangeSet(before, after, change('Value'))).toEqual([]);
  });

  test('returns nothing for a static value, whether the change set leaves out the resource or only the property', () => {
    const before = template({ Value: JSON.stringify({ a: '1' }), Description: 'd1' });
    const after = template({ Value: JSON.stringify({ a: '1', b: '2' }), Description: 'd2' });
    expect(propertiesHiddenByChangeSet(before, after, { Changes: [] })).toEqual([]);
    expect(propertiesHiddenByChangeSet(before, after, change('Description'))).toEqual([]);
  });
});
