import type { ConstructNode } from '../../lib';
import { indexNodesByPath } from '../../lib/core/tree-utils';

const node = (path: string, children: ConstructNode[] = []): ConstructNode => ({
  path,
  id: path.split('/').pop() ?? path,
  children,
});

describe('indexNodesByPath', () => {
  test('returns empty Map for empty tree', () => {
    expect(indexNodesByPath([]).size).toBe(0);
  });

  test('indexes a flat tree by node.path', () => {
    const idx = indexNodesByPath([node('Stack1'), node('Stack2')]);
    expect(idx.get('Stack1')!.path).toBe('Stack1');
    expect(idx.get('Stack2')!.path).toBe('Stack2');
  });

  test('indexes deep descendants', () => {
    const tree = [
      node('Stack1', [
        node('Stack1/MyBucket', [
          node('Stack1/MyBucket/Resource'),
        ]),
      ]),
    ];
    const idx = indexNodesByPath(tree);
    expect(idx.get('Stack1/MyBucket/Resource')).toBeDefined();
    expect(idx.size).toBe(3);
  });
});
