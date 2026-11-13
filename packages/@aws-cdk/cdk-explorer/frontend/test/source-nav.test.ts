import type { WebConstructNode } from '../../lib/web-shared/protocol';
import { SourceAndTemplateIndex } from '../src/source-and-template-index';

/**
 * Exercises the SPA-side index that powers source and template navigation.
 * Inputs are `WebConstructNode`s exactly as `/api/tree` serves them, so these
 * assertions are about the client's interpretation of that wire format.
 */
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
    templateLocation: props.templateFile && props.logicalId
      ? { file: props.templateFile, logicalId: props.logicalId }
      : undefined,
    sourceLocation: props.file !== undefined ? { file: props.file, line: props.line ?? 0 } : undefined,
    children: props.children ?? [],
  };
}

/** A fully-navigable construct: source location plus template coordinates. */
function navigable(path: string, file: string, line: number, children?: WebConstructNode[]): WebConstructNode {
  return node({ path, logicalId: path.replace(/\W/g, ''), templateFile: 'App.template.json', file, line, children });
}

describe('SourceAndTemplateIndex', () => {
  test('an empty tree indexes nothing', () => {
    const index = SourceAndTemplateIndex.fromTree([]);

    expect(index.size).toBe(0);
    expect(index.sourceFileNames).toEqual([]);
    expect(index.templateFileNames).toEqual([]);
  });

  test('collects the distinct source and template files, sorted', () => {
    const index = SourceAndTemplateIndex.fromTree([
      navigable('App/Bucket', 'app.ts', 10),
      navigable('App/Queue', 'app.ts', 20),
      navigable('App/Table', 'db.ts', 5),
    ]);

    expect(index.sourceFileNames).toEqual(['app.ts', 'db.ts']);
    expect(index.templateFileNames).toEqual(['App.template.json']);
  });

  test('indexes every construct by path, including nested ones', () => {
    const index = SourceAndTemplateIndex.fromTree([
      navigable('App/Outer', 'app.ts', 10, [navigable('App/Outer/Inner', 'app.ts', 12)]),
    ]);

    expect(index.size).toBe(2);
    expect(index.construct('App/Outer/Inner')!.id).toBe('Inner');
    expect(index.construct('App/Nope')).toBeUndefined();
  });

  test('ignores a construct with neither source nor template location', () => {
    // Still addressable by path, just not navigable from either direction.
    const index = SourceAndTemplateIndex.fromTree([node({ path: 'App/Opaque' })]);

    expect(index.construct('App/Opaque')).toBeDefined();
    expect(index.sourceFileNames).toEqual([]);
    expect(index.templateFileNames).toEqual([]);
  });
});

describe('SourceAndTemplateIndex.sourceFileConstructs', () => {
  const index = SourceAndTemplateIndex.fromTree([
    navigable('App/Bucket', 'app.ts', 10),
    navigable('App/Queue', 'app.ts', 20),
    navigable('App/Table', 'db.ts', 5),
  ]);

  test('groups a file constructs by their definition line', () => {
    // Source anchors are exact lines; the SPA decorates those lines and does
    // not claim the lines in between.
    const byLine = index.sourceFileConstructs('app.ts');

    expect(paths(byLine)).toEqual({ 10: ['App/Bucket'], 20: ['App/Queue'] });
  });

  test('keeps the files apart', () => {
    expect(paths(index.sourceFileConstructs('db.ts'))).toEqual({ 5: ['App/Table'] });
  });

  test('returns nothing for a file with no constructs', () => {
    expect(index.sourceFileConstructs('unknown.ts')).toEqual({});
  });

  test('lists every construct anchored to a shared line, authored parent first', () => {
    // The real VPC case: the parent and all its synthesized children are
    // anchored to the single `new Vpc(...)` line. The tree is walked in
    // pre-order, so the construct the user wrote leads the list.
    const shared = SourceAndTemplateIndex.fromTree([
      navigable('Net/Vpc', 'net.ts', 11, [
        navigable('Net/Vpc/PublicSubnet1', 'net.ts', 11, [
          navigable('Net/Vpc/PublicSubnet1/NatGateway', 'net.ts', 11),
        ]),
      ]),
    ]);

    expect(paths(shared.sourceFileConstructs('net.ts'))).toEqual({
      11: ['Net/Vpc', 'Net/Vpc/PublicSubnet1', 'Net/Vpc/PublicSubnet1/NatGateway'],
    });
  });
});

describe('SourceAndTemplateIndex.templateConstructs', () => {
  test('maps each logical id in a template to its construct', () => {
    const index = SourceAndTemplateIndex.fromTree([
      navigable('App/Bucket', 'app.ts', 10),
      navigable('App/Queue', 'app.ts', 20),
    ]);

    const byLogicalId = index.templateConstructs('App.template.json');

    expect(Object.keys(byLogicalId).sort()).toEqual(['AppBucket', 'AppQueue']);
    expect(byLogicalId.AppBucket.path).toBe('App/Bucket');
  });

  test('returns nothing for a template with no constructs', () => {
    expect(SourceAndTemplateIndex.fromTree([]).templateConstructs('Nope.template.json')).toEqual({});
  });
});

/** Collapse a line-to-constructs map to a line-to-paths map, for readable assertions. */
function paths(byLine: Record<string, WebConstructNode[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(byLine).map(([line, nodes]) => [line, nodes.map((n) => n.path)]));
}
