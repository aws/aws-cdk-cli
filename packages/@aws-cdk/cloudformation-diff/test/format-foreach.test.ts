import { ForEachDiffFormatter, isForEachKey } from '../lib/format-foreach';

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
});
