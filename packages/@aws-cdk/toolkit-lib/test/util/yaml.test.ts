import { deserializeStructure, toYAML } from '../../lib/util/serialize';

// Preferred quote of the YAML library
const q = '"';

test('quote the word "ON"', () => {
  // NON NEGOTIABLE! If not quoted, will be interpreted as the boolean TRUE

  // eslint-disable-next-line no-console
  const output = toYAML({
    notABoolean: 'ON',
  });

  expect(output.trim()).toEqual(`notABoolean: ${q}ON${q}`);
});

test('quote number-like strings with a leading 0', () => {
  const output = toYAML({
    leadingZero: '012345',
  });

  expect(output.trim()).toEqual(`leadingZero: ${q}012345${q}`);
});

test('do not quote octal numbers that arent really octal', () => {
  // This is a contentious one, and something that might have changed in YAML1.2 vs YAML1.1
  //
  // One could make the argument that a sequence of characters that couldn't ever
  // be an octal value doesn't need to be quoted, and pyyaml parses it correctly.
  //
  // However, CloudFormation's parser interprets it as a decimal number (eating the
  // leading 0) if it's unquoted, so that's the behavior we're testing for.

  const output = toYAML({
    leadingZero: '0123456789',
  });

  expect(output.trim()).toEqual(`leadingZero: ${q}0123456789${q}`);
});

test('validate that our YAML correctly emits quoted colons in a list', () => {
  // Must be quoted otherwise it's not valid YAML.
  //
  // 'yaml' fails this.

  const output = toYAML({
    colons: ['arn', ':', 'aws'],
  });

  expect(output.trim()).toEqual([
    'colons:',
    '  - arn',
    `  - ${q}:${q}`,
    '  - aws',
  ].join('\n'));
});

test('validate emission of very long lines', () => {
  const template = {
    Field: ' very long line that starts with a space. very long line that starts with a space. start on a new line',
  };

  const output = toYAML(template);

  const parsed = deserializeStructure(output);

  expect(template).toEqual(parsed);
});

describe('JSON templates', () => {
  // CloudFormation accepts duplicate keys in JSON templates and uses the last value
  // Verified by deploying such a template, so we must do the same.
  test('duplicate keys: the last value is accepted', () => {
    const parsed = deserializeStructure('{"A":{"P":"Delete","P":"Retain"}}');
    expect(parsed).toEqual({ A: { P: 'Retain' } });
  });

  test('duplicate keys in a multi-line template with a UTF-8 BOM and leading whitespace', () => {
    const parsed = deserializeStructure(`\uFEFF  \n{
  "Resources": {
    "Queue": {
      "Type": "AWS::SQS::Queue",
      "UpdateReplacePolicy": "Delete",
      "UpdateReplacePolicy": "Retain"
    }
  }
}\n`);

    expect(parsed.Resources.Queue.UpdateReplacePolicy).toEqual('Retain');
  });

  test('regular JSON is unchanged', () => {
    const template = { Resources: { Bucket: { Type: 'AWS::S3::Bucket', Properties: { Size: 12, On: true, Nothing: null } } } };

    expect(deserializeStructure(JSON.stringify(template, undefined, 2))).toEqual(template);
  });
});

describe('YAML templates', () => {
  test('block YAML is unchanged', () => {
    expect(deserializeStructure('Resources:\n  Bucket:\n    Type: AWS::S3::Bucket\n')).toEqual({
      Resources: { Bucket: { Type: 'AWS::S3::Bucket' } },
    });
  });

  test('short-form intrinsics are unchanged', () => {
    const parsed = deserializeStructure([
      'Resources:',
      '  Bucket:',
      '    Type: AWS::S3::Bucket',
      '    Properties:',
      '      BucketName: !Sub "${AWS::StackName}-bucket"',
      '      Tags:',
      '        - Key: ref',
      '          Value: !Ref Other',
      '        - Key: att',
      '          Value: !GetAtt Other.Arn',
    ].join('\n'));

    expect(parsed.Resources.Bucket.Properties).toEqual({
      BucketName: { 'Fn::Sub': '${AWS::StackName}-bucket' },
      Tags: [
        { Key: 'ref', Value: { Ref: 'Other' } },
        { Key: 'att', Value: { 'Fn::GetAtt': 'Other.Arn' } },
      ],
    });
  });

  test('short-form intrinsics on sequences and maps, including nesting', () => {
    expect(deserializeStructure([
      'A: !Join ["", [!Ref X, "-", !GetAtt Y.Arn]]',
      'B: !If',
      '  - Cond',
      '  - !Sub "${Z}"',
      '  - !Ref AWS::NoValue',
      'C: !Transform { Name: Foo, Parameters: { P: !Ref Q } }',
      'D: !Ref "123"',
    ].join('\n'))).toEqual({
      A: { 'Fn::Join': ['', [{ Ref: 'X' }, '-', { 'Fn::GetAtt': 'Y.Arn' }]] },
      B: { 'Fn::If': ['Cond', { 'Fn::Sub': '${Z}' }, { Ref: 'AWS::NoValue' }] },
      C: { 'Fn::Transform': { Name: 'Foo', Parameters: { P: { Ref: 'Q' } } } },
      D: { Ref: '123' },
    });
  });

  // A collection-form intrinsic whose elements are themselves tagged collections
  // relies on yaml v2 converting the wrapped child nodes, so pin this directly.
  test('collection-form intrinsics directly wrapping other short-form tags', () => {
    expect(deserializeStructure([
      'A: !Select [0, !GetAZs ""]',
      'B: !Not [!Equals [!Ref Env, prod]]',
      'C: !Or [!Condition IsProd, !And [!Condition IsUs, !Not [!Condition IsTest]]]',
      'D: !Transform { Name: Foo, Parameters: { L: !Split [",", !ImportValue Bar] } }',
    ].join('\n'))).toEqual({
      A: { 'Fn::Select': [0, { 'Fn::GetAZs': '' }] },
      B: { 'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'Env' }, 'prod'] }] },
      C: {
        'Fn::Or': [
          { Condition: 'IsProd' },
          { 'Fn::And': [{ Condition: 'IsUs' }, { 'Fn::Not': [{ Condition: 'IsTest' }] }] },
        ],
      },
      D: { 'Fn::Transform': { Name: 'Foo', Parameters: { L: { 'Fn::Split': [',', { 'Fn::ImportValue': 'Bar' }] } } } },
    });
  });

  // CloudFormation accepts duplicate keys in YAML templates too and uses the last value.
  // Verified by deploying such a template, so we must do the same.
  test('duplicate keys: the last value is accepted', () => {
    const parsed = deserializeStructure('A:\n  P: Delete\n  P: Retain\n');
    expect(parsed).toEqual({ A: { P: 'Retain' } });
  });
});
