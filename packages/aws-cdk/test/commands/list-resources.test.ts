import { Bootstrapper } from '../../lib/api/bootstrap';
import { Deployments } from '../../lib/api/deployments';
import { CdkToolkit } from '../../lib/cli/cdk-toolkit';
import { listResources, explainResource } from '../../lib/commands/list-resources';
import { instanceMockFrom, MockCloudExecutable } from '../_helpers';

describe('listResources', () => {
  let cloudFormation: jest.Mocked<Deployments>;
  let bootstrapper: jest.Mocked<Bootstrapper>;

  beforeEach(() => {
    jest.resetAllMocks();

    cloudFormation = instanceMockFrom(Deployments);

    bootstrapper = instanceMockFrom(Bootstrapper);
    bootstrapper.bootstrapEnvironment.mockResolvedValue({ noOp: false, outputs: {} } as any);
  });

  test('lists resources from a single stack', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            MyBucket: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                'aws:cdk:path': 'TestStack/MyBucket/Resource',
              },
            },
            MyFunction: {
              Type: 'AWS::Lambda::Function',
              Metadata: {
                'aws:cdk:path': 'TestStack/MyFunction/Resource',
              },
              DependsOn: ['MyBucket'],
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resources = await listResources(toolkit, { selector: 'TestStack' });

    expect(resources).toHaveLength(2);
    expect(resources).toContainEqual(expect.objectContaining({
      logicalId: 'MyBucket',
      type: 'AWS::S3::Bucket',
      constructPath: 'MyBucket',
    }));
    expect(resources).toContainEqual(expect.objectContaining({
      logicalId: 'MyFunction',
      type: 'AWS::Lambda::Function',
      constructPath: 'MyFunction',
      dependsOn: ['MyBucket'],
    }));
  });

  test('returns empty array for stack with no resources', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'EmptyStack',
        template: { Resources: {} },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resources = await listResources(toolkit, { selector: 'EmptyStack' });

    expect(resources).toHaveLength(0);
  });

  test('handles missing metadata gracefully', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            NoMetadata: {
              Type: 'AWS::S3::Bucket',
              // No Metadata
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resources = await listResources(toolkit, { selector: 'TestStack' });

    expect(resources).toHaveLength(1);
    expect(resources[0].constructPath).toBe('<unknown>');
  });

  test('extracts Fn::ImportValue references', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            MyResource: {
              Type: 'AWS::Lambda::Function',
              Metadata: {
                'aws:cdk:path': 'TestStack/MyResource/Resource',
              },
              Properties: {
                Environment: {
                  Variables: {
                    BUCKET_ARN: { 'Fn::ImportValue': 'SharedBucketArn' },
                  },
                },
              },
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resources = await listResources(toolkit, { selector: 'TestStack' });

    expect(resources).toHaveLength(1);
    expect(resources[0].imports).toContain('SharedBucketArn');
  });

  test('maps DeletionPolicy to removalPolicy', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            RetainedBucket: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                'aws:cdk:path': 'TestStack/RetainedBucket/Resource',
              },
              DeletionPolicy: 'Retain',
            },
            DeletedBucket: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                'aws:cdk:path': 'TestStack/DeletedBucket/Resource',
              },
              DeletionPolicy: 'Delete',
            },
            SnapshotBucket: {
              Type: 'AWS::RDS::DBInstance',
              Metadata: {
                'aws:cdk:path': 'TestStack/SnapshotBucket/Resource',
              },
              DeletionPolicy: 'Snapshot',
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resources = await listResources(toolkit, { selector: 'TestStack' });

    const retained = resources.find(r => r.logicalId === 'RetainedBucket');
    const deleted = resources.find(r => r.logicalId === 'DeletedBucket');
    const snapshot = resources.find(r => r.logicalId === 'SnapshotBucket');

    expect(retained?.removalPolicy).toBe('retain');
    expect(deleted?.removalPolicy).toBe('destroy');
    expect(snapshot?.removalPolicy).toBe('snapshot');
  });

  test('sorts resources by type and logical ID', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            ZFunction: {
              Type: 'AWS::Lambda::Function',
              Metadata: { 'aws:cdk:path': 'TestStack/ZFunction/Resource' },
            },
            AFunction: {
              Type: 'AWS::Lambda::Function',
              Metadata: { 'aws:cdk:path': 'TestStack/AFunction/Resource' },
            },
            MyBucket: {
              Type: 'AWS::S3::Bucket',
              Metadata: { 'aws:cdk:path': 'TestStack/MyBucket/Resource' },
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resources = await listResources(toolkit, { selector: 'TestStack' });

    // Should be sorted: Lambda::Function (A then Z), then S3::Bucket
    expect(resources[0].logicalId).toBe('AFunction');
    expect(resources[1].logicalId).toBe('ZFunction');
    expect(resources[2].logicalId).toBe('MyBucket');
  });

  test('filters by resource type (case-insensitive)', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            MyFunction: {
              Type: 'AWS::Lambda::Function',
              Metadata: { 'aws:cdk:path': 'TestStack/MyFunction/Resource' },
            },
            MyBucket: {
              Type: 'AWS::S3::Bucket',
              Metadata: { 'aws:cdk:path': 'TestStack/MyBucket/Resource' },
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    // Filter for lambda (lowercase)
    const lambdaResources = await listResources(toolkit, { selector: 'TestStack', type: 'lambda' });
    expect(lambdaResources).toHaveLength(1);
    expect(lambdaResources[0].type).toBe('AWS::Lambda::Function');

    // Filter for S3 (uppercase)
    const s3Resources = await listResources(toolkit, { selector: 'TestStack', type: 'S3' });
    expect(s3Resources).toHaveLength(1);
    expect(s3Resources[0].type).toBe('AWS::S3::Bucket');
  });

  test('hides Lambda::Permission by default', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            MyFunction: {
              Type: 'AWS::Lambda::Function',
              Metadata: { 'aws:cdk:path': 'TestStack/MyFunction/Resource' },
            },
            MyPermission: {
              Type: 'AWS::Lambda::Permission',
              Metadata: { 'aws:cdk:path': 'TestStack/MyPermission/Resource' },
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    // Without --all flag
    const defaultResources = await listResources(toolkit, { selector: 'TestStack' });
    expect(defaultResources).toHaveLength(1);
    expect(defaultResources[0].type).toBe('AWS::Lambda::Function');

    // With --all flag
    const allResources = await listResources(toolkit, { selector: 'TestStack', all: true });
    expect(allResources).toHaveLength(2);
  });

  test('shows Lambda::Permission when filtering by type', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            MyFunction: {
              Type: 'AWS::Lambda::Function',
              Metadata: { 'aws:cdk:path': 'TestStack/MyFunction/Resource' },
            },
            MyPermission: {
              Type: 'AWS::Lambda::Permission',
              Metadata: { 'aws:cdk:path': 'TestStack/MyPermission/Resource' },
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    // When filtering by type, hidden types should be included
    const permissionResources = await listResources(toolkit, { selector: 'TestStack', type: 'Permission' });
    expect(permissionResources).toHaveLength(1);
    expect(permissionResources[0].type).toBe('AWS::Lambda::Permission');
  });

  test('strips stack name prefix and /Resource suffix from construct paths', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'MyStack',
        template: {
          Resources: {
            MyBucket: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                'aws:cdk:path': 'MyStack/Api/Handler/Resource',
              },
            },
            MyFunction: {
              Type: 'AWS::Lambda::Function',
              Metadata: {
                'aws:cdk:path': 'MyStack/Api/Handler',
              },
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resources = await listResources(toolkit, { selector: 'MyStack' });

    const bucket = resources.find(r => r.logicalId === 'MyBucket');
    const fn = resources.find(r => r.logicalId === 'MyFunction');

    // Should strip 'MyStack/' prefix and '/Resource' suffix
    expect(bucket?.constructPath).toBe('Api/Handler');
    // Should only strip 'MyStack/' prefix (no /Resource suffix)
    expect(fn?.constructPath).toBe('Api/Handler');
  });

  test('handles DependsOn as string or array', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            ResourceA: {
              Type: 'AWS::S3::Bucket',
              Metadata: { 'aws:cdk:path': 'TestStack/ResourceA/Resource' },
            },
            ResourceB: {
              Type: 'AWS::S3::Bucket',
              Metadata: { 'aws:cdk:path': 'TestStack/ResourceB/Resource' },
              DependsOn: 'ResourceA', // String form
            },
            ResourceC: {
              Type: 'AWS::S3::Bucket',
              Metadata: { 'aws:cdk:path': 'TestStack/ResourceC/Resource' },
              DependsOn: ['ResourceA', 'ResourceB'], // Array form
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resources = await listResources(toolkit, { selector: 'TestStack' });

    const resourceA = resources.find(r => r.logicalId === 'ResourceA');
    const resourceB = resources.find(r => r.logicalId === 'ResourceB');
    const resourceC = resources.find(r => r.logicalId === 'ResourceC');

    expect(resourceA?.dependsOn).toEqual([]);
    expect(resourceB?.dependsOn).toEqual(['ResourceA']);
    expect(resourceC?.dependsOn).toEqual(['ResourceA', 'ResourceB']);
  });
});

describe('explainResource', () => {
  let cloudFormation: jest.Mocked<Deployments>;
  let bootstrapper: jest.Mocked<Bootstrapper>;

  beforeEach(() => {
    jest.resetAllMocks();

    cloudFormation = instanceMockFrom(Deployments);

    bootstrapper = instanceMockFrom(Bootstrapper);
    bootstrapper.bootstrapEnvironment.mockResolvedValue({ noOp: false, outputs: {} } as any);
  });

  test('returns detailed info for existing resource', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            MyBucket: {
              Type: 'AWS::S3::Bucket',
              Metadata: {
                'aws:cdk:path': 'TestStack/MyBucket/Resource',
              },
              Condition: 'CreateBucket',
              DeletionPolicy: 'Retain',
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resource = await explainResource(toolkit, {
      selector: 'TestStack',
      logicalId: 'MyBucket',
    });

    expect(resource).toBeDefined();
    expect(resource?.logicalId).toBe('MyBucket');
    expect(resource?.type).toBe('AWS::S3::Bucket');
    expect(resource?.condition).toBe('CreateBucket');
    expect(resource?.removalPolicy).toBe('retain');
  });

  test('returns undefined for non-existent resource', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: { Resources: {} },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resource = await explainResource(toolkit, {
      selector: 'TestStack',
      logicalId: 'NonExistent',
    });

    expect(resource).toBeUndefined();
  });

  test('includes update and creation policies', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            MyASG: {
              Type: 'AWS::AutoScaling::AutoScalingGroup',
              Metadata: {
                'aws:cdk:path': 'TestStack/MyASG/Resource',
              },
              UpdatePolicy: {
                AutoScalingRollingUpdate: {
                  MinInstancesInService: 1,
                },
              },
              CreationPolicy: {
                ResourceSignal: {
                  Count: 1,
                  Timeout: 'PT5M',
                },
              },
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    const resource = await explainResource(toolkit, {
      selector: 'TestStack',
      logicalId: 'MyASG',
    });

    expect(resource).toBeDefined();
    expect(resource?.updatePolicy).toBeDefined();
    expect(resource?.creationPolicy).toBeDefined();
    expect(JSON.parse(resource!.updatePolicy!)).toEqual({
      AutoScalingRollingUpdate: { MinInstancesInService: 1 },
    });
    expect(JSON.parse(resource!.creationPolicy!)).toEqual({
      ResourceSignal: { Count: 1, Timeout: 'PT5M' },
    });
  });

  test('returns undefined for non-matching stack selector', async () => {
    const cloudExecutable = await MockCloudExecutable.create({
      stacks: [{
        stackName: 'TestStack',
        template: {
          Resources: {
            MyBucket: {
              Type: 'AWS::S3::Bucket',
            },
          },
        },
        env: 'aws://123456789012/us-east-1',
      }],
    });

    const toolkit = new CdkToolkit({
      cloudExecutable,
      configuration: cloudExecutable.configuration,
      sdkProvider: cloudExecutable.sdkProvider,
      deployments: cloudFormation,
    });

    // When no stacks match the selector, explainResource returns undefined
    // (The CdkToolkit.resources() method handles throwing the appropriate error)
    const resource = await explainResource(toolkit, {
      selector: 'NonExistentStack',
      logicalId: 'MyBucket',
    });

    expect(resource).toBeUndefined();
  });
});
