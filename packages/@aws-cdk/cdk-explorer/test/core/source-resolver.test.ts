import * as path from 'path';
import { ArtifactMetadataEntryType, type MetadataEntry } from '@aws-cdk/cloud-assembly-schema';
import { _clearTraceMapCache, resolveSourceLocation } from '../../lib/core/source-resolver';

const SOURCE_MAPS_DIR = path.join(__dirname, '..', '_fixtures', 'source-maps');

beforeEach(() => {
  _clearTraceMapCache();
});

describe('resolveSourceLocation', () => {
  test('returns undefined when all frames are skip-placeholders', () => {
    // aws-cdk-lib's renderCallStackJustMyCode emits these for filtered frames
    // (e.g. node_modules and node: internals). They have no parens and no
    // :line:col, so they don't match FRAME_RE.
    const entries: MetadataEntry[] = [{
      type: ArtifactMetadataEntryType.LOGICAL_ID,
      data: 'X',
      trace: [
        '    ...node_modules-aws-cdk-lib...',
        '    ...node internals...',
        '    (no user code in 10 frames, use --stack-trace-limit to capture more)',
      ],
    }];
    expect(resolveSourceLocation(entries)).toBeUndefined();
  });

  test('skips skip-placeholder frames and picks the first parseable user frame', () => {
    const entries: MetadataEntry[] = [{
      type: ArtifactMetadataEntryType.LOGICAL_ID,
      data: 'X',
      trace: [
        '    ...node_modules-aws-cdk-lib...',
        '    at new MyStack (/project/lib/my-stack.ts:42:7)',
        '    at Object.<anonymous> (/project/bin/app.ts:8:1)',
      ],
    }];
    expect(resolveSourceLocation(entries)).toEqual({
      file: '/project/lib/my-stack.ts',
      line: 42,
      column: 7,
    });
  });

  test('LOGICAL_ID.trace beats aws:cdk:creationStack.data when both present', () => {
    // aws-cdk-lib can emit BOTH metadata entries. Mirror toolkit-lib's
    // findCreationStackTrace preference: LOGICAL_ID.trace wins.
    const entries: MetadataEntry[] = [
      { type: ArtifactMetadataEntryType.CREATION_STACK, data: ['    at fromCreation (/a/from-creation.ts:1:1)'] as unknown as string },
      {
        type: ArtifactMetadataEntryType.LOGICAL_ID,
        data: 'X',
        trace: ['    at fromLogical (/a/from-logical.ts:2:2)'],
      },
    ];
    expect(resolveSourceLocation(entries)).toEqual({
      file: '/a/from-logical.ts', line: 2, column: 2,
    });
  });

  test('falls back to aws:cdk:creationStack.data when no LOGICAL_ID.trace', () => {
    const entries: MetadataEntry[] = [
      { type: ArtifactMetadataEntryType.LOGICAL_ID, data: 'X' }, // no trace
      { type: ArtifactMetadataEntryType.CREATION_STACK, data: ['    at fromCreation (/a/from-creation.ts:1:1)'] as unknown as string },
    ];
    expect(resolveSourceLocation(entries)).toEqual({
      file: '/a/from-creation.ts', line: 1, column: 1,
    });
  });
});

describe('source-map resolution', () => {
  const SAMPLE_JS = path.join(SOURCE_MAPS_DIR, 'sample.js');

  test('resolves .js to .ts using sibling .js.map', () => {
    const entries: MetadataEntry[] = [{
      type: ArtifactMetadataEntryType.LOGICAL_ID,
      data: 'X',
      // sample.js line 5: `function greet(name) {`
      trace: [`    at greet (${SAMPLE_JS}:5:10)`],
    }];
    const result = resolveSourceLocation(entries);
    expect(result).toBeDefined();
    expect(result!.file).toContain('sample.ts');
    expect(result!.line).toBe(2); // ts line 2 = `export function greet`
  });

  test('falls back to .js location when no .js.map exists', () => {
    const entries: MetadataEntry[] = [{
      type: ArtifactMetadataEntryType.LOGICAL_ID,
      data: 'X',
      trace: ['    at someFn (/tmp/no-map-here.js:1:1)'],
    }];
    expect(resolveSourceLocation(entries)).toEqual({
      file: '/tmp/no-map-here.js', line: 1, column: 1,
    });
  });

  test('returns .ts location unchanged (no source-map needed)', () => {
    const entries: MetadataEntry[] = [{
      type: ArtifactMetadataEntryType.LOGICAL_ID,
      data: 'X',
      trace: ['    at someFn (/project/lib/foo.ts:3:2)'],
    }];
    expect(resolveSourceLocation(entries)).toEqual({
      file: '/project/lib/foo.ts', line: 3, column: 2,
    });
  });
});
