import * as path from 'path';
import { checkRequiredVersions, generateShrinkwrap } from '../lib';

test('generate lock for fixture directory', async () => {
  const lockFile = await generateShrinkwrap({
    packageJsonFile: path.join(__dirname, 'test-fixture', 'jsii', 'package.json'),
    hoist: false,
  });

  expect(lockFile).toEqual({
    lockfileVersion: 1,
    name: 'jsii',
    requires: true,
    version: '1.1.1',
    dependencies: {
      'cdk': {
        version: '2.2.2',
      },
      'aws-cdk': {
        integrity: 'sha512-banana',
        requires: {
          'aws-cdk-lib': '^2.3.4',
        },
        resolved: 'https://registry.bla.com/stuff',
        version: '1.2.999',
      },
      'aws-cdk-lib': {
        integrity: 'sha512-pineapple',
        resolved: 'https://registry.bla.com/stuff',
        version: '2.3.999',
      },
    },
  });
});

test('generate hoisted lock for fixture directory', async () => {
  const lockFile = await generateShrinkwrap({
    packageJsonFile: path.join(__dirname, 'test-fixture', 'jsii', 'package.json'),
    hoist: true,
  });

  expect(lockFile).toEqual({
    lockfileVersion: 1,
    name: 'jsii',
    requires: true,
    version: '1.1.1',
    dependencies: {
      'cdk': {
        version: '2.2.2',
      },
      'aws-cdk': {
        integrity: 'sha512-banana',
        requires: {
          'aws-cdk-lib': '^2.3.4',
        },
        resolved: 'https://registry.bla.com/stuff',
        version: '1.2.999',
      },
      'aws-cdk-lib': {
        integrity: 'sha512-pineapple',
        resolved: 'https://registry.bla.com/stuff',
        version: '2.3.999',
      },
    },
  });
});

test('fail when requires cannot be satisfied', async () => {
  const lockFile = {
    lockfileVersion: 1,
    name: 'jsii',
    requires: true,
    version: '1.1.1',
    dependencies: {
      jsii: {
        version: '2.2.2',
        requires: {
          cdk: '^3.3.3', // <- this needs to be adjusted
        },
      },
      cdk: {
        version: '4.4.4',
      },
    },
  } as const;

  expect(() => checkRequiredVersions(lockFile)).toThrow(/NPM will not respect/);
});

test('resolutions override required versions in checkRequiredVersions', () => {
  const lockFile = {
    lockfileVersion: 1,
    name: 'test',
    requires: true,
    version: '1.0.0',
    dependencies: {
      'parent': {
        version: '1.0.0',
        requires: {
          'string-width': '^5.1.2', // Requires v5
        },
      },
      'string-width': {
        version: '4.2.3', // But resolutions force v4
      },
    },
  } as const;

  const resolutions = {
    'string-width': '^4.2.3',
  };

  // Should not throw because resolutions override the required version
  expect(() => checkRequiredVersions(lockFile, resolutions)).not.toThrow();
});

test('validation fails without resolutions when version mismatch', () => {
  const lockFile = {
    lockfileVersion: 1,
    name: 'test',
    requires: true,
    version: '1.0.0',
    dependencies: {
      'parent': {
        version: '1.0.0',
        requires: {
          'string-width': '^5.1.2',
        },
      },
      'string-width': {
        version: '4.2.3',
      },
    },
  } as const;

  // Should throw because version doesn't satisfy requirement
  expect(() => checkRequiredVersions(lockFile)).toThrow(/NPM will not respect/);
});

test('resolutions only apply to specified packages', () => {
  const lockFile = {
    lockfileVersion: 1,
    name: 'test',
    requires: true,
    version: '1.0.0',
    dependencies: {
      'parent': {
        version: '1.0.0',
        requires: {
          'string-width': '^5.1.2',
          'strip-ansi': '^7.0.0',
        },
      },
      'string-width': {
        version: '4.2.3',
      },
      'strip-ansi': {
        version: '6.0.1',
      },
    },
  } as const;

  const resolutions = {
    'string-width': '^4.2.3',
    // strip-ansi is NOT in resolutions
  };

  // Should throw for strip-ansi but not for string-width
  expect(() => checkRequiredVersions(lockFile, resolutions)).toThrow(/strip-ansi/);
});
