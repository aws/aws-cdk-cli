import { resolveLogicalIdAtOffset, resolveResourceRange } from '../lib';

// A template object is the single source of truth: the text under test is its
// 1-space serialization (exactly how synth writes `*.template.json`), and the
// expected values are read straight off the object, so input and expectations
// can never drift. The shapes pack the cases that defeat naive approaches:
//
// - Policy carries an `Fn::Sub` (`${...}` braces), an `InlineJson` value with
//   escaped quotes and a `}`, and a `Description` with a lone unmatched `{` —
//   all of which break brace-counting but not a real parse.
// - MyBucket / MyBucketF68F3FF0 are a prefix-collision pair.
// - MyBucket also appears as a value (Fn::Sub, DependsOn), never as another key.
const TEMPLATE = {
  Resources: {
    MyBucket: {
      Type: 'AWS::S3::Bucket',
      Properties: { BucketName: 'plain-bucket' },
    },
    MyBucketF68F3FF0: {
      Type: 'AWS::S3::Bucket',
      Properties: { VersioningConfiguration: { Status: 'Enabled' } },
    },
    Policy: {
      Type: 'AWS::IAM::Policy',
      Properties: {
        PolicyDocument: {
          Statement: [{ Action: 's3:*', Resource: { 'Fn::Sub': 'arn:${AWS::Partition}:s3:::${MyBucket}/*' } }],
        },
        InlineJson: '{"key":"va}lue"}',
        Description: 'trailing brace } then a lone open { inside a string',
      },
      DependsOn: ['MyBucket'],
    },
    Topic: { Type: 'AWS::SNS::Topic' },
  },
} as const;

// 1-space indent mirrors `JSON.stringify(template, undefined, 1)` in synth.
const TEMPLATE_TEXT = JSON.stringify(TEMPLATE, undefined, 1);
const RESOURCES: Record<string, unknown> = TEMPLATE.Resources;
const LOGICAL_IDS = Object.keys(RESOURCES);

/** Slice the serialized text by a computed range and re-parse it. */
const sliceParse = (range: { start: number; end: number }) =>
  JSON.parse(TEMPLATE_TEXT.slice(range.start, range.end));

describe('resolveResourceRange', () => {
  // The authoritative check: a range is correct iff the substring it selects
  // re-parses to the same value the template's own JSON.parse produced. No
  // hand-computed offsets, and it runs over every resource.
  test.each(LOGICAL_IDS)('the resolved range for %s re-parses to that exact resource', (logicalId) => {
    const block = resolveResourceRange(TEMPLATE_TEXT, logicalId)!;
    expect(sliceParse(block)).toEqual(RESOURCES[logicalId]);
  });

  test('resolves a block whose property values contain brace/quote hazards', () => {
    // Policy holds an Fn::Sub (${...}), an InlineJson value with escaped quotes
    // and a }, and a Description with a lone {, all of which defeat brace counting.
    const block = resolveResourceRange(TEMPLATE_TEXT, 'Policy')!;
    expect(sliceParse(block)).toEqual(RESOURCES.Policy);
  });

  test('a logical id resolves to its own block despite a prefix-named sibling', () => {
    const short = resolveResourceRange(TEMPLATE_TEXT, 'MyBucket')!;
    const long = resolveResourceRange(TEMPLATE_TEXT, 'MyBucketF68F3FF0')!;
    expect(sliceParse(short)).toEqual(RESOURCES.MyBucket);
    expect(sliceParse(long)).toEqual(RESOURCES.MyBucketF68F3FF0);
    expect(short).not.toEqual(long);
  });

  test('resolves the definition block even when the id also appears as a value', () => {
    // MyBucket appears under Policy's Fn::Sub and DependsOn, never as another key.
    const block = resolveResourceRange(TEMPLATE_TEXT, 'MyBucket')!;
    expect((sliceParse(block) as { Type: string }).Type).toBe('AWS::S3::Bucket');
  });

  test('returns a range for lenient (trailing-comma) JSON rather than failing', () => {
    // jsonc-parser is tolerant, so resolution does not require strict JSON; it
    // still locates the block. (The slice is not guaranteed to be strict JSON —
    // relevant once L3 reads half-written templates on save.)
    const lenient = '{\n "Resources": {\n  "B": {\n   "Type": "AWS::S3::Bucket",\n  }\n }\n}';
    const range = resolveResourceRange(lenient, 'B')!;
    // Prove it located B specifically (not just "a range"). The lenient slice
    // can't be strict-JSON-parsed, so match the text instead.
    expect(lenient.slice(range.start, range.end)).toContain('AWS::S3::Bucket');
  });

  test('returns undefined for an unknown logical id', () => {
    expect(resolveResourceRange(TEMPLATE_TEXT, 'DoesNotExist')).toBeUndefined();
  });

  test('returns undefined when the text cannot be parsed into a tree', () => {
    expect(resolveResourceRange('not json at all', 'MyBucket')).toBeUndefined();
  });
});

describe('resolveLogicalIdAtOffset', () => {
  // Inverse round-trip: an offset inside each resource's block resolves back to it.
  test.each(LOGICAL_IDS)('an offset inside %s resolves to that logical id', (logicalId) => {
    const block = resolveResourceRange(TEMPLATE_TEXT, logicalId)!;
    const mid = Math.floor((block.start + block.end) / 2);
    expect(resolveLogicalIdAtOffset(TEMPLATE_TEXT, mid)).toBe(logicalId);
  });

  test('an offset in a nested property value resolves to its owning resource', () => {
    expect(resolveLogicalIdAtOffset(TEMPLATE_TEXT, TEMPLATE_TEXT.indexOf('lone open'))).toBe('Policy');
  });

  test('returns undefined for an offset outside any resource block', () => {
    // Offset 0 is the opening brace of the whole document, before Resources.
    expect(resolveLogicalIdAtOffset(TEMPLATE_TEXT, 0)).toBeUndefined();
  });

  test('returns undefined when the text cannot be parsed into a tree', () => {
    expect(resolveLogicalIdAtOffset('not json at all', 3)).toBeUndefined();
  });
});
