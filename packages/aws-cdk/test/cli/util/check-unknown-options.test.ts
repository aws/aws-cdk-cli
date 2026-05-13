import { findUnknownOptions } from '../../../lib/cli/util/check-unknown-options';

describe('findUnknownOptions', () => {
  test('returns empty array for known global options', () => {
    const argv = {
      _: ['deploy'],
      $0: 'cdk',
      profile: 'my-profile',
      region: 'us-west-2',
      verbose: 1,
    };
    expect(findUnknownOptions(argv)).toEqual([]);
  });

  test('returns empty array for known command options', () => {
    const argv = {
      _: ['deploy'],
      $0: 'cdk',
      force: true,
      all: false,
    };
    expect(findUnknownOptions(argv)).toEqual([]);
  });

  test('detects unknown options', () => {
    const argv = {
      _: ['bootstrap'],
      $0: 'cdk',
      profile: 'my-profile',
      fakeOption: 'value',
    };
    const unknown = findUnknownOptions(argv);
    expect(unknown).toContain('fakeOption');
  });

  test('does not report camelCase variants of known kebab-case options', () => {
    const argv = {
      '_': ['deploy'],
      '$0': 'cdk',
      'ca-bundle-path': '/tmp/ca.pem',
      'caBundlePath': '/tmp/ca.pem',
    };
    expect(findUnknownOptions(argv)).toEqual([]);
  });

  test('does not report yargs internal keys', () => {
    const argv = {
      _: ['deploy'],
      $0: 'cdk',
      help: false,
      h: false,
      version: false,
    };
    expect(findUnknownOptions(argv)).toEqual([]);
  });

  test('does not report aliases', () => {
    const argv = {
      _: ['deploy'],
      $0: 'cdk',
      v: 1,
      j: false,
      a: 'node bin/app.js',
    };
    expect(findUnknownOptions(argv)).toEqual([]);
  });

  test('does not report yargs boolean negation keys (noFoo for --no-foo)', () => {
    const argv = {
      _: ['deploy'],
      $0: 'cdk',
      rollback: false,
      noRollback: true,
    };
    expect(findUnknownOptions(argv)).toEqual([]);
  });

  test('does not report negativeAlias keys', () => {
    const argv = {
      _: ['deploy'],
      $0: 'cdk',
      R: true,
      rollback: false,
    };
    expect(findUnknownOptions(argv)).toEqual([]);
  });
});
