import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readAssembly, type ConstructNode } from '../../lib';
import {
  buildFlatAssembly,
  buildNestedAssembly,
  buildNonTypeScriptAssembly,
  cleanupFixture,
  withMalformedValidationReport,
  withValidationReport,
} from '../_fixtures/builders';

describe('readAssembly', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  test('returns not-found for nonexistent directory', () => {
    expect(readAssembly('/nonexistent/path').status).toBe('not-found');
  });

  test('returns not-found for directory without manifest.json', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-empty-'));
    try {
      expect(readAssembly(empty).status).toBe('not-found');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('parses tree from a flat assembly', () => {
    dir = buildFlatAssembly({
      stacks: [
        { id: 'Stack1', resources: [{ id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket' }] },
        { id: 'Stack2', resources: [{ id: 'MyQueue', logicalId: 'MyQueueE6CA6235', cfnType: 'AWS::SQS::Queue' }] },
      ],
    });

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.tree).toHaveLength(2);
    expect(result.data.tree.map((n) => n.id).sort()).toEqual(['Stack1', 'Stack2']);
  });

  test('enriches resource nodes with logicalId and cfnType', () => {
    dir = buildFlatAssembly({
      stacks: [{
        id: 'Stack1',
        resources: [{
          id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket',
        }],
      }],
    });
    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    const resource = findNode(result.data.tree, 'Stack1/MyBucket/Resource')!;
    expect(resource.logicalId).toBe('MyBucketF68F3FF0');
    expect(resource.type).toBe('AWS::S3::Bucket');
  });

  test('non-resource constructs (L2 wrappers) have no logicalId or type', () => {
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

    const wrapper = findNode(result.data.tree, 'Stack1/MyBucket')!;
    expect(wrapper.logicalId).toBeUndefined();
    expect(wrapper.type).toBeUndefined();
  });

  test('children are arrays', () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [{ id: 'X', logicalId: 'X', cfnType: 'AWS::S3::Bucket' }] }],
    });
    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(Array.isArray(result.data.tree)).toBe(true);
    expect(Array.isArray(result.data.tree[0].children)).toBe(true);
  });

  test('returns error for malformed manifest', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-malformed-'));
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), 'not json{{{');
    try {
      const result = readAssembly(tmpDir);
      expect(result.status).toBe('error');
      if (result.status === 'error') expect(result.message).toBeTruthy();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('readAssembly with violations', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  test('parses validation report when present', () => {
    dir = buildFlatAssembly({ stacks: [{ id: 'Stack1', resources: [] }] });
    withValidationReport(dir, {
      pluginReports: [{
        pluginName: 'no-public-buckets-plugin',
        conclusion: 'failure',
        violations: [{
          ruleName: 'no-public-buckets',
          description: 'S3 must not be public',
          severity: 'error',
          violatingConstructs: [{
            constructPath: 'Stack1/MyBucket',
            cloudFormationResource: { templatePath: 'Stack1.template.json', logicalId: 'B1' },
          }],
        }],
      }],
    });

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.violations).toBeDefined();
    expect(result.data.violations!.pluginReports[0].conclusion).toBe('failure');
    expect(result.data.violations!.pluginReports[0].violations[0].ruleName).toBe('no-public-buckets');
    expect(result.data.violationsError).toBeUndefined();
  });

  test('returns undefined violations when report file is absent', () => {
    dir = buildFlatAssembly({ stacks: [{ id: 'Stack1', resources: [] }] });
    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.violations).toBeUndefined();
    expect(result.data.violationsError).toBeUndefined();
  });

  test('malformed validation report does not crash the tree read', () => {
    dir = buildFlatAssembly({ stacks: [{ id: 'Stack1', resources: [] }] });
    withMalformedValidationReport(dir);

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.tree).toHaveLength(1);
    expect(result.data.violations).toBeUndefined();
    expect(result.data.violationsError).toBeTruthy();
  });
});

describe('readAssembly with Stage-based (nested-assembly) apps', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  test('preserves Stage grouping node in the tree', () => {
    dir = buildNestedAssembly({
      stages: [{ id: 'Prod', stacks: [{ id: 'Service', resources: [] }] }],
    });
    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    const stage = result.data.tree.find((n) => n.id === 'Prod')!;
    expect(stage.path).toBe('Prod');
  });

  test('resources inside a Stage stack get logicalId and cfnType', () => {
    dir = buildNestedAssembly({
      stages: [{
        id: 'Prod',
        stacks: [{
          id: 'Service',
          resources: [{ id: 'MyBucket', logicalId: 'MyBucketABC', cfnType: 'AWS::S3::Bucket' }],
        }],
      }],
    });
    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    const resource = findNode(result.data.tree, 'Prod/Service/MyBucket/Resource')!;
    expect(resource.logicalId).toBe('MyBucketABC');
    expect(resource.type).toBe('AWS::S3::Bucket');
  });

  test('multi-stage apps route metadata to the correct nested assembly', () => {
    // Two stages, same construct ids — proves we don't cross-contaminate
    // metadata from one stage's nested-assembly manifest to another's.
    dir = buildNestedAssembly({
      stages: [
        { id: 'Prod', stacks: [{ id: 'Service', resources: [{ id: 'X', logicalId: 'ProdX', cfnType: 'AWS::S3::Bucket' }] }] },
        { id: 'Staging', stacks: [{ id: 'Service', resources: [{ id: 'X', logicalId: 'StagingX', cfnType: 'AWS::S3::Bucket' }] }] },
      ],
    });
    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(findNode(result.data.tree, 'Prod/Service/X/Resource')!.logicalId).toBe('ProdX');
    expect(findNode(result.data.tree, 'Staging/Service/X/Resource')!.logicalId).toBe('StagingX');
  });
});

describe('readAssembly graceful degradation', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  test('non-TypeScript app returns success with no source enrichment, no crash', () => {
    dir = buildNonTypeScriptAssembly();

    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');

    expect(result.data.tree).toHaveLength(1);
    const stack = result.data.tree[0];
    expect(stack.id).toBe('Stack1');
    expect(stack.sourceLocation).toBeUndefined();
  });
});

function findNode(nodes: readonly ConstructNode[], targetPath: string): ConstructNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    const found = findNode(node.children, targetPath);
    if (found) return found;
  }
  return undefined;
}
