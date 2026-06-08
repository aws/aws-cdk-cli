import { pathToFileURL } from 'url';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import type { ConstructNode } from '../../lib';
import { codeLensesForFile } from '../../lib/lsp/codelens';

const FILE = '/p/lib/stack.ts';
const URI = pathToFileURL(FILE).toString();
const OTHER_URI = pathToFileURL('/p/lib/other.ts').toString();

const node = (overrides: Partial<ConstructNode> & { path: string }): ConstructNode => ({
  id: overrides.path.split('/').pop() ?? overrides.path,
  children: [],
  ...overrides,
});

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
    expect(lenses).toHaveLength(1);
    expect(lenses[0].range).toEqual({
      start: { line: 11, character: 0 },
      end: { line: 11, character: 0 },
    });
    expect(lenses[0].command?.title).toBe('Creates: AWS::S3::Bucket [logical: MyBucketF68F3FF0]');
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
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toBe('3 resources: BucketABC, BucketPolicyDEF, KeyGHI');
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
    expect(lenses).toHaveLength(2);
    expect(lenses.map((l) => l.range.start.line).sort((a, b) => a - b)).toEqual([9, 19]);
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

    expect(codeLensesForFile(ConstructIndex.fromTree(tree), URI)).toHaveLength(1);
    expect(codeLensesForFile(ConstructIndex.fromTree(tree), OTHER_URI)).toHaveLength(1);
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
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toContain('AWS::S3::Bucket');
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
});
