import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import type { ConstructNode } from '../../lib';
import { codeLensesForFile, OPEN_RESOURCE_COMMAND } from '../../lib/lsp/codelens';
import { COMMAND_SYNTH_NOW, COMMAND_REFRESH } from '../../lib/lsp/commands';

const FILE = '/p/lib/stack.ts';
const URI = pathToFileURL(FILE).toString();
const OTHER_URI = pathToFileURL('/p/lib/other.ts').toString();

const node = (overrides: Partial<ConstructNode> & { path: string }): ConstructNode => ({
  id: overrides.path.split('/').pop() ?? overrides.path,
  children: [],
  ...overrides,
});

/** Shape of one resource choice carried in the openResource command arguments. */
interface CommandChoice {
  label: string;
  description: string;
  target: { uri: string; range: { start: unknown; end: unknown } };
}

describe('codeLensesForFile', () => {
  test('returns no lenses when tree is empty', () => {
    expect(codeLensesForFile(ConstructIndex.fromTree([]), URI)).toEqual([]);
  });

  test('returns no lenses for non-resource wrapper nodes (no logicalId)', () => {
    // L2 wrapper: has sourceLocation but no logicalId/cfnType — they live on
    // its `Resource` child. Wrappers shouldn't get their own lens.
    const tree = [node({
      path: 'Stack1/MyBucket',
      sourceLocation: { file: FILE, line: 12, column: 5 },
      // logicalId/type intentionally omitted
    })];
    expect(codeLensesForFile(ConstructIndex.fromTree(tree), URI)).toEqual([]);
  });

  test('emits one lens per resource on its source line', () => {
    const tree = [node({
      path: 'Stack1/MyBucket/Resource',
      logicalId: 'MyBucketF68F3FF0',
      type: 'AWS::S3::Bucket',
      sourceLocation: { file: FILE, line: 12, column: 5 },
    })];

    const lenses = codeLensesForFile(ConstructIndex.fromTree(tree), URI);
    expect(lenses).toHaveLength(3); // 2 header + 1 L1
    expect(lenses[2].range).toEqual({
      start: { line: 11, character: 0 },
      end: { line: 11, character: 0 },
    });
    expect(lenses[2].command?.title).toBe('Creates AWS::S3::Bucket');
  });

  test('groups multiple resources on the same source line into one lens', () => {
    // L2 like Bucket can produce Bucket + BucketPolicy + Key, all anchored
    // to the same `new s3.Bucket(...)` line. One lens, listing all.
    const tree = [
      node({
        path: 'Stack1/MyBucket/Resource',
        logicalId: 'BucketABC',
        type: 'AWS::S3::Bucket',
        sourceLocation: { file: FILE, line: 12, column: 5 },
      }),
      node({
        path: 'Stack1/MyBucket/Policy',
        logicalId: 'BucketPolicyDEF',
        type: 'AWS::S3::BucketPolicy',
        sourceLocation: { file: FILE, line: 12, column: 5 },
      }),
      node({
        path: 'Stack1/MyBucket/Key',
        logicalId: 'KeyGHI',
        type: 'AWS::KMS::Key',
        sourceLocation: { file: FILE, line: 12, column: 5 },
      }),
    ];

    const lenses = codeLensesForFile(ConstructIndex.fromTree(tree), URI);
    expect(lenses).toHaveLength(3); // 2 header + 1 grouped L1
    expect(lenses[2].command?.title).toBe('Creates 3 resources: AWS::S3::Bucket, AWS::S3::BucketPolicy, AWS::KMS::Key');
  });

  test('emits separate lenses for resources on different lines', () => {
    const tree = [
      node({
        path: 'Stack1/A',
        logicalId: 'A1',
        type: 'AWS::S3::Bucket',
        sourceLocation: { file: FILE, line: 10, column: 1 },
      }),
      node({
        path: 'Stack1/B',
        logicalId: 'B1',
        type: 'AWS::SQS::Queue',
        sourceLocation: { file: FILE, line: 20, column: 1 },
      }),
    ];

    const lenses = codeLensesForFile(ConstructIndex.fromTree(tree), URI);
    expect(lenses).toHaveLength(4); // 2 header + 2 L1
    expect(lenses.slice(2).map((l) => l.range.start.line).sort((a, b) => a - b)).toEqual([9, 19]);
  });

  test('filters out resources from other files', () => {
    const tree = [
      node({
        path: 'Stack1/A',
        logicalId: 'A1',
        type: 'AWS::S3::Bucket',
        sourceLocation: { file: FILE, line: 10, column: 1 },
      }),
      node({
        path: 'Stack1/B',
        logicalId: 'B1',
        type: 'AWS::SQS::Queue',
        sourceLocation: { file: '/p/lib/other.ts', line: 5, column: 1 },
      }),
    ];

    const index = ConstructIndex.fromTree(tree);
    // Each query returns the 2 header lenses plus only the resource defined in
    // that file, which proves the URI filter selects by file rather than
    // returning everything for any query.
    const onThisFile = codeLensesForFile(index, URI);
    expect(onThisFile).toHaveLength(3); // 2 header + 1 L1
    expect(onThisFile[2].command?.title).toBe('Creates AWS::S3::Bucket');
    const onOtherFile = codeLensesForFile(index, OTHER_URI);
    expect(onOtherFile).toHaveLength(3); // 2 header + 1 L1
    expect(onOtherFile[2].command?.title).toBe('Creates AWS::SQS::Queue');
  });

  test('walks descendants — finds resources nested under wrappers', () => {
    const tree = [
      node({
        path: 'Stack1',
        sourceLocation: { file: FILE, line: 1, column: 1 },
        children: [
          node({
            path: 'Stack1/MyBucket',
            sourceLocation: { file: FILE, line: 12, column: 5 },
            children: [
              node({
                path: 'Stack1/MyBucket/Resource',
                logicalId: 'MyBucketABC',
                type: 'AWS::S3::Bucket',
                sourceLocation: { file: FILE, line: 12, column: 5 },
              }),
            ],
          }),
        ],
      }),
    ];

    const lenses = codeLensesForFile(ConstructIndex.fromTree(tree), URI);
    expect(lenses).toHaveLength(3); // 2 header + 1
    expect(lenses[2].command?.title).toContain('AWS::S3::Bucket');
  });

  test('omits resources without sourceLocation (non-TS apps)', () => {
    const tree = [node({
      path: 'Stack1/MyBucket/Resource',
      logicalId: 'MyBucketF68F3FF0',
      type: 'AWS::S3::Bucket',
      // sourceLocation omitted — non-TS app
    })];

    expect(codeLensesForFile(ConstructIndex.fromTree(tree), URI)).toEqual([]);
  });

  test('a single resource with a resolvable template gets a clickable openResource command', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelens-'));
    const templateFile = path.join(dir, 'Stack1.template.json');
    fs.writeFileSync(templateFile, JSON.stringify({ Resources: { MyBucketF68F3FF0: { Type: 'AWS::S3::Bucket' } } }, null, 2));
    try {
      const tree = [node({
        path: 'Stack1/MyBucket/Resource',
        logicalId: 'MyBucketF68F3FF0',
        type: 'AWS::S3::Bucket',
        templateFile,
        sourceLocation: { file: FILE, line: 12, column: 5 },
      })];

      const lens = codeLensesForFile(ConstructIndex.fromTree(tree), URI)[2];
      expect(lens.command?.command).toBe(OPEN_RESOURCE_COMMAND);
      const choices = (lens.command!.arguments as CommandChoice[][])[0];
      expect(choices).toHaveLength(1);
      expect(choices[0]).toMatchObject({
        label: 'AWS::S3::Bucket',
        description: 'Stack1/MyBucket',
        target: { uri: pathToFileURL(templateFile).toString() },
      });
      // The target carries a real (non-zero-width) block range; exact offsets are covered in template-locator.test.
      expect(choices[0].target.range.start).not.toEqual(choices[0].target.range.end);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a multi-resource line carries all resolvable resources as choices', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelens-'));
    const templateFile = path.join(dir, 'Stack1.template.json');
    fs.writeFileSync(templateFile, JSON.stringify({
      Resources: { B1: { Type: 'AWS::S3::Bucket' }, B2: { Type: 'AWS::S3::BucketPolicy' } },
    }, null, 2));
    try {
      const tree = [
        node({ path: 'Stack1/B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', templateFile, sourceLocation: { file: FILE, line: 12, column: 5 } }),
        node({ path: 'Stack1/B/Policy', logicalId: 'B2', type: 'AWS::S3::BucketPolicy', templateFile, sourceLocation: { file: FILE, line: 12, column: 5 } }),
      ];

      const lens = codeLensesForFile(ConstructIndex.fromTree(tree), URI)[2];
      const uri = pathToFileURL(templateFile).toString();
      expect(lens.command?.command).toBe(OPEN_RESOURCE_COMMAND);
      const choices = (lens.command!.arguments as CommandChoice[][])[0];
      expect(choices).toMatchObject([
        { label: 'AWS::S3::Bucket', description: 'Stack1/B', target: { uri } },
        { label: 'AWS::S3::BucketPolicy', description: 'Stack1/B/Policy', target: { uri } },
      ]);
      // Each carries a real span, and the two resources resolve to distinct blocks.
      expect(choices[0].target.range.start).not.toEqual(choices[0].target.range.end);
      expect(choices[1].target.range.start).not.toEqual(choices[1].target.range.end);
      expect(choices[0].target.range).not.toEqual(choices[1].target.range);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a multi-resource line with no resolvable templates stays title-only', () => {
    const tree = [
      node({ path: 'Stack1/B/Resource', logicalId: 'B1', type: 'AWS::S3::Bucket', templateFile: '/no/such.json', sourceLocation: { file: FILE, line: 12, column: 5 } }),
      node({ path: 'Stack1/B/Policy', logicalId: 'B2', type: 'AWS::S3::BucketPolicy', templateFile: '/no/such.json', sourceLocation: { file: FILE, line: 12, column: 5 } }),
    ];

    const lens = codeLensesForFile(ConstructIndex.fromTree(tree), URI)[2];
    expect(lens.command?.command).toBe('');
    expect(lens.command?.arguments).toBeUndefined();
  });

  test('a single resource whose id is missing from the template degrades to title-only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelens-'));
    const templateFile = path.join(dir, 'Stack1.template.json');
    fs.writeFileSync(templateFile, JSON.stringify({ Resources: { SomethingElse: { Type: 'AWS::S3::Bucket' } } }, null, 2));
    try {
      const tree = [node({
        path: 'Stack1/MyBucket/Resource',
        logicalId: 'MyBucketF68F3FF0',
        type: 'AWS::S3::Bucket',
        templateFile,
        sourceLocation: { file: FILE, line: 12, column: 5 },
      })];

      const lens = codeLensesForFile(ConstructIndex.fromTree(tree), URI)[2];
      expect(lens.command?.command).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('header lenses appear at line 0 with synthNow and refresh commands when L1 lenses are present', () => {
    const tree = [node({
      path: 'Stack1/MyBucket/Resource',
      logicalId: 'MyBucketF68F3FF0',
      type: 'AWS::S3::Bucket',
      sourceLocation: { file: FILE, line: 12, column: 5 },
    })];

    const lenses = codeLensesForFile(ConstructIndex.fromTree(tree), URI);
    expect(lenses[0].range.start.line).toBe(0);
    expect(lenses[0].command?.command).toBe(COMMAND_SYNTH_NOW);
    expect(lenses[1].range.start.line).toBe(0);
    expect(lenses[1].command?.command).toBe(COMMAND_REFRESH);
  });

  test('no header lenses on files with no L1 lenses', () => {
    // File has no CDK resources → no lenses at all, including no header lenses
    expect(codeLensesForFile(ConstructIndex.fromTree([]), URI)).toEqual([]);
  });
});
