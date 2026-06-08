import { ConstructIndex, type ConstructTreeNode } from '../lib';

const node = (path: string, children: ConstructTreeNode[] = []): ConstructTreeNode => ({
  path,
  id: path.split('/').pop() ?? path,
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
    const rich = (path: string, label: string): Rich => ({ path, id: path, label, children: [] });
    const index = ConstructIndex.fromTree<Rich>([rich('A', 'alpha')]);
    expect(index.byPath('A')?.label).toBe('alpha');
    expect([...index][0].label).toBe('alpha');
  });
});
