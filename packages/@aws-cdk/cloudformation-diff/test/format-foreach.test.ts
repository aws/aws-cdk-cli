import { ForEachDiffFormatter, isForEachKey, fullDiff, formatDifferences } from '../lib';

describe('isForEachKey', () => {
  test('returns true for ForEach keys', () => {
    expect(isForEachKey('Fn::ForEach::Env')).toBe(true);
    expect(isForEachKey('Fn::ForEach::Item')).toBe(true);
    expect(isForEachKey('Fn::ForEach::MyLoop')).toBe(true);
  });

  test('returns false for non-ForEach keys', () => {
    expect(isForEachKey('MyBucket')).toBe(false);
    expect(isForEachKey('AWS::S3::Bucket')).toBe(false);
    expect(isForEachKey('Fn::GetAtt')).toBe(false);
  });
});

describe('ForEachDiffFormatter', () => {
  const formatter = new ForEachDiffFormatter();

  const forEachValue = [
    ['dev', 'prod'],
    {
      'Bucket${Env}': {
        Type: 'AWS::S3::Bucket',
        Properties: {
          BucketName: 'test-${Env}',
        },
      },
    },
  ];

  test('formats ForEach addition', () => {
    const lines = formatter.formatForEach('Fn::ForEach::Env', undefined, forEachValue);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('[+]');
    expect(lines[0]).toContain('Fn::ForEach::Env');
    expect(lines[0]).toContain('2 resources');
    expect(lines.some(l => l.includes('Loop variable'))).toBe(true);
    expect(lines.some(l => l.includes('Env'))).toBe(true);
    expect(lines.some(l => l.includes('Collection'))).toBe(true);
    expect(lines.some(l => l.includes('AWS::S3::Bucket'))).toBe(true);
  });

  test('formats ForEach removal', () => {
    const lines = formatter.formatForEach('Fn::ForEach::Env', forEachValue, undefined);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('[-]');
    expect(lines[0]).toContain('Fn::ForEach::Env');
  });

  test('formats ForEach update', () => {
    const oldValue = [
      ['dev', 'prod'],
      {
        'Bucket${Env}': {
          Type: 'AWS::S3::Bucket',
          Properties: {
            BucketName: 'old-${Env}',
          },
        },
      },
    ];

    const newValue = [
      ['dev', 'prod', 'staging'],
      {
        'Bucket${Env}': {
          Type: 'AWS::S3::Bucket',
          Properties: {
            BucketName: 'new-${Env}',
          },
        },
      },
    ];

    const lines = formatter.formatForEach('Fn::ForEach::Env', oldValue, newValue);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('[~]');
    expect(lines[0]).toContain('3 resources');
  });

  test('handles dynamic collection', () => {
    const dynamicValue = [
      { Ref: 'EnvList' },
      {
        'Bucket${Env}': {
          Type: 'AWS::S3::Bucket',
          Properties: {},
        },
      },
    ];

    const lines = formatter.formatForEach('Fn::ForEach::Env', undefined, dynamicValue);

    expect(lines[0]).toContain('dynamic count');
  });

  test('truncates large collections', () => {
    const largeValue = [
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      {
        'Bucket${Item}': {
          Type: 'AWS::S3::Bucket',
          Properties: {},
        },
      },
    ];

    const lines = formatter.formatForEach('Fn::ForEach::Item', undefined, largeValue);

    expect(lines.some(l => l.includes('+4 more'))).toBe(true);
  });

  test('handles malformed ForEach value gracefully', () => {
    const lines = formatter.formatForEach('Fn::ForEach::Bad', undefined, ['only-one-element']);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('unrecognized ForEach structure');
  });

  test('handles empty template object gracefully', () => {
    const lines = formatter.formatForEach('Fn::ForEach::Empty', undefined, [['a'], {}]);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('empty ForEach template');
  });
});

describe('ForEach integration (fullDiff → formatDifferences)', () => {
  function collectOutput(cb: (stream: NodeJS.WritableStream) => void): string {
    const chunks: string[] = [];
    const stream = {
      write(chunk: string) { chunks.push(chunk); return true; },
      end() {},
      on() { return this; },
      once() { return this; },
      emit() { return false; },
      addListener() { return this; },
      removeListener() { return this; },
    } as any;
    cb(stream);
    return chunks.join('');
  }

  test('adding a ForEach resource produces diff output', () => {
    const diff = fullDiff(
      { Resources: {} },
      {
        Resources: {
          'Fn::ForEach::Env': [
            ['dev', 'prod'],
            { 'Bucket${Env}': { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'app-${Env}' } } },
          ],
        },
      },
    );

    expect(diff.resources.differenceCount).toBe(1);

    const output = collectOutput((stream) => formatDifferences(stream, diff));
    expect(output).toContain('Fn::ForEach::Env');
    expect(output).toContain('2 resources');
    expect(output).toContain('AWS::S3::Bucket');
  });

  test('removing a ForEach resource produces diff output', () => {
    const diff = fullDiff(
      {
        Resources: {
          'Fn::ForEach::Env': [
            ['dev', 'prod'],
            { 'Bucket${Env}': { Type: 'AWS::S3::Bucket', Properties: {} } },
          ],
        },
      },
      { Resources: {} },
    );

    expect(diff.resources.differenceCount).toBe(1);

    const output = collectOutput((stream) => formatDifferences(stream, diff));
    expect(output).toContain('Fn::ForEach::Env');
    expect(output).toContain('[-]');
  });

  test('updating a ForEach resource produces diff output', () => {
    const diff = fullDiff(
      {
        Resources: {
          'Fn::ForEach::Env': [
            ['dev', 'prod'],
            { 'Bucket${Env}': { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'old-${Env}' } } },
          ],
        },
      },
      {
        Resources: {
          'Fn::ForEach::Env': [
            ['dev', 'staging', 'prod'],
            { 'Bucket${Env}': { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'new-${Env}' } } },
          ],
        },
      },
    );

    expect(diff.resources.differenceCount).toBe(1);

    const output = collectOutput((stream) => formatDifferences(stream, diff));
    expect(output).toContain('[~]');
    expect(output).toContain('3 resources');
  });

  test('unchanged ForEach resource produces no diff', () => {
    const template = {
      Resources: {
        'Fn::ForEach::Env': [
          ['dev', 'prod'],
          { 'Bucket${Env}': { Type: 'AWS::S3::Bucket', Properties: {} } },
        ],
      },
    };

    const diff = fullDiff(template, template);
    expect(diff.resources.differenceCount).toBe(0);
  });

  test('ForEach alongside regular resources diffs correctly', () => {
    const diff = fullDiff(
      { Resources: {} },
      {
        Resources: {
          MyBucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'solo' } },
          'Fn::ForEach::Env': [
            ['dev', 'prod'],
            { 'Bucket${Env}': { Type: 'AWS::S3::Bucket', Properties: {} } },
          ],
        },
      },
    );

    expect(diff.resources.differenceCount).toBe(2);

    const output = collectOutput((stream) => formatDifferences(stream, diff));
    expect(output).toContain('MyBucket');
    expect(output).toContain('Fn::ForEach::Env');
  });
});
