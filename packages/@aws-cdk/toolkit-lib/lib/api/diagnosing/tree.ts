export class Tree {
  public text: TreeText;
  private readonly children: Tree[];

  constructor(text: TreeText, children: Tree[] = []) {
    this.text = text;
    this.children = [...children];
  }

  public addChild(tree: Tree) {
    this.children.push(tree);
  }

  public height(): number {
    return this.text.lineCount() + sum(this.children.map(c => c.height()));
  }

  public render(): string {
    return this._render().join('\n');
  }

  public toString() {
    return this.render();
  }

  private _render(): string[] {
    const ret: string[] = [];
    ret.push(...this.text.lines);
    for (let i = 0; i < this.children.length; i++) {
      const isLastChild = i === this.children.length - 1;

      let bullet;
      let hanger;
      if (isLastChild) {
        bullet = ' └─ ';
        hanger = '    ';
      } else {
        bullet = ' ├─ ';
        hanger = ' │  ';
      }

      const childRender = this.children[i]._render();
      for (let j = 0; j < childRender.length; j++) {
        const isFirstLine = j === 0;

        ret.push((isFirstLine ? bullet : hanger) + childRender[j]);
      }
    }
    return ret;
  }
}

export class TreeText {
  constructor(
    public header: string[] = [],
    public body: string[] = [],
    public footer: string[] = [],
  ) {
  }

  public get lines() {
    return [...this.header, ...this.body, ...this.footer];
  }

  public lineCount(): number {
    return this.header.length + this.body.length + this.footer.length;
  }
}

function sum(xs: Iterable<number>): number {
  let ret = 0;
  for (const x of xs) {
    ret += x;
  }
  return ret;
}
