import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import { type Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { readAssembly, type ConstructNode } from '../../lib';
import { resourceTarget, sourceTargetAtTemplateOffset } from '../../lib/lsp/template-locator';
import { buildFlatAssembly, cleanupFixture } from '../_fixtures/builders';

// A synthesized-style template where MyBucketF68F3FF0 is defined once and also
// referenced (Ref + DependsOn) -- the references must not be matched.
const TEMPLATE = JSON.stringify(
  {
    Resources: {
      MyBucketF68F3FF0: { Type: 'AWS::S3::Bucket' },
      MyPolicy3A1B2C3D: {
        Type: 'AWS::IAM::Policy',
        Properties: { Bucket: { Ref: 'MyBucketF68F3FF0' } },
        DependsOn: ['MyBucketF68F3FF0'],
      },
    },
  },
  undefined,
  1,
);

/** Re-parse the substring that a returned range selects, so assertions need no hand-computed offsets. */
function sliceParse(text: string, range: Range): unknown {
  const doc = TextDocument.create('', 'json', 0, text);
  return JSON.parse(text.slice(doc.offsetAt(range.start), doc.offsetAt(range.end)));
}

/** Write a template to a throwaway file and return its path. */
function writeTemplate(contents: string): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locator-'));
  const file = path.join(dir, 'T.template.json');
  fs.writeFileSync(file, contents);
  return { dir, file };
}

describe('resourceTarget', () => {
  let dir: string | undefined;

  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  const find = (nodes: readonly ConstructNode[], targetPath: string): ConstructNode | undefined => {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      const hit = find(node.children, targetPath);
      if (hit) return hit;
    }
    return undefined;
  };

  test('resolves a resource node to its template uri and block range', () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [{ id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket' }] }],
    });
    const result = readAssembly(dir);
    if (result.status !== 'success') throw new Error('expected success');
    const node = find(result.data.tree, 'Stack1/MyBucket/Resource')!;
    const templateFile = path.join(dir!, 'Stack1.template.json');

    const target = resourceTarget(node)!;
    expect(target.uri).toBe(pathToFileURL(templateFile).toString());
    // The range spans the resource block (not a zero-width cursor) and re-parses to it.
    const text = fs.readFileSync(templateFile, 'utf-8');
    expect(target.range.start).not.toEqual(target.range.end);
    expect(sliceParse(text, target.range)).toEqual(JSON.parse(text).Resources.MyBucketF68F3FF0);
  });

  test('returns undefined for a node without a resolved templateFile', () => {
    expect(resourceTarget({ templateFile: undefined, logicalId: 'MyBucketF68F3FF0' })).toBeUndefined();
  });

  test('returns undefined when the logical id is not in the resolved template', () => {
    dir = buildFlatAssembly({
      stacks: [{ id: 'Stack1', resources: [{ id: 'MyBucket', logicalId: 'MyBucketF68F3FF0', cfnType: 'AWS::S3::Bucket' }] }],
    });
    expect(resourceTarget({ templateFile: path.join(dir, 'Stack1.template.json'), logicalId: 'GhostId' })).toBeUndefined();
  });

  test('returns undefined (does not throw) when the template can no longer be read', () => {
    expect(resourceTarget({ templateFile: '/no/such/template.json', logicalId: 'MyBucketF68F3FF0' })).toBeUndefined();
  });

  test('resolves the definition block, not Ref/DependsOn occurrences of the same id', () => {
    const written = writeTemplate(TEMPLATE);
    dir = written.dir;
    // MyBucketF68F3FF0 is defined once and also referenced; the block must be the definition.
    const target = resourceTarget({ templateFile: written.file, logicalId: 'MyBucketF68F3FF0' })!;
    expect(sliceParse(TEMPLATE, target.range)).toEqual({ Type: 'AWS::S3::Bucket' });
  });

  test('does not match a logical id that is a prefix of a longer key', () => {
    const contents = JSON.stringify(
      {
        Resources: {
          MyBucketF68F3FF0: { Type: 'AWS::S3::Bucket' },
          MyBucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'short' } },
        },
      },
      undefined,
      1,
    );
    const written = writeTemplate(contents);
    dir = written.dir;
    // The shorter id must resolve to its own (distinct) block, not the longer-named sibling.
    const target = resourceTarget({ templateFile: written.file, logicalId: 'MyBucket' })!;
    expect(sliceParse(contents, target.range)).toEqual({ Type: 'AWS::S3::Bucket', Properties: { BucketName: 'short' } });
  });
});

describe('sourceTargetAtTemplateOffset', () => {
  let dir: string | undefined;
  afterEach(() => {
    cleanupFixture(dir);
    dir = undefined;
  });

  const indexWith = (overrides: Partial<ConstructNode> & { path: string }) =>
    ConstructIndex.fromTree<ConstructNode>([{ id: overrides.path.split('/').pop()!, children: [], ...overrides }]);

  test('resolves a template offset back to the construct source location', () => {
    const contents = JSON.stringify(
      { Resources: { MyBucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'b' } } } },
      undefined,
      1,
    );
    const written = writeTemplate(contents);
    dir = written.dir;
    const index = indexWith({
      path: 'Stack1/MyBucket/Resource',
      logicalId: 'MyBucket',
      type: 'AWS::S3::Bucket',
      templateFile: written.file,
      sourceLocation: { file: '/p/lib/stack.ts', line: 5, column: 3 },
    });

    const offset = contents.indexOf('AWS::S3::Bucket'); // inside the MyBucket block
    const target = sourceTargetAtTemplateOffset(index, written.file, contents, offset)!;
    expect(target.uri).toBe(pathToFileURL('/p/lib/stack.ts').toString());
    // 1-based source location (5, 3) maps to a 0-based LSP position (4, 2).
    expect(target.range).toEqual({ start: { line: 4, character: 2 }, end: { line: 4, character: 2 } });
  });

  test('returns undefined for an offset outside any resource block', () => {
    const contents = JSON.stringify({ Resources: { MyBucket: { Type: 'AWS::S3::Bucket' } } }, undefined, 1);
    const index = indexWith({
      path: 'Stack1/MyBucket/Resource',
      logicalId: 'MyBucket',
      templateFile: '/x/T.template.json',
      sourceLocation: { file: '/p/lib/stack.ts', line: 5, column: 3 },
    });
    expect(sourceTargetAtTemplateOffset(index, '/x/T.template.json', contents, 0)).toBeUndefined();
  });

  test('returns undefined when the owning construct has no source location', () => {
    const contents = JSON.stringify({ Resources: { MyBucket: { Type: 'AWS::S3::Bucket' } } }, undefined, 1);
    const offset = contents.indexOf('AWS::S3::Bucket');
    const index = indexWith({ path: 'Stack1/MyBucket/Resource', logicalId: 'MyBucket', templateFile: '/x/T.template.json' });
    expect(sourceTargetAtTemplateOffset(index, '/x/T.template.json', contents, offset)).toBeUndefined();
  });

  test('matches on templateFile, not logical id alone (cross-template collision)', () => {
    const contents = JSON.stringify({ Resources: { MyBucket: { Type: 'AWS::S3::Bucket' } } }, undefined, 1);
    const written = writeTemplate(contents);
    dir = written.dir;
    // Two constructs share the logical id 'MyBucket' across different templates;
    // logical ids are only unique within a template, so the lookup must also key
    // on templateFile.
    const index = ConstructIndex.fromTree<ConstructNode>([
      { path: 'StackA/MyBucket/Resource', id: 'Resource', logicalId: 'MyBucket', templateFile: written.file, sourceLocation: { file: '/p/a.ts', line: 2, column: 1 }, children: [] },
      { path: 'StackB/MyBucket/Resource', id: 'Resource', logicalId: 'MyBucket', templateFile: '/other/Stack2.template.json', sourceLocation: { file: '/p/b.ts', line: 9, column: 1 }, children: [] },
    ]);

    const target = sourceTargetAtTemplateOffset(index, written.file, contents, contents.indexOf('AWS::S3::Bucket'))!;
    // Resolves to template A's construct (a.ts), not B's, despite the shared id.
    expect(target.uri).toBe(pathToFileURL('/p/a.ts').toString());
    expect(target.range.start).toEqual({ line: 1, character: 0 });
  });
});
