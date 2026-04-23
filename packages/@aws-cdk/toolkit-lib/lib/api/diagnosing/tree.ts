export class Tree {
  private lines: string[];
  private readonly children: Tree[];

  constructor(text: string, children: Tree[] = []) {
    this.lines = text.split('\n');
    this.children = [...children];
  }

  public get text() {
    return this.lines.join('\n');
  }

  public set text(text: string) {
    this.lines = text.split('\n');
  }

  public addChild(tree: Tree) {
    this.children.push(tree);
  }

  public height(): number {
    return this.lines.length + sum(this.children.map(c => c.height()));
  }

  public render(): string {
    return this._render().join('\n');
  }

  public toString() {
    return this.render();
  }

  private _render(): string[] {
    const ret: string[] = [];
    ret.push(...this.lines);
    for (let i = 0; i < this.children.length; i++) {
      const isLastChild = i === this.children.length - 1;

      let bullet;
      let hanger;
      if (isLastChild) {
        bullet = '  └── ';
        hanger = '      ';
      } else {
        bullet = '  ├── ';
        hanger = '  │   ';
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

function sum(xs: Iterable<number>): number {
  let ret = 0;
  for (const x of xs) {
    ret += x;
  }
  return ret;
}
