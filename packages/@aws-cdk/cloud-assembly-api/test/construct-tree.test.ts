import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildConstructTree, CloudAssembly, ConstructIndex, type ConstructTreeNode } from '../lib';
import { rimraf } from './util';

const node = (nodePath: string, children: ConstructTreeNode[] = []): ConstructTreeNode => ({
  path: nodePath,
  id: nodePath.split('/').pop() ?? nodePath,
  children,
});

describe('ConstructIndex', () => {
  test('empty tree has size 0 and no nodes', () => {
    const index = ConstructIndex.fromTree([]);
    expect(index.size).toBe(0);
    expect([...index]).toEqual([]);
  });

  test('byPath looks up nodes in a flat tree', () => {
    const index = ConstructIndex.fromTree([node('Stack1'), node('Stack2')]);
    expect(index.byPath('Stack1')!.path).toBe('Stack1');
    expect(index.byPath('Stack2')!.path).toBe('Stack2');
    expect(index.byPath('Missing')).toBeUndefined();
  });

  test('byPath indexes deep descendants', () => {
    const tree = [
      node('Stack1', [
        node('Stack1/MyBucket', [
          node('Stack1/MyBucket/Resource'),
        ]),
      ]),
    ];
    const index = ConstructIndex.fromTree(tree);
    expect(index.byPath('Stack1/MyBucket/Resource')).toBeDefined();
    expect(index.size).toBe(3);
  });

  test('iterates every node in pre-order', () => {
    const tree = [
      node('Stack1', [
        node('Stack1/A'),
        node('Stack1/B', [node('Stack1/B/Resource')]),
      ]),
    ];
    const paths = [...ConstructIndex.fromTree(tree)].map((n) => n.path);
    expect(paths).toEqual(['Stack1', 'Stack1/A', 'Stack1/B', 'Stack1/B/Resource']);
  });

  test('preserves the concrete node type through byPath and iteration', () => {
    interface Rich extends ConstructTreeNode {
      readonly children: readonly Rich[];
      readonly label: string;
    }
    const rich = (richPath: string, label: string): Rich => ({ path: richPath, id: richPath, label, children: [] });
    const index = ConstructIndex.fromTree<Rich>([rich('A', 'alpha')]);
    expect(index.byPath('A')?.label).toBe('alpha');
    expect([...index][0].label).toBe('alpha');
  });
});

describe('buildConstructTree', () => {
  let dir: string;
  afterEach(() => dir && rimraf(dir));

  // Deliberately non-default so the tests prove we read the filename from the
  // manifest's tree artifact rather than assuming "tree.json".
  const TREE_FILE = 'foo.tree.json';

  function writeAssembly(opts: { withTree: boolean }): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caa-tree-'));
    const artifacts: Record<string, unknown> = {
      MyStack: {
        type: 'aws:cloudformation:stack',
        environment: 'aws://111/us-east-1',
        properties: { templateFile: 'template.json' },
        metadata: {
          '/MyStack/Bucket/Resource': [{ type: 'aws:cdk:logicalId', data: 'BucketABC' }],
        },
      },
    };
    if (opts.withTree) {
      artifacts.Tree = { type: 'cdk:tree', properties: { file: TREE_FILE } };
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '0.0.0', artifacts }));
    fs.writeFileSync(path.join(dir, 'template.json'), '{}');
    if (opts.withTree) {
      const tree = {
        version: 'tree-0.1',
        tree: {
          id: 'App',
          path: '',
          children: {
            MyStack: {
              id: 'MyStack',
              path: 'MyStack',
              children: {
                Bucket: {
                  id: 'Bucket',
                  path: 'MyStack/Bucket',
                  children: {
                    Resource: {
                      id: 'Resource',
                      path: 'MyStack/Bucket/Resource',
                      attributes: { 'aws:cdk:cloudformation:type': 'AWS::S3::Bucket' },
                    },
                  },
                },
                // Internal node that must be filtered out.
                CDKMetadata: { id: 'CDKMetadata', path: 'MyStack/CDKMetadata' },
              },
            },
          },
        },
      };
      fs.writeFileSync(path.join(dir, TREE_FILE), JSON.stringify(tree));
    }
    return dir;
  }

  test('reads the tree filename from the manifest and joins logicalId + CFN type', () => {
    const assembly = new CloudAssembly(writeAssembly({ withTree: true }));
    const tree = buildConstructTree(assembly, (fields) => fields);

    const resource = ConstructIndex.fromTree(tree).byPath('MyStack/Bucket/Resource');
    expect(resource?.type).toBe('AWS::S3::Bucket');
    expect(resource?.logicalId).toBe('BucketABC');
  });

  test('filters cdk-internal nodes (e.g. CDKMetadata)', () => {
    const assembly = new CloudAssembly(writeAssembly({ withTree: true }));
    const paths = [...ConstructIndex.fromTree(buildConstructTree(assembly, (f) => f))].map((n) => n.path);
    expect(paths).toContain('MyStack/Bucket');
    expect(paths).not.toContain('MyStack/CDKMetadata');
  });

  test('passes the owning stack and construct path to the decorate callback', () => {
    const assembly = new CloudAssembly(writeAssembly({ withTree: true }));
    const tree = buildConstructTree(assembly, (fields, stack, constructPath) => ({
      ...fields,
      stackId: stack?.id,
      decoratedPath: constructPath,
    }));
    const resource = ConstructIndex.fromTree(tree).byPath('MyStack/Bucket/Resource');
    expect((resource as any)?.decoratedPath).toBe('MyStack/Bucket/Resource');
    expect((resource as any)?.stackId).toBe('MyStack');
  });

  test('returns an empty tree when the assembly has no tree artifact', () => {
    const assembly = new CloudAssembly(writeAssembly({ withTree: false }));
    expect(buildConstructTree(assembly, (f) => f)).toEqual([]);
  });
});

describe('buildConstructTree -- nested stacks', () => {
  let dir: string;
  afterEach(() => dir && rimraf(dir));

  const TREE_FILE = 'tree.json';

  interface NestedOpts {
    /** Logical ID of the bucket inside the nested stack (parent bucket is always 'ParentBucket'). */
    readonly nestedBucketLogicalId?: string;
    /** false simulates --no-asset-metadata: the CfnStack carries no aws:asset:path. */
    readonly withAssetMetadata?: boolean;
    /** false simulates a missing/unstaged asset: the nested template file isn't written. */
    readonly writeNestedTemplate?: boolean;
  }

  /**
   * Emits the real aws-cdk-lib NestedStack topology: a `Nested` construct, its
   * sibling `Nested.NestedStack/Nested.NestedStackResource` AWS::CloudFormation::Stack
   * (carrying aws:asset:path), and a bucket in both the parent and nested stacks.
   * The `Nested` node deliberately carries a jsii fqn that does NOT end in
   * ".NestedStack" -- so every test here also proves detection is by the sibling,
   * not the fqn (P2b).
   */
  function writeNestedAssembly(opts: NestedOpts = {}): string {
    const withAsset = opts.withAssetMetadata ?? true;
    const writeNested = opts.writeNestedTemplate ?? true;
    const nestedBucketLid = opts.nestedBucketLogicalId ?? 'NestedBucket';

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caa-nested-'));

    const nestedStackResource: Record<string, unknown> = { Type: 'AWS::CloudFormation::Stack' };
    if (withAsset) nestedStackResource.Metadata = { 'aws:asset:path': 'nested.template.json' };
    const parentTemplate = { Resources: { ParentBucket: { Type: 'AWS::S3::Bucket' }, NestedStackRes: nestedStackResource } };
    const nestedTemplate = { Resources: { [nestedBucketLid]: { Type: 'AWS::S3::Bucket' } } };

    const artifacts = {
      MyStack: {
        type: 'aws:cloudformation:stack',
        environment: 'aws://111/us-east-1',
        properties: { templateFile: 'template.json' },
        metadata: {
          '/MyStack/Bucket/Resource': [{ type: 'aws:cdk:logicalId', data: 'ParentBucket' }],
          '/MyStack/Nested/Bucket/Resource': [{ type: 'aws:cdk:logicalId', data: nestedBucketLid }],
          '/MyStack/Nested.NestedStack/Nested.NestedStackResource': [{ type: 'aws:cdk:logicalId', data: 'NestedStackRes' }],
        },
      },
      Tree: { type: 'cdk:tree', properties: { file: TREE_FILE } },
    };

    const tree = {
      version: 'tree-0.1',
      tree: {
        id: 'App',
        path: '',
        children: {
          MyStack: {
            id: 'MyStack',
            path: 'MyStack',
            children: {
              'Bucket': {
                id: 'Bucket',
                path: 'MyStack/Bucket',
                children: { Resource: { id: 'Resource', path: 'MyStack/Bucket/Resource', attributes: { 'aws:cdk:cloudformation:type': 'AWS::S3::Bucket' } } },
              },
              'Nested': {
                id: 'Nested',
                path: 'MyStack/Nested',
                // jsii fqn intentionally NOT ending in ".NestedStack" (P2b regression).
                constructInfo: { fqn: 'my-lib.DatabaseNestedStack', version: '1.0.0' },
                children: {
                  Bucket: {
                    id: 'Bucket',
                    path: 'MyStack/Nested/Bucket',
                    children: { Resource: { id: 'Resource', path: 'MyStack/Nested/Bucket/Resource', attributes: { 'aws:cdk:cloudformation:type': 'AWS::S3::Bucket' } } },
                  },
                },
              },
              'Nested.NestedStack': {
                id: 'Nested.NestedStack',
                path: 'MyStack/Nested.NestedStack',
                children: {
                  'Nested.NestedStackResource': {
                    id: 'Nested.NestedStackResource',
                    path: 'MyStack/Nested.NestedStack/Nested.NestedStackResource',
                    attributes: { 'aws:cdk:cloudformation:type': 'AWS::CloudFormation::Stack' },
                  },
                },
              },
            },
          },
        },
      },
    };

    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '0.0.0', artifacts }));
    fs.writeFileSync(path.join(dir, 'template.json'), JSON.stringify(parentTemplate));
    if (writeNested) fs.writeFileSync(path.join(dir, 'nested.template.json'), JSON.stringify(nestedTemplate));
    fs.writeFileSync(path.join(dir, TREE_FILE), JSON.stringify(tree));
    return dir;
  }

  const templateFileOf = (assemblyDir: string, nodePath: string): string | undefined =>
    ConstructIndex.fromTree(buildConstructTree(new CloudAssembly(assemblyDir), (f) => f)).byPath(nodePath)?.templateFile;

  test('resolves nested resources to the nested template and parent resources to the parent template', () => {
    const d = writeNestedAssembly();
    expect(templateFileOf(d, 'MyStack/Bucket/Resource')).toBe(path.join(d, 'template.json'));
    expect(templateFileOf(d, 'MyStack/Nested/Bucket/Resource')).toBe(path.join(d, 'nested.template.json'));
  });

  test('resolves parent and nested twins (same logical ID) to their own templates', () => {
    // NestedStack resets the logical-ID namespace, so both buckets are "ParentBucket".
    // Positional threading must still send each to its own template.
    const d = writeNestedAssembly({ nestedBucketLogicalId: 'ParentBucket' });
    expect(templateFileOf(d, 'MyStack/Bucket/Resource')).toBe(path.join(d, 'template.json'));
    expect(templateFileOf(d, 'MyStack/Nested/Bucket/Resource')).toBe(path.join(d, 'nested.template.json'));
  });

  test('detects the NestedStack by its sibling resource, not the construct fqn (jsii subclass)', () => {
    // The fixture's Nested node fqn is "my-lib.DatabaseNestedStack" (does not end in
    // ".NestedStack"); a suffix gate would miss it and mis-inherit the parent template.
    const d = writeNestedAssembly();
    expect(templateFileOf(d, 'MyStack/Nested/Bucket/Resource')).toBe(path.join(d, 'nested.template.json'));
  });

  test('yields no templateFile when the nested template is missing/unreadable', () => {
    const d = writeNestedAssembly({ writeNestedTemplate: false });
    expect(templateFileOf(d, 'MyStack/Nested/Bucket/Resource')).toBeUndefined();
    expect(templateFileOf(d, 'MyStack/Bucket/Resource')).toBe(path.join(d, 'template.json'));
  });

  test('yields no templateFile when asset metadata is absent (--no-asset-metadata)', () => {
    const d = writeNestedAssembly({ withAssetMetadata: false });
    expect(templateFileOf(d, 'MyStack/Nested/Bucket/Resource')).toBeUndefined();
  });
});
