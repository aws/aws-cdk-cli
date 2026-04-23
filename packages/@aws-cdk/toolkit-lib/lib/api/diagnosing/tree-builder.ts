import { Tree } from './tree';

export class TreeBuilder {
  private readonly root: TreeBuilderNode;

  constructor(private readonly rootText: string) {
    this.root = {
      tree: new Tree(rootText),
      children: {},
    };
  }

  public setNodeText(constructPath: string, nodeText: string) {
    this.obtainNode(constructPath).text = nodeText;
  }

  public render() {
    const out = this.root.tree.render();
    if (this.rootText) {
      return out;
    }
    // RootText is empty, hide the entire node (slice off the initial newline)
    return out.slice(1);
  }

  public toString() {
    return this.render();
  }

  private obtainNode(constructPath: string): Tree {
    const parts = constructPath.split('/');
    let cur = this.root;
    while (true) {
      const next = parts.shift();
      if (next === undefined) {
        return cur.tree;
      }

      const child = cur.children[next];
      if (child) {
        cur = child;
      } else {
        const tree = new Tree(next);
        cur.tree.addChild(tree);
        cur = cur.children[next] = {
          tree,
          children: {},
        };
      }
    }
  }
}

interface TreeBuilderNode {
  tree: Tree;
  children: Record<string, TreeBuilderNode>;
}

export function sideBySide(left: string[], sep: string, right: string[]) {
  const width = left.map(x => x.length).reduce((acc, n) => Math.max(acc, n), 0);

  const ret: string[] = [];
  for (let i = 0; i < left.length || i < right.length; i++) {
    const l = i < left.length ? left[i] : ' '.repeat(width);
    const r = i < right.length ? right[i] : '';
    ret.push(`${l}${sep}${r}`);
  }
  return ret;
}
