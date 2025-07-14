import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureFlag } from '@aws-cdk/toolkit-lib';
import { asIoHelper } from '../../lib/api-private';
import { CliIoHost } from '../../lib/cli/io-host';
import { displayFlags } from '../../lib/commands/flags';

let oldDir: string;
let tmpDir: string;
let ioHost = CliIoHost.instance();
let notifySpy: jest.SpyInstance<Promise<void>>;
let ioHelper = asIoHelper(ioHost, 'flags');

beforeAll(() => {
  oldDir = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-cdk-test'));
  process.chdir(tmpDir);
});

afterAll(() => {
  process.chdir(oldDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  notifySpy = jest.spyOn(ioHost, 'notify');
  notifySpy.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function output() {
  return notifySpy.mock.calls.map(x => x[0].message).join('\n').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

describe('displayFlags', () => {
  test('displays multiple feature flags', async () => {
    const flagsData: FeatureFlag[] =
      [{
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:enableStackNameDuplicates',
        recommendedValue: 'false',
        userValue: 'true',
        explanation: 'Enable stack name duplicates',

      }, {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/aws-s3:createDefaultLoggingPolicy',
        recommendedValue: 'true',
        userValue: 'false',
        explanation: 'Create default logging policy for S3 buckets',
      }];

    await displayFlags(flagsData, ioHelper);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Feature Flag Name');
    expect(plainTextOutput).toContain('Recommended Value');
    expect(plainTextOutput).toContain('User Value');
    expect(plainTextOutput).toContain('@aws-cdk/core:enableStackNameDuplicates');
    expect(plainTextOutput).toContain('@aws-cdk/aws-s3:createDefaultLoggingPolicy');
  });

  test('handles null user values correctly', async () => {
    const flagsData: FeatureFlag[] =
      [{
        module: 'aws-cdk-lib',
        name: '@aws-cdk/aws-s3:createDefaultLoggingPolicy',
        recommendedValue: 'true',
        userValue: undefined,
        explanation: 'Create default logging policy for S3 buckets',
      }];

    await displayFlags(flagsData, ioHelper);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('true');
    expect(plainTextOutput).toContain('<unset>');
  });

  test('handles mixed data types in flag values', async () => {
    const flagsData: FeatureFlag[] =
      [{
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:stringFlag',
        recommendedValue: 'recommended-string',
        userValue: 'string-value',
        explanation: 'String flag',

      }, {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:numberFlag',
        recommendedValue: 456,
        userValue: 123,
        explanation: 'Number flag',
      }
      , {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:booleanFlag',
        recommendedValue: false,
        userValue: true,
        explanation: 'Boolean flag',
      }];

    await displayFlags(flagsData, ioHelper);

    const plainTextOutput = output(); expect(plainTextOutput).toContain('string-value');
    expect(plainTextOutput).toContain('recommended-string');
    expect(plainTextOutput).toContain('123');
    expect(plainTextOutput).toContain('456');
    expect(plainTextOutput).toContain('true');
    expect(plainTextOutput).toContain('false');
  });
});
