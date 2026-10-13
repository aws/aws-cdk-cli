import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { type Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { AssemblyResourceNode } from '../../lib/core/assembly-index-with-source-locations';
import { resourceTarget, sourceTargetAtTemplateOffset } from '../../lib/lsp/template-locator';
import { AssemblyFixture } from '../_helpers/assembly';

let fixture: AssemblyFixture | undefined;

afterEach(() => {
  fixture?.cleanup();
  fixture = undefined;
});

/** Re-parse the substring a range selects, so assertions need no hand-computed offsets. */
function sliceParse(text: string, range: Range): unknown {
  const doc = TextDocument.create('', 'json', 0, text);
  return JSON.parse(text.slice(doc.offsetAt(range.start), doc.offsetAt(range.end)));
}

function resourceNode(logicalId: string, type: string, templateFile: string): AssemblyResourceNode {
  return {
    constructPath: `S/${logicalId}/Resource`,
    id: 'Resource',
    cfnResource: { logicalId, type, assemblyRelativeTemplateFile: templateFile },
  };
}

describe('resourceTarget', () => {
  test('selects exactly the resource value block', async () => {
    fixture = AssemblyFixture.create({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Bucket/Resource', logicalId: 'MyBucketF68F3FF0', type: 'AWS::S3::Bucket' },
          { path: 'Policy/Resource', logicalId: 'MyPolicy3A1B2C3D', type: 'AWS::IAM::Policy', props: { Bucket: { Ref: 'MyBucketF68F3FF0' } } },
        ],
      }],
    });

    const target = (await resourceTarget(fixture.assemblyDir, resourceNode('MyBucketF68F3FF0', 'AWS::S3::Bucket', 'S.template.json')))!;

    expect(target.uri).toBe(pathToFileURL(fixture.templatePath('S')).toString());
    // Slicing the range back out must yield the resource object itself.
    expect(sliceParse(fixture.templateText('S'), target.range)).toEqual({ Type: 'AWS::S3::Bucket' });
  });

  test('matches the definition, not a Ref or DependsOn mentioning the same id', async () => {
    fixture = AssemblyFixture.create({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Bucket/Resource', logicalId: 'MyBucket', type: 'AWS::S3::Bucket' },
          // A resource that references the bucket by logical id.
          { path: 'Policy/Resource', logicalId: 'MyPolicy', type: 'AWS::IAM::Policy', props: { Bucket: { Ref: 'MyBucket' } } },
        ],
      }],
    });

    const target = (await resourceTarget(fixture.assemblyDir, resourceNode('MyBucket', 'AWS::S3::Bucket', 'S.template.json')))!;

    expect(sliceParse(fixture.templateText('S'), target.range)).toEqual({ Type: 'AWS::S3::Bucket' });
  });

  test('resolves distinct ranges for two resources in one template', async () => {
    fixture = AssemblyFixture.create({
      stacks: [{
        id: 'S',
        resources: [
          { path: 'A/Resource', logicalId: 'A1', type: 'AWS::S3::Bucket' },
          { path: 'B/Resource', logicalId: 'B1', type: 'AWS::SQS::Queue' },
        ],
      }],
    });

    const a = (await resourceTarget(fixture.assemblyDir, resourceNode('A1', 'AWS::S3::Bucket', 'S.template.json')))!;
    const b = (await resourceTarget(fixture.assemblyDir, resourceNode('B1', 'AWS::SQS::Queue', 'S.template.json')))!;

    expect(a.range).not.toEqual(b.range);
    expect(sliceParse(fixture.templateText('S'), a.range)).toEqual({ Type: 'AWS::S3::Bucket' });
    expect(sliceParse(fixture.templateText('S'), b.range)).toEqual({ Type: 'AWS::SQS::Queue' });
  });

  test('returns undefined when the template file is missing', async () => {
    fixture = AssemblyFixture.create({ stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }] });

    expect(await resourceTarget(fixture.assemblyDir, resourceNode('B1', 'AWS::S3::Bucket', 'Absent.template.json'))).toBeUndefined();
  });

  test('returns undefined when the template does not parse', async () => {
    fixture = AssemblyFixture.create({ stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }] });
    fs.writeFileSync(fixture.templatePath('S'), '{ not json');

    expect(await resourceTarget(fixture.assemblyDir, resourceNode('B1', 'AWS::S3::Bucket', 'S.template.json'))).toBeUndefined();
  });

  test('returns undefined when the logical id is absent from the template', async () => {
    fixture = AssemblyFixture.create({ stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }] });

    expect(await resourceTarget(fixture.assemblyDir, resourceNode('NotInTemplate', 'AWS::S3::Bucket', 'S.template.json'))).toBeUndefined();
  });
});

describe('sourceTargetAtTemplateOffset', () => {
  /** An app whose bucket is created at lib/stack.ts:12:5. */
  async function appWithBucket() {
    fixture = AssemblyFixture.create({
      sourceFiles: { 'lib/stack.ts': '\n'.repeat(20) },
      stacks: [{
        id: 'S',
        resources: [
          { path: 'Bucket/Resource', logicalId: 'MyBucket', type: 'AWS::S3::Bucket', at: 'lib/stack.ts:12:5' },
          { path: 'Queue/Resource', logicalId: 'MyQueue', type: 'AWS::SQS::Queue', at: 'lib/stack.ts:18:3' },
        ],
      }],
    });
    return fixture.index();
  }

  test('resolves an offset inside a resource block to its construct source', async () => {
    const index = await appWithBucket();
    const text = fixture!.templateText('S');

    const target = sourceTargetAtTemplateOffset(index, fixture!.templatePath('S'), text, text.indexOf('AWS::S3::Bucket'))!;

    // 1-based source location to 0-based LSP, as a zero-width range.
    expect(target.uri).toBe(pathToFileURL(fixture!.sourcePath('lib/stack.ts')).toString());
    expect(target.range).toEqual({ start: { line: 11, character: 4 }, end: { line: 11, character: 4 } });
  });

  test('accepts the absolute template path the LSP has on hand', async () => {
    // The language server only knows the document's absolute path; the locator
    // must translate it to the assembly-relative key the index uses.
    const index = await appWithBucket();
    const text = fixture!.templateText('S');

    expect(sourceTargetAtTemplateOffset(index, fixture!.templatePath('S'), text, text.indexOf('AWS::SQS::Queue'))!.range.start)
      .toEqual({ line: 17, character: 2 });
  });

  test('distinguishes the resource the offset falls in', async () => {
    const index = await appWithBucket();
    const text = fixture!.templateText('S');

    const atBucket = sourceTargetAtTemplateOffset(index, fixture!.templatePath('S'), text, text.indexOf('AWS::S3::Bucket'))!;
    const atQueue = sourceTargetAtTemplateOffset(index, fixture!.templatePath('S'), text, text.indexOf('AWS::SQS::Queue'))!;

    expect(atBucket.range.start.line).toBe(11);
    expect(atQueue.range.start.line).toBe(17);
  });

  test('returns undefined for an offset outside any resource block', async () => {
    const index = await appWithBucket();
    const text = fixture!.templateText('S');

    // The "Resources" key itself, not inside a resource value.
    expect(sourceTargetAtTemplateOffset(index, fixture!.templatePath('S'), text, text.indexOf('"Resources"'))).toBeUndefined();
  });

  test('returns undefined when the text does not parse', async () => {
    const index = await appWithBucket();

    expect(sourceTargetAtTemplateOffset(index, fixture!.templatePath('S'), '{ not json', 3)).toBeUndefined();
  });

  test('returns undefined when no construct owns the resource', async () => {
    const index = await appWithBucket();
    // A template that parses but whose logical id is not in the index.
    const text = JSON.stringify({ Resources: { Unknown: { Type: 'AWS::S3::Bucket' } } }, undefined, 1);

    expect(sourceTargetAtTemplateOffset(index, fixture!.templatePath('S'), text, text.indexOf('AWS::S3::Bucket'))).toBeUndefined();
  });

  test('returns undefined when the owning construct has no source location', async () => {
    fixture = AssemblyFixture.create({
      stacks: [{ id: 'S', resources: [{ path: 'B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket' }] }],
    });
    const index = await fixture.index();
    const text = fixture.templateText('S');

    expect(sourceTargetAtTemplateOffset(index, fixture.templatePath('S'), text, text.indexOf('AWS::S3::Bucket'))).toBeUndefined();
  });
});
