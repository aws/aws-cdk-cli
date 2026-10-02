import type { WebConstructNode } from '../../lib/web/protocol';
import { buildSourceAnchorIndex, findConstructAtLine } from '../../lib/web/source-nav';

function node(props: {
  path: string;
  logicalId?: string;
  templateFile?: string;
  file?: string;
  line?: number;
  children?: WebConstructNode[];
}): WebConstructNode {
  return {
    path: props.path,
    id: props.path.split('/').pop()!,
    logicalId: props.logicalId,
    templateFile: props.templateFile,
    sourceLocation: props.file !== undefined ? { file: props.file, line: props.line ?? 0, column: 0 } : undefined,
    children: props.children ?? [],
  };
}

/** A fully-navigable construct: has source location + template coordinates. */
function navigable(path: string, file: string, line: number, children?: WebConstructNode[]): WebConstructNode {
  return node({ path, logicalId: path.replace(/\W/g, ''), templateFile: 'App.template.json', file, line, children });
}

describe('buildSourceAnchorIndex', () => {
  test('returns an empty map for an empty tree', () => {
    expect(buildSourceAnchorIndex([]).size).toBe(0);
  });

  test('indexes navigable constructs grouped by file', () => {
    const index = buildSourceAnchorIndex([
      navigable('App/Bucket', 'app.ts', 10),
      navigable('App/Queue', 'app.ts', 20),
      navigable('App/Nested/Table', 'db.ts', 5),
    ]);

    expect([...index.keys()].sort()).toEqual(['app.ts', 'db.ts']);
    expect(index.get('app.ts')!.map((a) => a.node.path)).toEqual(['App/Bucket', 'App/Queue']);
    expect(index.get('db.ts')!.map((a) => a.node.path)).toEqual(['App/Nested/Table']);
  });

  test('walks children depth-first and sorts each file by line ascending', () => {
    const index = buildSourceAnchorIndex([
      navigable('App/Outer', 'app.ts', 30, [
        navigable('App/Outer/Inner', 'app.ts', 12),
      ]),
      navigable('App/First', 'app.ts', 4),
    ]);

    expect(index.get('app.ts')!.map((a) => a.line)).toEqual([4, 12, 30]);
  });

  test('excludes constructs missing a source location, templateFile, or logicalId', () => {
    const index = buildSourceAnchorIndex([
      node({ path: 'App/NoSource', logicalId: 'X', templateFile: 'App.template.json' }),
      node({ path: 'App/NoTemplate', logicalId: 'Y', file: 'app.ts', line: 1 }),
      node({ path: 'App/NoLogicalId', templateFile: 'App.template.json', file: 'app.ts', line: 2 }),
      navigable('App/Ok', 'app.ts', 3),
    ]);

    expect([...index.keys()]).toEqual(['app.ts']);
    expect(index.get('app.ts')!.map((a) => a.node.path)).toEqual(['App/Ok']);
  });
});

describe('findConstructAtLine', () => {
  const anchors = buildSourceAnchorIndex([
    navigable('App/Bucket', 'app.ts', 10),
    navigable('App/Queue', 'app.ts', 20),
  ]).get('app.ts');

  test('returns undefined when anchors are undefined', () => {
    expect(findConstructAtLine(undefined, 10)).toBeUndefined();
  });

  test('returns undefined for a line above the first construct', () => {
    expect(findConstructAtLine(anchors, 3)).toBeUndefined();
  });

  test('matches the construct on its exact definition line', () => {
    expect(findConstructAtLine(anchors, 10)!.path).toBe('App/Bucket');
    expect(findConstructAtLine(anchors, 20)!.path).toBe('App/Queue');
  });

  test('matches the nearest preceding construct for a line inside its block', () => {
    expect(findConstructAtLine(anchors, 15)!.path).toBe('App/Bucket');
  });

  test('matches the last construct for a line below all definitions', () => {
    expect(findConstructAtLine(anchors, 999)!.path).toBe('App/Queue');
  });

  test('returns undefined for an empty anchor list', () => {
    expect(findConstructAtLine([], 10)).toBeUndefined();
  });

  test('prefers the top-most construct when several share the nearest line', () => {
    // Mirrors the real VPC case: a parent and its synthesized children are all
    // anchored to the single `new Vpc(...)` line. Double-clicking that line
    // should land on the authored parent, not a deep synthetic child.
    const shared = buildSourceAnchorIndex([
      navigable('Net/Vpc', 'net.ts', 11, [
        navigable('Net/Vpc/PublicSubnet1', 'net.ts', 11),
        navigable('Net/Vpc/PublicSubnet1/NatGateway', 'net.ts', 11),
      ]),
    ]).get('net.ts');

    expect(findConstructAtLine(shared, 11)!.path).toBe('Net/Vpc');
    expect(findConstructAtLine(shared, 40)!.path).toBe('Net/Vpc');
  });
});
