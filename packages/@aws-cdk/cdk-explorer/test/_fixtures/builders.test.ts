// Sanity tests for the fixture builders. If these pass, every other test
// that uses the builders inherits a known-good baseline.
import {
  buildFlatAssembly,
  buildNestedAssembly,
  buildNestedStackAssembly,
  buildNonTypeScriptAssembly,
  cleanupFixture,
  withMalformedValidationReport,
  withValidationReport,
} from './builders';
import { readAssembly } from '../../lib';

describe('fixture builders', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  test('buildFlatAssembly produces a readAssembly-compatible directory', () => {
    dir = buildFlatAssembly({
      stacks: [{
        id: 'Stack1',
        resources: [{
          id: 'MyBucket',
          logicalId: 'MyBucketF68F3FF0',
          cfnType: 'AWS::S3::Bucket',
        }],
      }],
    });

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error(`expected success, got ${result.status}: ${(result as any).message ?? ''}`);

    expect(result.data.tree).toHaveLength(1);
    expect(result.data.tree[0].id).toBe('Stack1');
  });

  test('buildFlatAssembly attaches logicalId and cfnType correctly', () => {
    dir = buildFlatAssembly({
      stacks: [{
        id: 'Stack1',
        resources: [{
          id: 'MyBucket',
          logicalId: 'MyBucketF68F3FF0',
          cfnType: 'AWS::S3::Bucket',
        }],
      }],
    });

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    const resource = result.data.tree[0].children[0].children[0];
    expect(resource.path).toBe('Stack1/MyBucket/Resource');
    expect(resource.logicalId).toBe('MyBucketF68F3FF0');
    expect(resource.type).toBe('AWS::S3::Bucket');
    // No creationTrace was set, so the resolver finds no frames -> undefined.
    expect(resource.sourceLocation).toBeUndefined();
  });

  test('buildFlatAssembly with creationTrace exposes sourceLocation', () => {
    dir = buildFlatAssembly({
      stacks: [{
        id: 'Stack1',
        resources: [{
          id: 'MyBucket',
          logicalId: 'MyBucketF68F3FF0',
          cfnType: 'AWS::S3::Bucket',
          // Mirrors aws-cdk-lib's renderCallStackJustMyCode output: node_modules
          // and node: frames are pre-filtered into skip-placeholder lines,
          // so the first frame that parses is the user's call site.
          creationTrace: [
            '    ...node_modules-aws-cdk-lib...',
            '    at new MyStack (/project/lib/my-stack.ts:12:5)',
          ],
        }],
      }],
    });

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    const resource = result.data.tree[0].children[0].children[0];
    expect(resource.sourceLocation).toEqual({
      file: '/project/lib/my-stack.ts',
      line: 12,
      column: 5,
    });
  });

  test('buildNestedAssembly produces a Stage-based assembly with correct tree', () => {
    dir = buildNestedAssembly({
      stages: [{
        id: 'Prod',
        stacks: [{
          id: 'Service',
          resources: [{
            id: 'MyBucket',
            logicalId: 'MyBucketABC',
            cfnType: 'AWS::S3::Bucket',
          }],
        }],
      }],
    });

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.tree).toHaveLength(1);

    const stage = result.data.tree[0];
    expect(stage.id).toBe('Prod');

    const stack = stage.children[0];
    expect(stack.path).toBe('Prod/Service');

    const resource = stack.children[0].children[0];
    expect(resource.path).toBe('Prod/Service/MyBucket/Resource');
    expect(resource.logicalId).toBe('MyBucketABC');
    expect(resource.type).toBe('AWS::S3::Bucket');
  });

  test('buildNestedStackAssembly enriches resources INSIDE a NestedStack via parent metadata', () => {
    // aws-cdk-lib emits nested-stack-internal metadata into the parent's
    // artifact metadata. Verifies buildNode's metadata inheritance handles
    // this with no separate walker.
    dir = buildNestedStackAssembly({
      parent: {
        id: 'Parent',
        resources: [{
          id: 'TopBucket',
          logicalId: 'TopBucketAAA',
          cfnType: 'AWS::S3::Bucket',
        }],
        nestedStacks: [{
          id: 'MyNestedStack',
          resources: [{
            id: 'NestedBucket',
            logicalId: 'NestedBucketBBB',
            cfnType: 'AWS::S3::Bucket',
            creationTrace: [
              '    ...node_modules-aws-cdk-lib...',
              '    at new MyNestedStack (/project/lib/nested.ts:7:5)',
            ],
          }],
        }],
      },
    });

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    const parent = result.data.tree[0];
    expect(parent.id).toBe('Parent');

    const topBucket = parent.children.find((c) => c.id === 'TopBucket')!.children[0];
    expect(topBucket.logicalId).toBe('TopBucketAAA');
    expect(topBucket.type).toBe('AWS::S3::Bucket');

    const nestedStack = parent.children.find((c) => c.id === 'MyNestedStack')!;
    expect(nestedStack.path).toBe('Parent/MyNestedStack');

    const nestedBucket = nestedStack.children[0].children[0];
    expect(nestedBucket.path).toBe('Parent/MyNestedStack/NestedBucket/Resource');
    expect(nestedBucket.logicalId).toBe('NestedBucketBBB');
    expect(nestedBucket.type).toBe('AWS::S3::Bucket');
    expect(nestedBucket.sourceLocation).toEqual({
      file: '/project/lib/nested.ts',
      line: 7,
      column: 5,
    });
  });

  test('buildNonTypeScriptAssembly returns success without crashing', () => {
    dir = buildNonTypeScriptAssembly();

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.tree).toHaveLength(1);
    const stack = result.data.tree[0];
    expect(stack.id).toBe('Stack1');
    // Non-TS apps emit no aws:cdk:logicalId metadata.
    expect(stack.sourceLocation).toBeUndefined();
  });

  test('withMalformedValidationReport surfaces the error without breaking the tree', () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [] }],
    });
    withMalformedValidationReport(dir);

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.tree).toHaveLength(1);
    expect(result.data.violations).toBeUndefined();
    expect(result.data.violationsError).toBeTruthy();
  });

  test('withValidationReport produces a parseable report', () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [] }],
    });
    withValidationReport(dir, {
      pluginReports: [{
        pluginName: 'test',
        conclusion: 'failure',
        violations: [{
          ruleName: 'no-bad-things',
          description: 'no',
          severity: 'error',
          violatingConstructs: [{ constructPath: 'Stack1/x' }],
        }],
      }],
    });

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.violationsError).toBeUndefined();
    expect(result.data.violations?.pluginReports[0].pluginName).toBe('test');
  });
});
