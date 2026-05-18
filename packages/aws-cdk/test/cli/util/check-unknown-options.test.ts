import { findUnknownOptions } from '../../../lib/cli/util/check-unknown-options';

describe('findUnknownOptions', () => {
  test('returns empty array for known global options', () => {
    const argv = {
      _: ['deploy'],
      $0: 'cdk',
      profile: 'my-profile',
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
    expect(unknown).toEqual(['fakeOption']);
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

  test('does not report negativeAlias keys', () => {
    const argv = {
      _: ['deploy'],
      $0: 'cdk',
      R: true,
      rollback: false,
    };
    expect(findUnknownOptions(argv)).toEqual([]);
  });

  // yargs .env('CDK') injects CDK_* env vars as camelCase keys in argv.
  // This also covers "noFoo" patterns (e.g. CDK_NO_ROLLBACK -> noRollback).
  test('does not report keys injected by yargs .env("CDK") from environment variables', () => {
    process.env.CDK_INTEG_ATMOSPHERE_POOL = 'test-pool';
    process.env.CDK_MAJOR_VERSION = '2';
    try {
      const argv = {
        _: ['deploy'],
        $0: 'cdk',
        integAtmospherePool: 'test-pool',
        majorVersion: '2',
      };
      expect(findUnknownOptions(argv)).toEqual([]);
    } finally {
      delete process.env.CDK_INTEG_ATMOSPHERE_POOL;
      delete process.env.CDK_MAJOR_VERSION;
    }
  });

  test('still reports truly unknown options even when CDK_ env vars exist', () => {
    process.env.CDK_INTEG_ATMOSPHERE_POOL = 'test-pool';
    try {
      const argv = {
        _: ['deploy'],
        $0: 'cdk',
        integAtmospherePool: 'test-pool',
        totallyFakeOption: 'value',
      };
      const unknown = findUnknownOptions(argv);
      expect(unknown).toEqual(['totallyFakeOption']);
    } finally {
      delete process.env.CDK_INTEG_ATMOSPHERE_POOL;
    }
  });
});
