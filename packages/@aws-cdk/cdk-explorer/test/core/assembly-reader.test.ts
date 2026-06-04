import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readAssembly, type AssemblyData, type AssemblyReadResult, type ConstructNode } from '../../lib';
import {
  buildFlatAssembly,
  buildNestedAssembly,
  buildNonTypeScriptAssembly,
  cleanupFixture,
  withMalformedValidationReport,
  withValidationReport,
} from '../_fixtures/builders';

/** Assert that readAssembly succeeded and return the typed data. */
function expectSuccess(result: AssemblyReadResult): AssemblyData {
  expect(result.status).toBe('success');
  // Cast is safe because expect() above would have failed the test on mismatch.
  return (result as Extract<AssemblyReadResult, { status: 'success' }>).data;
}

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

    const data = expectSuccess(readAssembly(dir));

    expect(data.tree).toHaveLength(2);
    expect(data.tree.map((n) => n.id).sort()).toEqual(['Stack1', 'Stack2']);
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
    const data = expectSuccess(readAssembly(dir));

    const resource = findNode(data.tree, 'Stack1/MyBucket/Resource')!;
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
    const data = expectSuccess(readAssembly(dir));

    const wrapper = findNode(data.tree, 'Stack1/MyBucket')!;
    expect(wrapper.logicalId).toBeUndefined();
    expect(wrapper.type).toBeUndefined();
  });

  test('children are arrays', () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [{ id: 'X', logicalId: 'X', cfnType: 'AWS::S3::Bucket' }] }],
    });
    const data = expectSuccess(readAssembly(dir));

    expect(Array.isArray(data.tree)).toBe(true);
    expect(Array.isArray(data.tree[0].children)).toBe(true);
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

    const data = expectSuccess(readAssembly(dir));

    expect(data.violations).toBeDefined();
    expect(data.violations!.pluginReports[0].conclusion).toBe('failure');
    expect(data.violations!.pluginReports[0].violations[0].ruleName).toBe('no-public-buckets');
    expect(data.violationsError).toBeUndefined();
  });

  test('returns undefined violations when report file is absent', () => {
    dir = buildFlatAssembly({ stacks: [{ id: 'Stack1', resources: [] }] });
    const data = expectSuccess(readAssembly(dir));

    expect(data.violations).toBeUndefined();
    expect(data.violationsError).toBeUndefined();
  });

  test('malformed validation report does not crash the tree read', () => {
    dir = buildFlatAssembly({ stacks: [{ id: 'Stack1', resources: [] }] });
    withMalformedValidationReport(dir);

    const data = expectSuccess(readAssembly(dir));

    expect(data.tree).toHaveLength(1);
    expect(data.violations).toBeUndefined();
    expect(data.violationsError).toBeTruthy();
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
    const data = expectSuccess(readAssembly(dir));

    const stage = data.tree.find((n) => n.id === 'Prod')!;
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
    const data = expectSuccess(readAssembly(dir));

    const resource = findNode(data.tree, 'Prod/Service/MyBucket/Resource')!;
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
    const data = expectSuccess(readAssembly(dir));

    expect(findNode(data.tree, 'Prod/Service/X/Resource')!.logicalId).toBe('ProdX');
    expect(findNode(data.tree, 'Staging/Service/X/Resource')!.logicalId).toBe('StagingX');
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

    const data = expectSuccess(readAssembly(dir));

    expect(data.tree).toHaveLength(1);
    const stack = data.tree[0];
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
