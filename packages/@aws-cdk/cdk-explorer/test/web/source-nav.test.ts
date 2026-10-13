import { SourceAndTemplateIndex } from '../../frontend/source-and-template-index';
import type { WebConstructNode } from '../../lib/web/protocol';

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
    sourceLocation: props.file !== undefined ? { file: props.file, line: props.line ?? 0, column: 0 } : undefined,
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
    expect(index.sourceFiles).toEqual([]);
    expect(index.templateFiles).toEqual([]);
  });

  test('collects the distinct source and template files, sorted', () => {
    const index = SourceAndTemplateIndex.fromTree([
      navigable('App/Bucket', 'app.ts', 10),
      navigable('App/Queue', 'app.ts', 20),
      navigable('App/Table', 'db.ts', 5),
    ]);

    expect(index.sourceFiles).toEqual(['app.ts', 'db.ts']);
    expect(index.templateFiles).toEqual(['App.template.json']);
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
    expect(index.sourceFiles).toEqual([]);
    expect(index.templateFiles).toEqual([]);
  });
});

describe('SourceAndTemplateIndex.findBySourceLocation', () => {
  const index = SourceAndTemplateIndex.fromTree([
    navigable('App/Bucket', 'app.ts', 10),
    navigable('App/Queue', 'app.ts', 20),
  ]);

  test('matches a construct on its exact definition line', () => {
    expect(index.findBySourceLocation('app.ts', 10)!.path).toBe('App/Bucket');
    expect(index.findBySourceLocation('app.ts', 20)!.path).toBe('App/Queue');
  });

  test('matches the nearest preceding construct for a line inside its block', () => {
    // Source anchors are single lines, so a construct owns every line from its
    // definition down to the next one's.
    expect(index.findBySourceLocation('app.ts', 15)!.path).toBe('App/Bucket');
  });

  test('matches the last construct for a line below every definition', () => {
    expect(index.findBySourceLocation('app.ts', 999)!.path).toBe('App/Queue');
  });

  test('returns undefined above the first construct in the file', () => {
    expect(index.findBySourceLocation('app.ts', 3)).toBeUndefined();
  });

  test('returns undefined for a file with no constructs', () => {
    expect(index.findBySourceLocation('unknown.ts', 10)).toBeUndefined();
  });

  test('prefers the authored parent when a line holds a whole construct subtree', () => {
    // The real VPC case: the parent and all its synthesized children are
    // anchored to the single `new Vpc(...)` line. Clicking it should land on
    // the construct the user wrote, not a deep synthetic child.
    const shared = SourceAndTemplateIndex.fromTree([
      navigable('Net/Vpc', 'net.ts', 11, [
        navigable('Net/Vpc/PublicSubnet1', 'net.ts', 11, [
          navigable('Net/Vpc/PublicSubnet1/NatGateway', 'net.ts', 11),
        ]),
      ]),
    ]);

    expect(shared.findBySourceLocation('net.ts', 11)!.path).toBe('Net/Vpc');
    expect(shared.findBySourceLocation('net.ts', 40)!.path).toBe('Net/Vpc');
  });
});
