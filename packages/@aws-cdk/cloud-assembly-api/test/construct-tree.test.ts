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

  function writeAssembly(opts: { withTree: boolean }): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caa-tree-'));
    const manifest = {
      version: '0.0.0',
      artifacts: {
        Tree: { type: 'cdk:tree', properties: { file: 'tree.json' } },
        MyStack: {
          type: 'aws:cloudformation:stack',
          environment: 'aws://111/us-east-1',
          properties: { templateFile: 'template.json' },
          metadata: {
            '/MyStack/Bucket/Resource': [{ type: 'aws:cdk:logicalId', data: 'BucketABC' }],
          },
        },
      },
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
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
      fs.writeFileSync(path.join(dir, 'tree.json'), JSON.stringify(tree));
    }
    return dir;
  }

  test('joins tree.json with stack metadata: logicalId + CFN type', () => {
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

  test('returns an empty tree when tree.json is absent', () => {
    const assembly = new CloudAssembly(writeAssembly({ withTree: false }));
    expect(buildConstructTree(assembly, (f) => f)).toEqual([]);
  });
});
