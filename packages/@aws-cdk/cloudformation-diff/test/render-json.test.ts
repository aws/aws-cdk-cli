import { fullDiff, ResourceImpact, templateDiffToJson } from '../lib';
import { poldoc, policy, resource, role, template } from './util';

describe('resources', () => {
  test('renders an added resource', () => {
    const diff = fullDiff({}, template({
      MyBucket: resource('AWS::S3::Bucket', { BucketName: 'my-bucket' }),
    }));

    const json = templateDiffToJson(diff);

    expect(json.resources).toEqual({
      MyBucket: expect.objectContaining({
        newResourceType: 'AWS::S3::Bucket',
        changeImpact: ResourceImpact.WILL_CREATE,
        isAddition: true,
        isRemoval: false,
      }),
    });
    expect(json.differenceCount).toBe(1);
    expect(json.permissionsBroadened).toBe(false);
  });

  test('renders a removed resource', () => {
    const diff = fullDiff(template({
      MyBucket: resource('AWS::S3::Bucket', { BucketName: 'my-bucket' }),
    }), {});

    const json = templateDiffToJson(diff);

    expect(json.resources).toEqual({
      MyBucket: expect.objectContaining({
        oldResourceType: 'AWS::S3::Bucket',
        changeImpact: ResourceImpact.WILL_DESTROY,
        isAddition: false,
        isRemoval: true,
      }),
    });
  });

  test('renders property-level changes with change impact', () => {
    const diff = fullDiff(template({
      MyBucket: resource('AWS::S3::Bucket', { BucketName: 'old-name' }),
    }), template({
      MyBucket: resource('AWS::S3::Bucket', { BucketName: 'new-name' }),
    }));

    const json = templateDiffToJson(diff);

    expect(json.resources?.MyBucket.propertyDiffs).toEqual({
      BucketName: {
        oldValue: 'old-name',
        newValue: 'new-name',
        changeImpact: ResourceImpact.WILL_REPLACE,
      },
    });
  });

  test('renders non-property attribute changes', () => {
    const diff = fullDiff(template({
      MyBucket: { Type: 'AWS::S3::Bucket', Properties: {}, DeletionPolicy: 'Delete' },
    }), template({
      MyBucket: { Type: 'AWS::S3::Bucket', Properties: {}, DeletionPolicy: 'Retain' },
    }));

    const json = templateDiffToJson(diff);

    expect(json.resources?.MyBucket.otherDiffs).toEqual({
      DeletionPolicy: {
        oldValue: 'Delete',
        newValue: 'Retain',
      },
    });
  });

  test('the JSON document round-trips through JSON.stringify', () => {
    const diff = fullDiff(template({
      MyBucket: resource('AWS::S3::Bucket', { BucketName: 'old-name' }),
    }), template({
      MyBucket: resource('AWS::S3::Bucket', { BucketName: 'new-name' }),
      MyRole: role({
        AssumeRolePolicyDocument: poldoc({
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
        }),
      }),
    }));

    const json = templateDiffToJson(diff);

    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe('iamChanges', () => {
  test('renders IAM statement additions with resources and attributes', () => {
    const diff = fullDiff({}, template({
      MyPolicy: policy({
        Roles: [{ Ref: 'MyRole' }],
        PolicyDocument: poldoc({
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::my-bucket/*',
        }),
      }),
    }));

    const json = templateDiffToJson(diff);

    expect(json.permissionsBroadened).toBe(true);
    expect(json.iamChanges).toEqual({
      statementAdditions: [
        {
          type: 'parsed',
          value: {
            effect: 'Allow',
            resources: { not: false, values: ['arn:aws:s3:::my-bucket/*'] },
            principals: { not: false, values: ['AWS:${MyRole}'] },
            actions: { not: false, values: ['s3:GetObject'] },
          },
        },
      ],
    });
  });

  test('renders IAM statement removals', () => {
    const diff = fullDiff(template({
      MyPolicy: policy({
        Roles: [{ Ref: 'MyRole' }],
        PolicyDocument: poldoc({
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: '*',
        }),
      }),
    }), {});

    const json = templateDiffToJson(diff);

    expect(json.iamChanges?.statementRemovals).toHaveLength(1);
    expect(json.permissionsBroadened).toBe(false);
  });

  test('renders managed policy changes', () => {
    const diff = fullDiff(template({
      MyRole: role({
        AssumeRolePolicyDocument: poldoc({
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
        }),
      }),
    }), template({
      MyRole: role({
        AssumeRolePolicyDocument: poldoc({
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
        }),
        ManagedPolicyArns: ['arn:aws:iam::aws:policy/AdministratorAccess'],
      }),
    }));

    const json = templateDiffToJson(diff);

    expect(json.iamChanges?.managedPolicyAdditions).toEqual([
      {
        type: 'parsed',
        value: {
          identityArn: '${MyRole}',
          managedPolicyArn: 'arn:aws:iam::aws:policy/AdministratorAccess',
        },
      },
    ]);
  });

  test('renders unparseable statements as unparseable', () => {
    const diff = fullDiff({}, template({
      MyPolicy: policy({
        Roles: [{ Ref: 'MyRole' }],
        PolicyDocument: poldoc({
          'Fn::If': ['SomeCondition', { Effect: 'Allow', Action: '*', Resource: '*' }, { Ref: 'AWS::NoValue' }],
        }),
      }),
    }));

    const json = templateDiffToJson(diff);

    expect(json.iamChanges?.statementAdditions).toEqual([
      expect.objectContaining({ type: 'unparseable' }),
    ]);
  });

  test('omits iamChanges when there are none', () => {
    const diff = fullDiff(template({
      MyBucket: resource('AWS::S3::Bucket', {}),
    }), template({
      MyBucket: resource('AWS::S3::Bucket', { BucketName: 'name' }),
    }));

    const json = templateDiffToJson(diff);

    expect(json.iamChanges).toBeUndefined();
  });
});

describe('securityGroupChanges', () => {
  test('renders added ingress rules', () => {
    const diff = fullDiff({}, template({
      MySecurityGroup: resource('AWS::EC2::SecurityGroup', {
        GroupDescription: 'My security group',
        SecurityGroupIngress: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            CidrIp: '0.0.0.0/0',
          },
        ],
      }),
    }));

    const json = templateDiffToJson(diff);

    expect(json.permissionsBroadened).toBe(true);
    expect(json.securityGroupChanges?.ingressRuleAdditions).toEqual([
      expect.objectContaining({
        ipProtocol: 'tcp',
        fromPort: 443,
        toPort: 443,
        peer: { kind: 'cidr-ip', ip: '0.0.0.0/0' },
      }),
    ]);
  });
});

describe('template sections', () => {
  test('renders parameter, output and condition changes', () => {
    const diff = fullDiff({
      Parameters: { Stage: { Type: 'String', Default: 'dev' } },
      Outputs: { MyOutput: { Value: 'old' } },
      Conditions: { IsProd: { 'Fn::Equals': [{ Ref: 'Stage' }, 'prod'] } },
    }, {
      Parameters: { Stage: { Type: 'String', Default: 'prod' } },
      Outputs: { MyOutput: { Value: 'new' } },
      Conditions: { IsProd: { 'Fn::Equals': [{ Ref: 'Stage' }, 'production'] } },
    });

    const json = templateDiffToJson(diff);

    expect(json.parameters?.Stage).toEqual({
      oldValue: { Type: 'String', Default: 'dev' },
      newValue: { Type: 'String', Default: 'prod' },
    });
    expect(json.outputs?.MyOutput).toEqual({
      oldValue: { Value: 'old' },
      newValue: { Value: 'new' },
    });
    expect(json.conditions?.IsProd).toBeDefined();
  });

  test('renders description changes', () => {
    const diff = fullDiff({ Description: 'old description' }, { Description: 'new description' });

    const json = templateDiffToJson(diff);

    expect(json.description).toEqual({
      oldValue: 'old description',
      newValue: 'new description',
    });
  });

  test('an empty diff renders an empty document', () => {
    const diff = fullDiff(template({
      MyBucket: resource('AWS::S3::Bucket', {}),
    }), template({
      MyBucket: resource('AWS::S3::Bucket', {}),
    }));

    const json = templateDiffToJson(diff);

    expect(json).toEqual({
      permissionsBroadened: false,
      differenceCount: 0,
    });
  });
});
