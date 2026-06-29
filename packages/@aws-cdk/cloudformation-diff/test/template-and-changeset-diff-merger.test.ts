import type { ResourceChangeDetail } from '@aws-sdk/client-cloudformation';
import * as utils from './util';
import { PropertyDifference, ResourceDifference, ResourceImpact, fullDiff } from '../lib';
import { TemplateAndChangeSetDiffMerger } from '../lib/diff/template-and-changeset-diff-merger';

describe('fullDiff tests that include changeset', () => {
  test('changeset overrides spec replacements', () => {
    // GIVEN
    const currentTemplate = {
      Parameters: {
        BucketName: {
          Type: 'String',
        },
      },
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { BucketName: 'Name1' }, // Immutable prop
        },
      },
    };
    const newTemplate = {
      Parameters: {
        BucketName: {
          Type: 'String',
        },
      },
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { BucketName: { Ref: 'BucketName' } }, // No change
        },
      },
    };

    // WHEN
    const differences = fullDiff(currentTemplate, newTemplate, {
      Parameters: [
        {
          ParameterKey: 'BucketName',
          ParameterValue: 'Name1',
        },
      ],
      Changes: [],
    });

    // THEN
    expect(differences.differenceCount).toBe(0);
  });

  test('changeset replacements are respected', () => {
    // GIVEN
    const currentTemplate = {
      Parameters: {
        BucketName: {
          Type: 'String',
        },
      },
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { BucketName: 'Name1' }, // Immutable prop
        },
      },
    };
    const newTemplate = {
      Parameters: {
        BucketName: {
          Type: 'String',
        },
      },
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { BucketName: { Ref: 'BucketName' } }, // 'Name1' -> 'Name2'
        },
      },
    };

    // WHEN
    const differences = fullDiff(currentTemplate, newTemplate, {
      Parameters: [
        {
          ParameterKey: 'BucketName',
          ParameterValue: 'Name2',
        },
      ],
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'Bucket',
            ResourceType: 'AWS::S3::Bucket',
            Replacement: 'True',
            Details: [
              {
                Target: {
                  Attribute: 'Properties',
                  Name: 'BucketName',
                  RequiresRecreation: 'Always',
                },
                Evaluation: 'Static',
                ChangeSource: 'DirectModification',
              },
            ],
          },
        },
      ],
    });

    // THEN
    expect(differences.differenceCount).toBe(1);
  });

  // This is directly in-line with changeset behavior,
  // see 'Replacement': https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ResourceChange.html
  test('dynamic changeset replacements are considered conditional replacements', () => {
    // GIVEN
    const currentTemplate = {
      Resources: {
        Instance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            ImageId: 'ami-79fd7eee',
            KeyName: 'rsa-is-fun',
          },
        },
      },
    };

    const newTemplate = {
      Resources: {
        Instance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            ImageId: 'ami-79fd7eee',
            KeyName: 'but-sha-is-cool',
          },
        },
      },
    };

    // WHEN
    const differences = fullDiff(currentTemplate, newTemplate, {
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'Instance',
            ResourceType: 'AWS::EC2::Instance',
            Replacement: 'Conditional',
            Details: [
              {
                Target: {
                  Attribute: 'Properties',
                  Name: 'KeyName',
                  RequiresRecreation: 'Always',
                },
                Evaluation: 'Dynamic',
                ChangeSource: 'DirectModification',
              },
            ],
          },
        },
      ],
    });

    // THEN
    expect(differences.differenceCount).toBe(1);
    expect(differences.resources.changes.Instance.changeImpact).toEqual(ResourceImpact.MAY_REPLACE);
    expect(differences.resources.changes.Instance.propertyUpdates).toEqual({
      KeyName: {
        changeImpact: ResourceImpact.MAY_REPLACE,
        isDifferent: true,
        oldValue: 'rsa-is-fun',
        newValue: 'but-sha-is-cool',
      },
    });
  });

  test('changeset resource replacement is not tracked through references', () => {
    // GIVEN
    const currentTemplate = {
      Parameters: {
        BucketName: {
          Type: 'String',
        },
      },
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
      Parameters: {
        BucketName: {
          Type: 'String',
        },
      },
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { BucketName: { Ref: 'BucketName' } },
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
    const differences = fullDiff(currentTemplate, newTemplate, {
      Parameters: [
        {
          ParameterKey: 'BucketName',
          ParameterValue: 'Name1',
        },
      ],
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'Bucket',
            ResourceType: 'AWS::S3::Bucket',
            Replacement: 'False',
            Details: [],
          },
        },
      ],
    });

    // THEN
    expect(differences.resources.differenceCount).toBe(0);
  });

  test('Fn::GetAtt short form and long form are equivalent', () => {
    // GIVEN
    const currentTemplate = {
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { BucketName: 'BucketName' },
        },
      },
      Outputs: {
        BucketArnOneWay: { 'Fn::GetAtt': ['BucketName', 'Arn'] },
        BucketArnAnotherWay: { 'Fn::GetAtt': 'BucketName.Arn' },
      },
    };
    const newTemplate = {
      Resources: {
        Bucket: {
          Type: 'AWS::S3::Bucket',
          Properties: { BucketName: 'BucketName' },
        },
      },
      Outputs: {
        BucketArnOneWay: { 'Fn::GetAtt': 'BucketName.Arn' },
        BucketArnAnotherWay: { 'Fn::GetAtt': ['BucketName', 'Arn'] },
      },
    };

    // WHEN
    const differences = fullDiff(currentTemplate, newTemplate);

    // THEN
    expect(differences.differenceCount).toBe(0);
  });

  test('metadata changes are obscured from the diff', () => {
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
    let differences = fullDiff(currentTemplate, newTemplate, {});
    expect(differences.differenceCount).toBe(0);
  });

  test('single element arrays are equivalent to the single element in DependsOn expressions', () => {
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
          DependsOn: 'SomeResource',
        },
      },
    };

    let differences = fullDiff(currentTemplate, newTemplate, {});
    expect(differences.resources.differenceCount).toBe(0);

    differences = fullDiff(newTemplate, currentTemplate, {});
    expect(differences.resources.differenceCount).toBe(0);
  });

  test('array equivalence is independent of element order in DependsOn expressions', () => {
    // GIVEN
    const currentTemplate = {
      Resources: {
        BucketResource: {
          Type: 'AWS::S3::Bucket',
          DependsOn: ['SomeResource', 'AnotherResource'],
        },
      },
    };

    // WHEN
    const newTemplate = {
      Resources: {
        BucketResource: {
          Type: 'AWS::S3::Bucket',
          DependsOn: ['AnotherResource', 'SomeResource'],
        },
      },
    };

    let differences = fullDiff(currentTemplate, newTemplate, {});
    expect(differences.resources.differenceCount).toBe(0);

    differences = fullDiff(newTemplate, currentTemplate, {});
    expect(differences.resources.differenceCount).toBe(0);
  });

  test('arrays of different length are considered unequal in DependsOn expressions', () => {
    // GIVEN
    const currentTemplate = {
      Resources: {
        BucketResource: {
          Type: 'AWS::S3::Bucket',
          DependsOn: ['SomeResource', 'AnotherResource', 'LastResource'],
        },
      },
    };

    // WHEN
    const newTemplate = {
      Resources: {
        BucketResource: {
          Type: 'AWS::S3::Bucket',
          DependsOn: ['AnotherResource', 'SomeResource'],
        },
      },
    };

    // dependsOn changes do not appear in the changeset
    let differences = fullDiff(currentTemplate, newTemplate, {});
    expect(differences.resources.differenceCount).toBe(1);

    differences = fullDiff(newTemplate, currentTemplate, {});
    expect(differences.resources.differenceCount).toBe(1);
  });

  test('arrays that differ only in element order are considered unequal outside of DependsOn expressions', () => {
    // GIVEN
    const currentTemplate = {
      Resources: {
        BucketResource: {
          Type: 'AWS::S3::Bucket',
          BucketName: { 'Fn::Select': [0, ['name1', 'name2']] },
        },
      },
    };

    // WHEN
    const newTemplate = {
      Resources: {
        BucketResource: {
          Type: 'AWS::S3::Bucket',
          BucketName: { 'Fn::Select': [0, ['name2', 'name1']] },
        },
      },
    };

    let differences = fullDiff(currentTemplate, newTemplate, {
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'BucketResource',
            ResourceType: 'AWS::S3::Bucket',
            Replacement: 'True',
            Details: [{
              Evaluation: 'Static',
              Target: {
                Attribute: 'Properties',
                Name: 'BucketName',
                RequiresRecreation: 'Always',
              },
            }],
          },
        },
      ],
    });
    expect(differences.resources.differenceCount).toBe(1);
  });

  test('SAM Resources are rendered with changeset diffs', () => {
    // GIVEN
    const currentTemplate = {
      Resources: {
        ServerlessFunction: {
          Type: 'AWS::Serverless::Function',
          Properties: {
            CodeUri: 's3://bermuda-triangle-1337-bucket/old-handler.zip',
          },
        },
      },
    };

    // WHEN
    const newTemplate = {
      Resources: {
        ServerlessFunction: {
          Type: 'AWS::Serverless::Function',
          Properties: {
            CodeUri: 's3://bermuda-triangle-1337-bucket/new-handler.zip',
          },
        },
      },
    };

    let differences = fullDiff(currentTemplate, newTemplate, {
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Modify',
            LogicalResourceId: 'ServerlessFunction',
            ResourceType: 'AWS::Lambda::Function', // The SAM transform is applied before the changeset is created, so the changeset has a Lambda resource here!
            Replacement: 'False',
            Details: [{
              Evaluation: 'Static',
              Target: {
                Attribute: 'Properties',
                Name: 'Code',
                RequiresRecreation: 'Never',
              },
            }],
          },
        },
      ],
    });
    expect(differences.resources.differenceCount).toBe(1);
  });

  test('imports are respected for new stacks', async () => {
    // GIVEN
    const currentTemplate = {};

    // WHEN
    const newTemplate = {
      Resources: {
        BucketResource: {
          Type: 'AWS::S3::Bucket',
        },
      },
    };

    let differences = fullDiff(currentTemplate, newTemplate, {
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Import',
            LogicalResourceId: 'BucketResource',
          },
        },
      ],
    });
    expect(differences.resources.differenceCount).toBe(1);
    expect(differences.resources.get('BucketResource')?.changeImpact === ResourceImpact.WILL_IMPORT);
  });

  test('imports are respected for existing stacks', async () => {
    // GIVEN
    const currentTemplate = {
      Resources: {
        OldResource: {
          Type: 'AWS::Something::Resource',
        },
      },
    };

    // WHEN
    const newTemplate = {
      Resources: {
        OldResource: {
          Type: 'AWS::Something::Resource',
        },
        BucketResource: {
          Type: 'AWS::S3::Bucket',
        },
      },
    };

    let differences = fullDiff(currentTemplate, newTemplate, {
      Changes: [
        {
          Type: 'Resource',
          ResourceChange: {
            Action: 'Import',
            LogicalResourceId: 'BucketResource',
          },
        },
      ],
    });
    expect(differences.resources.differenceCount).toBe(1);
    expect(differences.resources.get('BucketResource')?.changeImpact === ResourceImpact.WILL_IMPORT);
  });

  describe('changeset-only resource changes (issue #641)', () => {
    // A resource whose local template is byte-for-byte identical between current and target,
    // but whose deploy-time-resolved value (e.g. an SSM parameter) changed. The template diff
    // sees nothing; only the change set knows about the change.
    const ssmBackedQueueTemplate = {
      Parameters: {
        QueueNameParam: {
          Type: 'AWS::SSM::Parameter::Value<String>',
          Default: '/cdk/test/queue-name-param',
        },
      },
      Resources: {
        Queue: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: { Ref: 'QueueNameParam' },
          },
        },
      },
    };

    test('a replacement-causing change known only to the change set is surfaced', () => {
      // GIVEN current === new (the CDK app did not change; only the external SSM value did)
      const currentTemplate = JSON.parse(JSON.stringify(ssmBackedQueueTemplate));
      const newTemplate = JSON.parse(JSON.stringify(ssmBackedQueueTemplate));

      // WHEN
      const differences = fullDiff(currentTemplate, newTemplate, {
        Changes: [
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: 'Queue',
              ResourceType: 'AWS::SQS::Queue',
              Replacement: 'True',
              Scope: ['Properties'],
              Details: [
                {
                  Target: { Attribute: 'Properties', Name: 'QueueName', RequiresRecreation: 'Always' },
                  Evaluation: 'Static',
                  ChangeSource: 'ParameterReference',
                },
              ],
              BeforeContext: '{"Properties":{"QueueName":"old-queue-name"}}',
              AfterContext: '{"Properties":{"QueueName":"new-queue-name"}}',
            },
          },
        ],
      });

      // THEN
      expect(differences.resources.differenceCount).toBe(1);
      const queueDiff = differences.resources.get('Queue');
      expect(queueDiff.changeImpact).toBe(ResourceImpact.WILL_REPLACE);
      expect(queueDiff.propertyUpdates.QueueName.oldValue).toBe('old-queue-name');
      expect(queueDiff.propertyUpdates.QueueName.newValue).toBe('new-queue-name');
    });

    test('an update-only change known only to the change set is surfaced as WILL_UPDATE', () => {
      // GIVEN
      const ssmParamTemplate = {
        Resources: {
          mySsmParameter: {
            Type: 'AWS::SSM::Parameter',
            Properties: { Type: 'String', Value: { Ref: 'SomeParam' } },
          },
        },
      };
      const currentTemplate = JSON.parse(JSON.stringify(ssmParamTemplate));
      const newTemplate = JSON.parse(JSON.stringify(ssmParamTemplate));

      // WHEN
      const differences = fullDiff(currentTemplate, newTemplate, {
        Changes: [
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: 'mySsmParameter',
              ResourceType: 'AWS::SSM::Parameter',
              Replacement: 'False',
              Scope: ['Properties'],
              Details: [
                {
                  Target: { Attribute: 'Properties', Name: 'Value', RequiresRecreation: 'Never' },
                  Evaluation: 'Static',
                  ChangeSource: 'DirectModification',
                },
              ],
              BeforeContext: '{"Properties":{"Type":"String","Value":"old"}}',
              AfterContext: '{"Properties":{"Type":"String","Value":"new"}}',
            },
          },
        ],
      });

      // THEN
      expect(differences.resources.differenceCount).toBe(1);
      expect(differences.resources.get('mySsmParameter').changeImpact).toBe(ResourceImpact.WILL_UPDATE);
    });

    test('falls back to per-property Before/After values when no Before/AfterContext is present', () => {
      // GIVEN
      const currentTemplate = JSON.parse(JSON.stringify(ssmBackedQueueTemplate));
      const newTemplate = JSON.parse(JSON.stringify(ssmBackedQueueTemplate));

      // WHEN - no BeforeContext/AfterContext, only Details carry the values
      const differences = fullDiff(currentTemplate, newTemplate, {
        Changes: [
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: 'Queue',
              ResourceType: 'AWS::SQS::Queue',
              Replacement: 'True',
              Scope: ['Properties'],
              Details: [
                {
                  Target: {
                    Attribute: 'Properties',
                    Name: 'QueueName',
                    RequiresRecreation: 'Always',
                    BeforeValue: 'old-queue-name',
                    AfterValue: 'new-queue-name',
                  },
                  Evaluation: 'Static',
                  ChangeSource: 'ParameterReference',
                },
              ],
            },
          },
        ],
      });

      // THEN
      expect(differences.resources.differenceCount).toBe(1);
      const queueDiff = differences.resources.get('Queue');
      expect(queueDiff.changeImpact).toBe(ResourceImpact.WILL_REPLACE);
      expect(queueDiff.propertyUpdates.QueueName.oldValue).toBe('old-queue-name');
      expect(queueDiff.propertyUpdates.QueueName.newValue).toBe('new-queue-name');
    });

    test('does not add a change set resource that the template diff already covers', () => {
      // GIVEN the template itself changes QueueName
      const currentTemplate = {
        Resources: {
          Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'first' } },
        },
      };
      const newTemplate = {
        Resources: {
          Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'second' } },
        },
      };

      // WHEN - the change set also reports the change, with (different) context values
      const differences = fullDiff(currentTemplate, newTemplate, {
        Changes: [
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: 'Queue',
              ResourceType: 'AWS::SQS::Queue',
              Replacement: 'True',
              Scope: ['Properties'],
              Details: [
                {
                  Target: { Attribute: 'Properties', Name: 'QueueName', RequiresRecreation: 'Always' },
                  Evaluation: 'Static',
                  ChangeSource: 'DirectModification',
                },
              ],
              BeforeContext: '{"Properties":{"QueueName":"context-old"}}',
              AfterContext: '{"Properties":{"QueueName":"context-new"}}',
            },
          },
        ],
      });

      // THEN - exactly one difference, using the template's values (not clobbered by the change set context)
      expect(differences.resources.differenceCount).toBe(1);
      const queueDiff = differences.resources.get('Queue');
      expect(queueDiff.propertyUpdates.QueueName.oldValue).toBe('first');
      expect(queueDiff.propertyUpdates.QueueName.newValue).toBe('second');
      expect(queueDiff.changeImpact).toBe(ResourceImpact.WILL_REPLACE);
    });

    test('does not add Add/Remove/Import change set actions as synthesized changes', () => {
      // GIVEN identical templates
      const template = {
        Resources: {
          Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: { Ref: 'P' } } },
        },
      };

      // WHEN the change set only carries non-Modify actions for a resource not in the diff
      const differences = fullDiff(JSON.parse(JSON.stringify(template)), JSON.parse(JSON.stringify(template)), {
        Changes: [
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Add',
              LogicalResourceId: 'SomethingElse',
              ResourceType: 'AWS::SQS::Queue',
              AfterContext: '{"Properties":{"QueueName":"x"}}',
            },
          },
        ],
      });

      // THEN
      expect(differences.resources.differenceCount).toBe(0);
    });

    test('skips SAM resources reported by the change set', () => {
      // GIVEN identical templates with a SAM resource
      const template = {
        Resources: {
          ServerlessFunction: {
            Type: 'AWS::Serverless::Function',
            Properties: { CodeUri: 's3://bucket/handler.zip' },
          },
        },
      };

      // WHEN the change set reports the (transformed) resource as Serverless
      const differences = fullDiff(JSON.parse(JSON.stringify(template)), JSON.parse(JSON.stringify(template)), {
        Changes: [
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: 'ServerlessFunction',
              ResourceType: 'AWS::Serverless::Function',
              Replacement: 'False',
              Details: [],
              BeforeContext: '{"Properties":{"CodeUri":"s3://bucket/old.zip"}}',
              AfterContext: '{"Properties":{"CodeUri":"s3://bucket/new.zip"}}',
            },
          },
        ],
      });

      // THEN - SAM resources are not synthesized from the change set
      expect(differences.resources.differenceCount).toBe(0);
    });

    test('does not add a change set resource when there is no before/after data to diff', () => {
      // GIVEN identical templates
      const template = {
        Resources: {
          Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: { Ref: 'P' } } },
        },
      };

      // WHEN the change set has a Modify with no usable values
      const differences = fullDiff(JSON.parse(JSON.stringify(template)), JSON.parse(JSON.stringify(template)), {
        Changes: [
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: 'Queue',
              ResourceType: 'AWS::SQS::Queue',
              Replacement: 'False',
              Details: [],
            },
          },
        ],
      });

      // THEN
      expect(differences.resources.differenceCount).toBe(0);
    });

    test('surfaces a change set change for a resource present-but-unchanged in the template diff', () => {
      // GIVEN one resource changes textually (forcing the Resources section to differ),
      // while a second resource is identical in the template but changed per the change set.
      const currentTemplate = {
        Resources: {
          Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'old-bucket' } },
          Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: { Ref: 'P' } } },
        },
      };
      const newTemplate = {
        Resources: {
          Bucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'new-bucket' } },
          Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: { Ref: 'P' } } },
        },
      };

      // WHEN
      const differences = fullDiff(currentTemplate, newTemplate, {
        Changes: [
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: 'Bucket',
              ResourceType: 'AWS::S3::Bucket',
              Replacement: 'False',
              Details: [
                {
                  Target: { Attribute: 'Properties', Name: 'BucketName', RequiresRecreation: 'Never' },
                  Evaluation: 'Static',
                  ChangeSource: 'DirectModification',
                },
              ],
            },
          },
          {
            Type: 'Resource',
            ResourceChange: {
              Action: 'Modify',
              LogicalResourceId: 'Queue',
              ResourceType: 'AWS::SQS::Queue',
              Replacement: 'True',
              Details: [
                {
                  Target: { Attribute: 'Properties', Name: 'QueueName', RequiresRecreation: 'Always' },
                  Evaluation: 'Static',
                  ChangeSource: 'ParameterReference',
                },
              ],
              BeforeContext: '{"Properties":{"QueueName":"old-queue-name"}}',
              AfterContext: '{"Properties":{"QueueName":"new-queue-name"}}',
            },
          },
        ],
      });

      // THEN - both the textual change (Bucket) and the change-set-only change (Queue) are present
      expect(differences.resources.differenceCount).toBe(2);
      expect(differences.resources.get('Queue').changeImpact).toBe(ResourceImpact.WILL_REPLACE);
      expect(differences.resources.get('Queue').propertyUpdates.QueueName.newValue).toBe('new-queue-name');
    });
  });

  describe('changeset-only property changes on a resource already in the template diff (issue #641)', () => {
    // A resource that has an ordinary (textual) change to one property, while a *second* property
    // changes only via a deploy-time value (e.g. an SSM parameter) that the template diff cannot see.
    test('adds the change-set-only property (a hidden replacement) alongside the template change', () => {
      // GIVEN - the template changes ReceiveMessageWaitTimeSeconds (10 -> 20); QueueName is an
      // unchanged Ref in the template, but the change set reports it changing (and replacing).
      const currentTemplate = {
        Parameters: {
          SsmParameterValuetestbugreportC9: { Type: 'AWS::SSM::Parameter::Value<String>', Default: 'x' },
        },
        Resources: {
          Queue: utils.sqsQueueWithArgs({ waitTime: 10 }),
        },
      };
      const newTemplate = {
        Parameters: {
          SsmParameterValuetestbugreportC9: { Type: 'AWS::SSM::Parameter::Value<String>', Default: 'x' },
        },
        Resources: {
          Queue: utils.sqsQueueWithArgs({ waitTime: 20 }),
        },
      };

      // WHEN
      const differences = fullDiff(currentTemplate, newTemplate, {
        Changes: [
          utils.queueFromChangeset({ beforeContextWaitTime: '10', afterContextWaitTime: '20' }),
        ],
      });

      // THEN - exactly one changed resource, with BOTH properties surfaced
      expect(differences.resources.differenceCount).toBe(1);
      const queue = differences.resources.get('Queue');

      // template-detected change
      expect(queue.propertyUpdates.ReceiveMessageWaitTimeSeconds.changeImpact).toBe(ResourceImpact.WILL_UPDATE);

      // change-set-only change
      expect(queue.propertyUpdates.QueueName).toBeDefined();
      expect(queue.propertyUpdates.QueueName.changeImpact).toBe(ResourceImpact.WILL_REPLACE);
      expect(queue.propertyUpdates.QueueName.oldValue).toBe('newValuechangedddd');
      expect(queue.propertyUpdates.QueueName.newValue).toBe('newValuesdflkja');

      // resource-level impact is the worst of the two
      expect(queue.changeImpact).toBe(ResourceImpact.WILL_REPLACE);
    });
  });

  describe('fullDiff does not mutate its input templates (issue #1575)', () => {
    test('DependsOn array order on the input is preserved (not sorted)', () => {
      // GIVEN a resource with a multi-element DependsOn whose natural order is not alphabetical
      const currentTemplate = {
        Resources: {
          Function: {
            Type: 'AWS::Lambda::Function',
            Properties: {},
            DependsOn: ['FnServiceRoleDefaultPolicy', 'FnServiceRole'],
          },
        },
      };
      const newTemplate = {
        Resources: {
          Function: {
            Type: 'AWS::Lambda::Function',
            Properties: {},
            DependsOn: ['FnServiceRoleDefaultPolicy', 'FnServiceRole'],
          },
        },
      };
      const currentClone = JSON.parse(JSON.stringify(currentTemplate));
      const newClone = JSON.parse(JSON.stringify(newTemplate));

      // WHEN
      fullDiff(currentTemplate, newTemplate);

      // THEN - the caller's objects are untouched, in particular the DependsOn order
      expect(currentTemplate).toEqual(currentClone);
      expect(newTemplate).toEqual(newClone);
      expect(currentTemplate.Resources.Function.DependsOn).toEqual(['FnServiceRoleDefaultPolicy', 'FnServiceRole']);
    });

    test('Fn::GetAtt short form on the input is not rewritten to an array', () => {
      // GIVEN
      const currentTemplate = {
        Resources: { Bucket: { Type: 'AWS::S3::Bucket', Properties: {} } },
        Outputs: { Arn: { Value: { 'Fn::GetAtt': 'Bucket.Arn' } } },
      };
      const newTemplate = JSON.parse(JSON.stringify(currentTemplate));

      // WHEN
      fullDiff(currentTemplate, newTemplate);

      // THEN
      expect(currentTemplate.Outputs.Arn.Value['Fn::GetAtt']).toBe('Bucket.Arn');
    });

    test('the diff is still computed correctly while leaving inputs intact', () => {
      // GIVEN DependsOn reordering should be treated as no change, even though we no longer mutate
      const currentTemplate = {
        Resources: {
          Bucket: {
            Type: 'AWS::S3::Bucket',
            DependsOn: ['B', 'A'],
          },
        },
      };
      const newTemplate = {
        Resources: {
          Bucket: {
            Type: 'AWS::S3::Bucket',
            DependsOn: ['A', 'B'],
          },
        },
      };

      // WHEN
      const differences = fullDiff(currentTemplate, newTemplate);

      // THEN - no semantic difference, and inputs are preserved
      expect(differences.resources.differenceCount).toBe(0);
      expect(currentTemplate.Resources.Bucket.DependsOn).toEqual(['B', 'A']);
      expect(newTemplate.Resources.Bucket.DependsOn).toEqual(['A', 'B']);
    });
  });
});

describe('method tests', () => {
  describe('TemplateAndChangeSetDiffMerger constructor', () => {
    test('InspectChangeSet correctly parses changeset', async () => {
    // WHEN
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({ changeSet: utils.changeSet });

      // THEN
      expect(Object.keys(templateAndChangeSetDiffMerger.changeSetResources ?? {}).length).toBe(2);
      expect((templateAndChangeSetDiffMerger.changeSetResources ?? {}).Queue).toEqual({
        resourceWasReplaced: true,
        resourceType: 'AWS::SQS::Queue',
        propertyReplacementModes: {
          ReceiveMessageWaitTimeSeconds: {
            replacementMode: 'Never',
          },
          QueueName: {
            replacementMode: 'Always',
          },
        },
      });
      expect((templateAndChangeSetDiffMerger.changeSetResources ?? {}).mySsmParameter).toEqual({
        resourceWasReplaced: false,
        resourceType: 'AWS::SSM::Parameter',
        propertyReplacementModes: {
          Value: {
            replacementMode: 'Never',
          },
        },
      });
    });

    test('TemplateAndChangeSetDiffMerger constructor can handle undefined changeset', async () => {
    // WHEN
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({ changeSet: {} });

      // THEN
      expect(templateAndChangeSetDiffMerger.changeSetResources).toEqual({});
      expect(templateAndChangeSetDiffMerger.changeSet).toEqual({});
    });

    test('TemplateAndChangeSetDiffMerger constructor can handle undefined changes in changset.Changes', async () => {
    // WHEN
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({ changeSet: utils.changeSetWithMissingChanges });

      // THEN
      expect(templateAndChangeSetDiffMerger.changeSetResources).toEqual({});
      expect(templateAndChangeSetDiffMerger.changeSet).toEqual(utils.changeSetWithMissingChanges);
    });

    test('TemplateAndChangeSetDiffMerger constructor can handle partially defined changes in changset.Changes', async () => {
      // WHEN
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({ changeSet: utils.changeSetWithPartiallyFilledChanges });

      // THEN
      expect(templateAndChangeSetDiffMerger.changeSet).toEqual(utils.changeSetWithPartiallyFilledChanges);
      expect(Object.keys(templateAndChangeSetDiffMerger.changeSetResources ?? {}).length).toBe(2);
      expect((templateAndChangeSetDiffMerger.changeSetResources ?? {}).mySsmParameter).toEqual({
        resourceWasReplaced: false,
        resourceType: 'UNKNOWN_RESOURCE_TYPE',
        propertyReplacementModes: {
          Value: {
            replacementMode: 'Never',
          },
        },
      });
      expect((templateAndChangeSetDiffMerger.changeSetResources ?? {}).Queue).toEqual({
        resourceWasReplaced: true,
        resourceType: 'UNKNOWN_RESOURCE_TYPE',
        propertyReplacementModes: {
          QueueName: {
            replacementMode: 'Always',
          },
        },
      });
    });

    test('TemplateAndChangeSetDiffMerger constructor can handle undefined Details in changset.Changes', async () => {
    // WHEN
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({ changeSet: utils.changeSetWithUndefinedDetails });

      // THEN
      expect(templateAndChangeSetDiffMerger.changeSet).toEqual(utils.changeSetWithUndefinedDetails);
      expect(Object.keys(templateAndChangeSetDiffMerger.changeSetResources ?? {}).length).toBe(1);
      expect((templateAndChangeSetDiffMerger.changeSetResources ?? {}).Queue).toEqual({
        resourceWasReplaced: true,
        resourceType: 'UNKNOWN_RESOURCE_TYPE',
        propertyReplacementModes: {},
      });
    });
  });

  describe('determineChangeSetReplacementMode ', () => {
    test('can evaluate missing Target', async () => {
    // GIVEN
      const propertyChangeWithMissingTarget = {
        Target: undefined,
      };

      // WHEN
      const replacementMode = TemplateAndChangeSetDiffMerger.determineChangeSetReplacementMode(propertyChangeWithMissingTarget);

      // THEN
      expect(replacementMode).toEqual('Conditionally');
    });

    test('can evaluate missing RequiresRecreation', async () => {
    // GIVEN
      const propertyChangeWithMissingTargetDetail = {
        Target: { RequiresRecreation: undefined },
      };

      // WHEN
      const replacementMode = TemplateAndChangeSetDiffMerger.determineChangeSetReplacementMode(propertyChangeWithMissingTargetDetail);

      // THEN
      expect(replacementMode).toEqual('Conditionally');
    });

    test('can evaluate Always and Static', async () => {
    // GIVEN
      const propertyChangeWithAlwaysStatic: ResourceChangeDetail = {
        Target: { RequiresRecreation: 'Always' },
        Evaluation: 'Static',
      };

      // WHEN
      const replacementMode = TemplateAndChangeSetDiffMerger.determineChangeSetReplacementMode(propertyChangeWithAlwaysStatic);

      // THEN
      expect(replacementMode).toEqual('Always');
    });

    test('can evaluate always dynamic', async () => {
    // GIVEN
      const propertyChangeWithAlwaysDynamic: ResourceChangeDetail = {
        Target: { RequiresRecreation: 'Always' },
        Evaluation: 'Dynamic',
      };

      // WHEN
      const replacementMode = TemplateAndChangeSetDiffMerger.determineChangeSetReplacementMode(propertyChangeWithAlwaysDynamic);

      // THEN
      expect(replacementMode).toEqual('Conditionally');
    });

    test('missing Evaluation', async () => {
    // GIVEN
      const propertyChangeWithMissingEvaluation: ResourceChangeDetail = {
        Target: { RequiresRecreation: 'Always' },
        Evaluation: undefined,
      };

      // WHEN
      const replacementMode = TemplateAndChangeSetDiffMerger.determineChangeSetReplacementMode(propertyChangeWithMissingEvaluation);

      // THEN
      expect(replacementMode).toEqual('Always');
    });
  });

  describe('overrideDiffResourceChangeImpactWithChangeSetChangeImpact', () => {
    test('can handle blank change', async () => {
      // GIVEN
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({ changeSet: {} });
      const queue = new ResourceDifference(undefined, undefined, { resourceType: {}, propertyDiffs: {}, otherDiffs: {} });
      const logicalId = 'Queue';

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.isDifferent).toBe(false);
      expect(queue.changeImpact).toBe('NO_CHANGE');
    });

    test('ignores changes that are not in changeset', async () => {
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {},
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'first' } },
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'second' } },
        {
          resourceType: { oldType: 'AWS::CDK::GREAT', newType: 'AWS::CDK::GREAT' },
          propertyDiffs: { QueueName: new PropertyDifference<string>( 'first', 'second', { changeImpact: ResourceImpact.WILL_UPDATE }) },
          otherDiffs: {},
        },
      );
      const logicalId = 'Queue';

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.isDifferent).toBe(false);
      expect(queue.changeImpact).toBe('NO_CHANGE');
    });

    test('can handle undefined properties', async () => {
    // GIVEN
      const logicalId = 'Queue';

      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {} as any,
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'first' } },
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'second' } },
        {
          resourceType: { oldType: 'AWS::CDK::GREAT', newType: 'AWS::CDK::GREAT' },
          propertyDiffs: { QueueName: new PropertyDifference<string>( 'first', 'second', { changeImpact: ResourceImpact.WILL_UPDATE }) },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.isDifferent).toBe(false);
      expect(queue.changeImpact).toBe('NO_CHANGE');
    });

    test('can handle empty properties', async () => {
    // GIVEN
      const logicalId = 'Queue';

      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {
            propertyReplacementModes: {},
          } as any,
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'first' } },
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'second' } },
        {
          resourceType: { oldType: 'AWS::CDK::GREAT', newType: 'AWS::CDK::GREAT' },
          propertyDiffs: { QueueName: new PropertyDifference<string>( 'first', 'second', { changeImpact: ResourceImpact.WILL_UPDATE }) },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.isDifferent).toBe(false);
      expect(queue.changeImpact).toBe('NO_CHANGE');
    });

    test('can handle property without replacementMode', async () => {
    // GIVEN
      const logicalId = 'Queue';

      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {
            propertyReplacementModes: {
              QueueName: {} as any,
            },
          } as any,
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'first' } },
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'second' } },
        {
          resourceType: { oldType: 'AWS::CDK::GREAT', newType: 'AWS::CDK::GREAT' },
          propertyDiffs: { QueueName: new PropertyDifference<string>( 'first', 'second', { changeImpact: ResourceImpact.WILL_UPDATE }) },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.isDifferent).toBe(false);
      expect(queue.changeImpact).toBe('NO_CHANGE');
    });

    test('handles Never case', async () => {
    // GIVEN
      const logicalId = 'Queue';

      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {
            propertyReplacementModes: {
              QueueName: {
                replacementMode: 'Never',
              },
            },
          } as any,
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'first' } },
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'second' } },
        {
          resourceType: { oldType: 'AWS::CDK::GREAT', newType: 'AWS::CDK::GREAT' },
          propertyDiffs: { QueueName: new PropertyDifference<string>( 'first', 'second', { changeImpact: ResourceImpact.NO_CHANGE }) },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.changeImpact).toBe('WILL_UPDATE');
      expect(queue.isDifferent).toBe(true);
    });

    test('handles Conditionally case', async () => {
    // GIVEN
      const logicalId = 'Queue';

      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {
            propertyReplacementModes: {
              QueueName: {
                replacementMode: 'Conditionally',
              },
            },
          } as any,
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'first' } },
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'second' } },
        {
          resourceType: { oldType: 'AWS::CDK::GREAT', newType: 'AWS::CDK::GREAT' },
          propertyDiffs: { QueueName: new PropertyDifference<string>( 'first', 'second', { changeImpact: ResourceImpact.NO_CHANGE }) },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.changeImpact).toBe('MAY_REPLACE');
      expect(queue.isDifferent).toBe(true);
    });

    test('handles Always case', async () => {
    // GIVEN
      const logicalId = 'Queue';

      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {
            propertyReplacementModes: {
              QueueName: {
                replacementMode: 'Always',
              },
            },
          } as any,
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'first' } },
        { Type: 'AWS::CDK::GREAT', Properties: { QueueName: 'second' } },
        {
          resourceType: { oldType: 'AWS::CDK::GREAT', newType: 'AWS::CDK::GREAT' },
          propertyDiffs: { QueueName: new PropertyDifference<string>( 'first', 'second', { changeImpact: ResourceImpact.NO_CHANGE }) },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.changeImpact).toBe('WILL_REPLACE');
      expect(queue.isDifferent).toBe(true);
    });

    test('returns if AWS::Serverless is resourcetype', async () => {
    // GIVEN
      const logicalId = 'Queue';

      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {
            propertyReplacementModes: {
              QueueName: {
                replacementMode: 'Always',
              },
            },
          } as any,
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AAWS::Serverless::IDK', Properties: { QueueName: 'first' } },
        { Type: 'AAWS::Serverless::IDK', Properties: { QueueName: 'second' } },
        {
          resourceType: { oldType: 'AWS::Serverless::IDK', newType: 'AWS::Serverless::IDK' },
          propertyDiffs: {
            QueueName: new PropertyDifference<string>( 'first', 'second',
              { changeImpact: ResourceImpact.WILL_ORPHAN }), // choose will_orphan to show that we're ignoring changeset
          },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.overrideDiffResourceChangeImpactWithChangeSetChangeImpact(logicalId, queue);

      // THEN
      expect(queue.changeImpact).toBe('WILL_ORPHAN');
      expect(queue.isDifferent).toBe(true);
    });
  });

  describe('addChangeSetPropertiesNotInTemplateDiff', () => {
    test('adds a change-set-only property with the impact derived from the change set', () => {
      // GIVEN - a resource already in the template diff (Other changed), plus a change-set-only
      // QueueName replacement that the template diff did not see.
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {
            resourceWasReplaced: true,
            resourceType: 'AWS::SQS::Queue',
            propertyReplacementModes: {
              QueueName: { replacementMode: 'Always' },
            },
          },
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::SQS::Queue', Properties: { QueueName: { Ref: 'P' }, Other: 'a' } },
        { Type: 'AWS::SQS::Queue', Properties: { QueueName: { Ref: 'P' }, Other: 'b' } },
        {
          resourceType: { oldType: 'AWS::SQS::Queue', newType: 'AWS::SQS::Queue' },
          propertyDiffs: { Other: new PropertyDifference<string>('a', 'b', { changeImpact: ResourceImpact.WILL_UPDATE }) },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.addChangeSetPropertiesNotInTemplateDiff('Queue', queue);

      // THEN
      expect(queue.propertyUpdates.QueueName).toBeDefined();
      expect(queue.propertyUpdates.QueueName.changeImpact).toBe(ResourceImpact.WILL_REPLACE);
      expect(queue.propertyUpdates.QueueName.isDifferent).toBe(true);
      expect(queue.changeImpact).toBe(ResourceImpact.WILL_REPLACE);
    });

    test('does not clobber a property already present in the template diff', () => {
      // GIVEN
      const existing = new PropertyDifference<string>('a', 'b', { changeImpact: ResourceImpact.WILL_UPDATE });
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Queue: {
            resourceWasReplaced: false,
            resourceType: 'AWS::SQS::Queue',
            propertyReplacementModes: {
              QueueName: { replacementMode: 'Always' },
            },
          },
        },
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'a' } },
        { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'b' } },
        {
          resourceType: { oldType: 'AWS::SQS::Queue', newType: 'AWS::SQS::Queue' },
          propertyDiffs: { QueueName: existing },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.addChangeSetPropertiesNotInTemplateDiff('Queue', queue);

      // THEN - the existing template-derived diff is untouched (impact not promoted to replace)
      expect(queue.propertyUpdates.QueueName).toBe(existing);
      expect(queue.propertyUpdates.QueueName.changeImpact).toBe(ResourceImpact.WILL_UPDATE);
    });

    test('skips SAM resources (changeset describes the transformed resource)', () => {
      // GIVEN
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {
          Fn: {
            resourceWasReplaced: false,
            resourceType: 'AWS::Serverless::Function',
            propertyReplacementModes: {
              CodeUri: { replacementMode: 'Always' },
            },
          },
        },
      });
      const fn = new ResourceDifference(
        { Type: 'AWS::Serverless::Function', Properties: { CodeUri: 'a' } },
        { Type: 'AWS::Serverless::Function', Properties: { CodeUri: 'a' } },
        {
          resourceType: { oldType: 'AWS::Serverless::Function', newType: 'AWS::Serverless::Function' },
          propertyDiffs: {},
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.addChangeSetPropertiesNotInTemplateDiff('Fn', fn);

      // THEN - nothing added
      expect(fn.propertyUpdates.CodeUri).toBeUndefined();
      expect(fn.isDifferent).toBe(false);
    });

    test('does nothing when the resource is not in the change set', () => {
      // GIVEN
      const templateAndChangeSetDiffMerger = new TemplateAndChangeSetDiffMerger({
        changeSet: {},
        changeSetResources: {},
      });
      const queue = new ResourceDifference(
        { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'a' } },
        { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'b' } },
        {
          resourceType: { oldType: 'AWS::SQS::Queue', newType: 'AWS::SQS::Queue' },
          propertyDiffs: { QueueName: new PropertyDifference<string>('a', 'b', { changeImpact: ResourceImpact.WILL_UPDATE }) },
          otherDiffs: {},
        },
      );

      // WHEN
      templateAndChangeSetDiffMerger.addChangeSetPropertiesNotInTemplateDiff('Queue', queue);

      // THEN - unchanged
      expect(Object.keys(queue.propertyUpdates)).toEqual(['QueueName']);
      expect(queue.propertyUpdates.QueueName.changeImpact).toBe(ResourceImpact.WILL_UPDATE);
    });
  });

  test('changeset with Add action preserves addition diff', () => {
    // GIVEN
    const currentTemplate = {};
    const newTemplate = {
      Resources: {
        NewRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
            },
          },
        },
      },
    };

    // WHEN - changeset says the resource is being added (no Details for Add actions)
    const diff = fullDiff(currentTemplate, newTemplate, {
      Changes: [{
        Type: 'Resource',
        ResourceChange: {
          Action: 'Add',
          LogicalResourceId: 'NewRole',
          ResourceType: 'AWS::IAM::Role',
        },
      }],
    });

    // THEN - the resource should still show as an addition, not be filtered out
    expect(diff.differenceCount).toBe(1);
    expect(diff.resources.differenceCount).toBe(1);
    const roleDiff = diff.resources.get('NewRole');
    expect(roleDiff.isAddition).toBe(true);
    expect(roleDiff.isDifferent).toBe(true);
  });
});
