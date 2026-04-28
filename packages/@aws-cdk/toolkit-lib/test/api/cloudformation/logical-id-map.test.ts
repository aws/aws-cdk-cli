import { buildLogicalToPathMap } from '../../../lib/api/cloudformation/logical-id-map';

function mockArtifact(template: any, metadata: Array<{ path: string; type: string; data: string }> = []) {
  return {
    get template() {
      return template;
    },
    findMetadataByType: (type: string) => metadata.filter(m => m.type === type),
  } as any;
}

describe('buildLogicalToPathMap', () => {
  test('maps resources from template aws:cdk:path metadata', () => {
    const stack = mockArtifact({
      Resources: {
        MyBucket: {
          Type: 'AWS::S3::Bucket',
          Metadata: { 'aws:cdk:path': 'Stack/MyBucket/Resource' },
        },
      },
    });

    const map = buildLogicalToPathMap(stack);

    expect(map.toPath).toEqual({ MyBucket: 'Stack/MyBucket/Resource' });
    expect(map.toLogicalId).toEqual({ 'Stack/MyBucket/Resource': 'MyBucket' });
  });

  test('includes nested stack as a single element', () => {
    const stack = mockArtifact({
      Resources: {
        MyBucket: {
          Type: 'AWS::S3::Bucket',
          Metadata: { 'aws:cdk:path': 'Stack/MyBucket/Resource' },
        },
        NestedStackResource: {
          Type: 'AWS::CloudFormation::Stack',
          Properties: { TemplateURL: 'https://url' },
          Metadata: { 'aws:cdk:path': 'Stack/NestedStack/Resource' },
        },
      },
    });

    const map = buildLogicalToPathMap(stack);

    expect(map.toPath.NestedStackResource).toBe('Stack/NestedStack/Resource');
    expect(map.toLogicalId['Stack/NestedStack/Resource']).toBe('NestedStackResource');
  });

  test('excludes nested stack resources with duplicate logical IDs', () => {
    const sharedLogicalId = 'TestBucket560B80BC';
    const stack = mockArtifact(
      {
        Resources: {
          [sharedLogicalId]: {
            Type: 'AWS::S3::Bucket',
            Metadata: { 'aws:cdk:path': 'Stack/TestBucket/Resource' },
          },
          NestedStackResource: {
            Type: 'AWS::CloudFormation::Stack',
            Metadata: { 'aws:cdk:path': 'Stack/NestedStack/Resource' },
          },
        },
      },
      [
        { path: '/Stack/TestBucket/Resource', type: 'aws:cdk:logicalId', data: sharedLogicalId },
        { path: '/Stack/NestedStack/TestBucket/Resource', type: 'aws:cdk:logicalId', data: sharedLogicalId },
      ],
    );

    const map = buildLogicalToPathMap(stack);

    // Should use the template's path, not the nested stack's path from metadata
    expect(map.toPath[sharedLogicalId]).toBe('Stack/TestBucket/Resource');
    expect(map.toLogicalId['Stack/TestBucket/Resource']).toBe(sharedLogicalId);
    // Should NOT contain the nested stack's resource path
    expect(Object.values(map.toPath)).not.toContain('/Stack/NestedStack/TestBucket/Resource');
  });

  test('maps non-resource entries from cloud assembly metadata', () => {
    const stack = mockArtifact(
      {
        Parameters: {
          MyParam: { Type: 'String' },
        },
        Conditions: {
          MyCond: { 'Fn::Equals': ['a', 'b'] },
        },
      },
      [
        { path: '/Stack/MyParam', type: 'aws:cdk:logicalId', data: 'MyParam' },
        { path: '/Stack/MyCond', type: 'aws:cdk:logicalId', data: 'MyCond' },
      ],
    );

    const map = buildLogicalToPathMap(stack);

    expect(map.toPath.MyParam).toBe('/Stack/MyParam');
    expect(map.toPath.MyCond).toBe('/Stack/MyCond');
    expect(map.toLogicalId['/Stack/MyParam']).toBe('MyParam');
    expect(map.toLogicalId['/Stack/MyCond']).toBe('MyCond');
  });

  test('filters out non-resource metadata entries not in template', () => {
    const stack = mockArtifact(
      {
        Parameters: {
          MyParam: { Type: 'String' },
        },
      },
      [
        { path: '/Stack/MyParam', type: 'aws:cdk:logicalId', data: 'MyParam' },
        { path: '/Stack/NestedStack/OtherParam', type: 'aws:cdk:logicalId', data: 'OtherParam' },
      ],
    );

    const map = buildLogicalToPathMap(stack);

    expect(map.toPath.MyParam).toBe('/Stack/MyParam');
    expect(map.toPath.OtherParam).toBeUndefined();
  });

  test('handles empty template', () => {
    const stack = mockArtifact({});

    const map = buildLogicalToPathMap(stack);

    expect(map.toPath).toEqual({});
    expect(map.toLogicalId).toEqual({});
  });

  test('handles resources without aws:cdk:path metadata', () => {
    const stack = mockArtifact({
      Resources: {
        MyBucket: {
          Type: 'AWS::S3::Bucket',
        },
      },
    });

    const map = buildLogicalToPathMap(stack);

    expect(map.toPath.MyBucket).toBeUndefined();
  });

  test('falls back to cloud assembly metadata for resources without aws:cdk:path', () => {
    const stack = mockArtifact(
      {
        Resources: {
          MyBucket: {
            Type: 'AWS::S3::Bucket',
            Properties: {},
          },
        },
      },
      [
        { path: '/Stack/MyConstruct/Resource', type: 'aws:cdk:logicalId', data: 'MyBucket' },
      ],
    );

    const map = buildLogicalToPathMap(stack);

    expect(map.toPath.MyBucket).toBe('/Stack/MyConstruct/Resource');
    expect(map.toLogicalId['/Stack/MyConstruct/Resource']).toBe('MyBucket');
  });

  test('handles all non-resource template sections', () => {
    const stack = mockArtifact(
      {
        Parameters: { P1: { Type: 'String' } },
        Conditions: { C1: { 'Fn::Equals': ['a', 'b'] } },
        Outputs: { O1: { Value: 'v' } },
        Rules: { R1: {} },
        Mappings: { M1: {} },
      },
      [
        { path: '/Stack/P1', type: 'aws:cdk:logicalId', data: 'P1' },
        { path: '/Stack/C1', type: 'aws:cdk:logicalId', data: 'C1' },
        { path: '/Stack/O1', type: 'aws:cdk:logicalId', data: 'O1' },
        { path: '/Stack/R1', type: 'aws:cdk:logicalId', data: 'R1' },
        { path: '/Stack/M1', type: 'aws:cdk:logicalId', data: 'M1' },
      ],
    );

    const map = buildLogicalToPathMap(stack);

    expect(Object.keys(map.toPath)).toEqual(expect.arrayContaining(['P1', 'C1', 'O1', 'R1', 'M1']));
    expect(Object.keys(map.toLogicalId)).toHaveLength(5);
  });

  test('bidirectional map is consistent', () => {
    const stack = mockArtifact(
      {
        Resources: {
          Bucket1: {
            Type: 'AWS::S3::Bucket',
            Metadata: { 'aws:cdk:path': 'Stack/Bucket1/Resource' },
          },
          Bucket2: {
            Type: 'AWS::S3::Bucket',
            Metadata: { 'aws:cdk:path': 'Stack/Bucket2/Resource' },
          },
        },
        Parameters: {
          Param1: { Type: 'String' },
        },
      },
      [
        { path: '/Stack/Param1', type: 'aws:cdk:logicalId', data: 'Param1' },
      ],
    );

    const map = buildLogicalToPathMap(stack);

    // Every entry in toPath should have a reverse in toLogicalId
    for (const [logicalId, path] of Object.entries(map.toPath)) {
      expect(map.toLogicalId[path]).toBe(logicalId);
    }
    // Every entry in toLogicalId should have a reverse in toPath
    for (const [path, logicalId] of Object.entries(map.toLogicalId)) {
      expect(map.toPath[logicalId]).toBe(path);
    }
  });
});
