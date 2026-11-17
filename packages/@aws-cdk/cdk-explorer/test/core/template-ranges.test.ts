import { indexTemplateRanges, resolveAllResourceRanges, resolveLogicalIdAtOffset, resolveResourceRange } from '../../lib/core/template-ranges';

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

  test('returns undefined for invalid JSON (for example a trailing comma)', () => {
    // A malformed template yields no range rather than a wrong one. Synthesized
    // templates are always strict JSON, so nothing is lost by being strict here.
    const invalid = '{\n "Resources": {\n  "B": {\n   "Type": "AWS::S3::Bucket",\n  }\n }\n}';
    expect(resolveResourceRange(invalid, 'B')).toBeUndefined();
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

// `.resource()` is what hover calls for a construct's property ranges.
describe('indexTemplateRanges().resource', () => {
  const resolveResourceRanges = (text: string, logicalId: string) => indexTemplateRanges(text).resource(logicalId);

  // Wrapping a key+value slice in braces makes it a valid object, so the same
  // re-parse oracle proves each property range covers exactly `"Key": value`.
  const sliceParseEntry = (range: { start: number; end: number }) =>
    JSON.parse('{' + TEMPLATE_TEXT.slice(range.start, range.end) + '}');

  test.each(LOGICAL_IDS)('the block range for %s re-parses to that exact resource', (logicalId) => {
    const { block } = resolveResourceRanges(TEMPLATE_TEXT, logicalId)!;
    expect(sliceParse(block)).toEqual(RESOURCES[logicalId]);
  });

  test('each Policy property range re-parses to its exact `"Key": value` entry', () => {
    // Policy's values include an Fn::Sub, an InlineJson string with braces and
    // escaped quotes, and a Description with a lone brace -- hazards for anything
    // but a real parse.
    const { properties } = resolveResourceRanges(TEMPLATE_TEXT, 'Policy')!;
    const expected = (RESOURCES.Policy as { Properties: Record<string, unknown> }).Properties;
    expect(Object.keys(properties).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, range] of Object.entries(properties)) {
      expect(sliceParseEntry(range)).toEqual({ [name]: expected[name] });
    }
  });

  test('property ranges include the key, not just the value', () => {
    const { properties } = resolveResourceRanges(TEMPLATE_TEXT, 'MyBucket')!;
    const slice = TEMPLATE_TEXT.slice(properties.BucketName.start, properties.BucketName.end);
    expect(slice.startsWith('"BucketName"')).toBe(true);
    expect(sliceParseEntry(properties.BucketName)).toEqual({ BucketName: 'plain-bucket' });
  });

  test('enumerates only top-level properties, not nested keys', () => {
    // PolicyDocument is one entry; its nested Statement/Action are not separate.
    const { properties } = resolveResourceRanges(TEMPLATE_TEXT, 'Policy')!;
    expect(Object.keys(properties).sort()).toEqual(['Description', 'InlineJson', 'PolicyDocument']);
  });

  test('a resource with no Properties yields an empty property map', () => {
    const ranges = resolveResourceRanges(TEMPLATE_TEXT, 'Topic')!;
    expect(ranges.properties).toEqual({});
    expect(sliceParse(ranges.block)).toEqual(RESOURCES.Topic);
  });

  test('returns undefined for an unknown logical id', () => {
    expect(resolveResourceRanges(TEMPLATE_TEXT, 'DoesNotExist')).toBeUndefined();
  });

  test('returns undefined when the text cannot be parsed into a tree', () => {
    expect(resolveResourceRanges('not json at all', 'MyBucket')).toBeUndefined();
  });
});

describe('indexTemplateRanges', () => {
  const TEMPLATE_WITH_PARAMETER = {
    Parameters: { BootstrapVersion: { Type: 'AWS::SSM::Parameter::Value<String>' } },
    Resources: { Topic: { Type: 'AWS::SNS::Topic' } },
  };
  const WITH_PARAMETER_TEXT = JSON.stringify(TEMPLATE_WITH_PARAMETER, undefined, 1);

  test.each(['BootstrapVersion', 'Topic'])('every view agrees on %s', (logicalId) => {
    const ranges = indexTemplateRanges(WITH_PARAMETER_TEXT);
    const block = ranges.block(logicalId)!;

    expect(ranges.resource(logicalId)!.block).toEqual(block);
    expect(ranges.all()![logicalId].block).toEqual(block);
    expect(ranges.logicalIdAt(Math.floor((block.start + block.end) / 2))).toBe(logicalId);
  });

  test('all() covers every logical id across sections', () => {
    expect(Object.keys(indexTemplateRanges(WITH_PARAMETER_TEXT).all()!).sort())
      .toEqual(['BootstrapVersion', 'Topic']);
  });

  test('a logical id used by both a Resource and a Parameter resolves to the Resource', () => {
    const text = JSON.stringify({
      Resources: { Thing: { Type: 'AWS::SNS::Topic', Properties: { TopicName: 't' } } },
      Parameters: { Thing: { Type: 'String' } },
    }, undefined, 1);

    const block = indexTemplateRanges(text).block('Thing')!;

    expect(JSON.parse(text.slice(block.start, block.end)).Type).toBe('AWS::SNS::Topic');
  });

  test('every lookup comes back empty for a template that is not valid JSON', () => {
    const ranges = indexTemplateRanges('not json at all');

    expect(ranges.block('Topic')).toBeUndefined();
    expect(ranges.resource('Topic')).toBeUndefined();
    expect(ranges.all()).toBeUndefined();
    expect(ranges.logicalIdAt(0)).toBeUndefined();
  });
});

// The web explorer annotates a whole template at once, so it takes the index's
// `all()` view through this wrapper.
describe('resolveAllResourceRanges', () => {
  test('block ranges for every resource re-parse to that exact resource', () => {
    const all = resolveAllResourceRanges(TEMPLATE_TEXT)!;

    expect(Object.keys(all).sort()).toEqual([...LOGICAL_IDS].sort());
    for (const logicalId of LOGICAL_IDS) {
      expect(sliceParse(all[logicalId].block)).toEqual(RESOURCES[logicalId]);
    }
  });

  test('matches the single-id lookup, properties included', () => {
    const all = resolveAllResourceRanges(TEMPLATE_TEXT)!;

    expect(all.Policy).toEqual(indexTemplateRanges(TEMPLATE_TEXT).resource('Policy'));
  });

  test('returns undefined when the text cannot be parsed into a tree', () => {
    expect(resolveAllResourceRanges('not json at all')).toBeUndefined();
  });
});
