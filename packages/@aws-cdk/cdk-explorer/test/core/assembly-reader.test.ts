import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readAssembly, type AssemblyData, type AssemblyReadResult, type ConstructNode } from '../../lib';
import {
  buildFlatAssembly,
  buildNestedAssembly,
  buildNestedStackAssembly,
  buildNonTypeScriptAssembly,
  cleanupFixture,
  withMalformedValidationReport,
  withValidationReport,
  withVersionlessValidationReport,
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

  test('returns not-found for nonexistent directory', async () => {
    expect((await readAssembly('/nonexistent/path')).status).toBe('not-found');
  });

  test('returns not-found for directory without manifest.json', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-empty-'));
    try {
      expect((await readAssembly(empty)).status).toBe('not-found');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('parses tree from a flat assembly', async () => {
    dir = buildFlatAssembly({
      stacks: [
        { id: 'Stack1', resources: [{ id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket' }] },
        { id: 'Stack2', resources: [{ id: 'MyQueue', logicalId: 'MyQueueE6CA6235', cfnType: 'AWS::SQS::Queue' }] },
      ],
    });

    const data = expectSuccess(await readAssembly(dir));

    expect(data.tree).toHaveLength(2);
    expect(data.tree.map((n) => n.id).sort()).toEqual(['Stack1', 'Stack2']);
  });

  test('enriches resource nodes with logicalId and cfnType', async () => {
    dir = buildFlatAssembly({
      stacks: [{
        id: 'Stack1',
        resources: [{
          id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket',
        }],
      }],
    });
    const data = expectSuccess(await readAssembly(dir));

    const resource = findNode(data.tree, 'Stack1/MyBucket/Resource')!;
    expect(resource.logicalId).toBe('MyBucketF68F3FF0');
    expect(resource.type).toBe('AWS::S3::Bucket');
  });

  test('non-resource constructs (L2 wrappers) have no logicalId or type', async () => {
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
    const data = expectSuccess(await readAssembly(dir));

    const wrapper = findNode(data.tree, 'Stack1/MyBucket')!;
    expect(wrapper.logicalId).toBeUndefined();
    expect(wrapper.type).toBeUndefined();
  });

  test('children are arrays', async () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [{ id: 'X', logicalId: 'X', cfnType: 'AWS::S3::Bucket' }] }],
    });
    const data = expectSuccess(await readAssembly(dir));

    expect(Array.isArray(data.tree)).toBe(true);
    expect(Array.isArray(data.tree[0].children)).toBe(true);
  });

  test('returns error for malformed manifest', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-malformed-'));
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), 'not json{{{');
    try {
      const result = await readAssembly(tmpDir);
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

  test('parses validation report when present', async () => {
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

    const data = expectSuccess(await readAssembly(dir));

    expect(data.violations).toBeDefined();
    expect(data.violations!.pluginReports[0].conclusion).toBe('failure');
    expect(data.violations!.pluginReports[0].violations[0].ruleName).toBe('no-public-buckets');
    expect(data.violationsError).toBeUndefined();
  });

  test('returns undefined violations when report file is absent', async () => {
    dir = buildFlatAssembly({ stacks: [{ id: 'Stack1', resources: [] }] });
    const data = expectSuccess(await readAssembly(dir));

    expect(data.violations).toBeUndefined();
    expect(data.violationsError).toBeUndefined();
  });

  test('malformed validation report does not crash the tree read', async () => {
    dir = buildFlatAssembly({ stacks: [{ id: 'Stack1', resources: [] }] });
    withMalformedValidationReport(dir);

    const data = expectSuccess(await readAssembly(dir));

    expect(data.tree).toHaveLength(1);
    expect(data.violations).toBeUndefined();
    expect(data.violationsError).toBeTruthy();
  });

  test('loads a version-less validation report (legacy aws-cdk-lib shape)', async () => {
    dir = buildFlatAssembly({ stacks: [{ id: 'Stack1', resources: [] }] });
    withVersionlessValidationReport(dir);

    const data = expectSuccess(await readAssembly(dir));

    expect(data.tree).toHaveLength(1);
    expect(data.violations).toBeDefined();
    expect(data.violationsError).toBeUndefined();
  });
});

describe('readAssembly with Stage-based (nested-assembly) apps', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  test('preserves Stage grouping node in the tree', async () => {
    dir = buildNestedAssembly({
      stages: [{ id: 'Prod', stacks: [{ id: 'Service', resources: [] }] }],
    });
    const data = expectSuccess(await readAssembly(dir));

    const stage = data.tree.find((n) => n.id === 'Prod')!;
    expect(stage.path).toBe('Prod');
  });

  test('resources inside a Stage stack get logicalId and cfnType', async () => {
    dir = buildNestedAssembly({
      stages: [{
        id: 'Prod',
        stacks: [{
          id: 'Service',
          resources: [{ id: 'MyBucket', logicalId: 'MyBucketABC', cfnType: 'AWS::S3::Bucket' }],
        }],
      }],
    });
    const data = expectSuccess(await readAssembly(dir));

    const resource = findNode(data.tree, 'Prod/Service/MyBucket/Resource')!;
    expect(resource.logicalId).toBe('MyBucketABC');
    expect(resource.type).toBe('AWS::S3::Bucket');
  });

  test('multi-stage apps route metadata to the correct nested assembly', async () => {
    // Two stages, same construct ids — proves we don't cross-contaminate
    // metadata from one stage's nested-assembly manifest to another's.
    dir = buildNestedAssembly({
      stages: [
        { id: 'Prod', stacks: [{ id: 'Service', resources: [{ id: 'X', logicalId: 'ProdX', cfnType: 'AWS::S3::Bucket' }] }] },
        { id: 'Staging', stacks: [{ id: 'Service', resources: [{ id: 'X', logicalId: 'StagingX', cfnType: 'AWS::S3::Bucket' }] }] },
      ],
    });
    const data = expectSuccess(await readAssembly(dir));

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

  test('non-TypeScript app returns success with no source enrichment, no crash', async () => {
    dir = buildNonTypeScriptAssembly();

    const data = expectSuccess(await readAssembly(dir));

    expect(data.tree).toHaveLength(1);
    const stack = data.tree[0];
    expect(stack.id).toBe('Stack1');
    expect(stack.sourceLocation).toBeUndefined();
  });
});

describe('readAssembly resource templateFile', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  test('sets templateFile to the resource\'s own stack template, none on wrappers', async () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [{ id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket' }] }],
    });
    const data = expectSuccess(await readAssembly(dir));

    expect(findNode(data.tree, 'Stack1/MyBucket/Resource')!.templateFile)
      .toBe(path.join(dir!, 'Stack1.template.json'));
    // L2 wrapper is not a CFN resource -> no template.
    expect(findNode(data.tree, 'Stack1/MyBucket')!.templateFile).toBeUndefined();
  });

  test('resolves nested-stack resources to the nested template, not the parent', async () => {
    dir = buildNestedStackAssembly({
      parent: {
        id: 'Parent',
        resources: [{ id: 'TopBucket', logicalId: 'TopBucketABC', cfnType: 'AWS::S3::Bucket' }],
        nestedStacks: [{
          id: 'MyNested',
          resources: [{ id: 'NestedQueue', logicalId: 'NestedQueueXYZ', cfnType: 'AWS::SQS::Queue' }],
        }],
      },
    });
    const data = expectSuccess(await readAssembly(dir));

    // Top-level resource lives in the parent template.
    expect(findNode(data.tree, 'Parent/TopBucket/Resource')!.templateFile)
      .toBe(path.join(dir!, 'Parent.template.json'));
    // The resource inside the NestedStack lives in the nested template.
    expect(findNode(data.tree, 'Parent/MyNested/NestedQueue/Resource')!.templateFile)
      .toBe(path.join(dir!, 'ParentMyNested.nested.template.json'));
  });

  test('keeps templates distinct when two stacks share a logical id (stack-relative ids)', async () => {
    // Same-shape stacks produce the SAME stack-relative logicalId in different
    // templates; each resource must resolve to its OWN stack's template.
    dir = buildFlatAssembly({
      stacks: [
        { id: 'Prod', resources: [{ id: 'Data', logicalId: 'DataX', cfnType: 'AWS::S3::Bucket' }] },
        { id: 'Dev', resources: [{ id: 'Data', logicalId: 'DataX', cfnType: 'AWS::S3::Bucket' }] },
      ],
    });
    const data = expectSuccess(await readAssembly(dir));

    expect(findNode(data.tree, 'Prod/Data/Resource')!.templateFile).toBe(path.join(dir!, 'Prod.template.json'));
    expect(findNode(data.tree, 'Dev/Data/Resource')!.templateFile).toBe(path.join(dir!, 'Dev.template.json'));
  });

  test('resolves a parent resource and its nested-stack twin that share a logical id', async () => {
    // A NestedStack resets the logical-ID namespace, so a parent resource and a
    // resource in its own nested stack can share an id. The globally-unique
    // construct path (aws:cdk:path) disambiguates them.
    dir = buildNestedStackAssembly({
      parent: {
        id: 'Parent',
        resources: [{ id: 'Data', logicalId: 'DataX', cfnType: 'AWS::S3::Bucket' }],
        nestedStacks: [{
          id: 'Nested',
          resources: [{ id: 'Data', logicalId: 'DataX', cfnType: 'AWS::S3::Bucket' }],
        }],
      },
    });
    const data = expectSuccess(await readAssembly(dir));

    expect(findNode(data.tree, 'Parent/Data/Resource')!.templateFile)
      .toBe(path.join(dir!, 'Parent.template.json'));
    expect(findNode(data.tree, 'Parent/Nested/Data/Resource')!.templateFile)
      .toBe(path.join(dir!, 'ParentNested.nested.template.json'));
  });

  test('resolves a resource in a doubly-nested stack to the innermost template', async () => {
    dir = buildNestedStackAssembly({
      parent: {
        id: 'Parent',
        resources: [],
        nestedStacks: [{
          id: 'Outer',
          resources: [{ id: 'OuterFn', logicalId: 'OuterFnABC', cfnType: 'AWS::Lambda::Function' }],
          nestedStacks: [{
            id: 'Inner',
            resources: [{ id: 'InnerQueue', logicalId: 'InnerQueueXYZ', cfnType: 'AWS::SQS::Queue' }],
          }],
        }],
      },
    });
    const data = expectSuccess(await readAssembly(dir));

    expect(findNode(data.tree, 'Parent/Outer/OuterFn/Resource')!.templateFile)
      .toBe(path.join(dir!, 'ParentOuter.nested.template.json'));
    expect(findNode(data.tree, 'Parent/Outer/Inner/InnerQueue/Resource')!.templateFile)
      .toBe(path.join(dir!, 'ParentOuterInner.nested.template.json'));
  });

  test('skips an unreadable nested template instead of failing the whole read', async () => {
    dir = buildNestedStackAssembly({
      parent: {
        id: 'Parent',
        resources: [{ id: 'TopBucket', logicalId: 'TopBucketABC', cfnType: 'AWS::S3::Bucket' }],
        nestedStacks: [{
          id: 'Nested',
          resources: [{ id: 'NestedQueue', logicalId: 'NestedQueueXYZ', cfnType: 'AWS::SQS::Queue' }],
        }],
      },
    });
    fs.rmSync(path.join(dir, 'ParentNested.nested.template.json'));
    // Still a success: the missing nested template degrades only its subtree.
    const data = expectSuccess(await readAssembly(dir));
    expect(findNode(data.tree, 'Parent/TopBucket/Resource')!.templateFile)
      .toBe(path.join(dir!, 'Parent.template.json'));
    expect(findNode(data.tree, 'Parent/Nested/NestedQueue/Resource')!.templateFile).toBeUndefined();
  });

  test('resolves templateFile without path metadata (positional, not id-based)', async () => {
    // Resolution threads the template down the construct tree, so it works
    // regardless of --no-path-metadata (no reliance on aws:cdk:path).
    dir = buildFlatAssembly({
      pathMetadata: false,
      stacks: [{ id: 'Stack1', resources: [{ id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket' }] }],
    });
    const data = expectSuccess(await readAssembly(dir));

    expect(findNode(data.tree, 'Stack1/MyBucket/Resource')!.templateFile)
      .toBe(path.join(dir!, 'Stack1.template.json'));
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
