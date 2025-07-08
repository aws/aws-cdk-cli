import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliIoHost } from '../../lib/cli/io-host';
import { displayFlags } from '../../lib/commands/flags';

let oldDir: string;
let tmpDir: string;
let ioHost = CliIoHost.instance();
let notifySpy: jest.SpyInstance<Promise<void>>;

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

describe('displayFlags', () => {
  test('displays a single feature flag', async () => {
    const flagsData =
            [{
              module: 'aws-cdk-lib',
              flags: {
                '@aws-cdk/core:enableStackNameDuplicates': {
                  userValue: true,
                  recommendedValue: false,
                  explanation: 'Enable stack name duplicates',
                },
              },
            }]
            ;

    await displayFlags(flagsData);

    const plainTextOutput = notifySpy.mock.calls.map(x => x[0].message).join('\n').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plainTextOutput).toContain('Feature Flags Report:');
    expect(plainTextOutput).toContain('Feature Flag Name');
    expect(plainTextOutput).toContain('Recommended Value');
    expect(plainTextOutput).toContain('User Value');
    expect(plainTextOutput).toContain('@aws-cdk/core:enableStackNameDuplicates');
    expect(plainTextOutput).toContain('true');
    expect(plainTextOutput).toContain('false');
  });

  test('displays multiple feature flags', async () => {
    const flagsData = [{
      module: 'aws-cdk-lib',
      flags: {
        '@aws-cdk/core:enableStackNameDuplicates': {
          userValue: true,
          recommendedValue: false,
          explanation: 'Enable stack name duplicates',
        },
        '@aws-cdk/aws-s3:createDefaultLoggingPolicy': {
          userValue: false,
          recommendedValue: true,
          explanation: 'Create default logging policy for S3 buckets',
        },
      },
    }];

    await displayFlags(flagsData);

    const plainTextOutput = notifySpy.mock.calls.map(x => x[0].message).join('\n').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plainTextOutput).toContain('@aws-cdk/core:enableStackNameDuplicates');
    expect(plainTextOutput).toContain('@aws-cdk/aws-s3:createDefaultLoggingPolicy');
  });

  test('handles null user values correctly', async () => {
    const flagsData = [{
      module: 'aws-cdk-lib',
      flags: {
        '@aws-cdk/aws-s3:createDefaultLoggingPolicy': {
          userValue: null,
          recommendedValue: true,
          explanation: 'Test flag explanation',
        },
      },
    }];

    await displayFlags(flagsData);

    const plainTextOutput = notifySpy.mock.calls.map(x => x[0].message).join('\n').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plainTextOutput).toContain('-');
    expect(plainTextOutput).toContain('true');
  });

  test('handles non-boolean flag values', async () => {
    const flagsData = [{
      module: 'aws-cdk-lib',
      flags: {
        '@aws-cdk/aws-lambda:recognizeLayerVersion': {
          userValue: 'v2',
          recommendedValue: 'v1',
          explanation: 'Recognize layer version format',
        },
        '@aws-cdk/core:numericFlag': {
          userValue: 42,
          recommendedValue: 0,
          explanation: 'Numeric flag value',
        },
      },
    }];

    await displayFlags(flagsData);

    const plainTextOutput = notifySpy.mock.calls.map(x => x[0].message).join('\n').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plainTextOutput).toContain('v2');
    expect(plainTextOutput).toContain('v1');
    expect(plainTextOutput).toContain('42');
    expect(plainTextOutput).toContain('0');
  });

  test('handles mixed data types in flag values', async () => {
    const flagsData = [{
      module: 'aws-cdk-lib',
      flags: {
        '@aws-cdk/core:stringFlag': {
          userValue: 'string-value',
          recommendedValue: 'recommended-string',
          explanation: 'String flag',
        },
        '@aws-cdk/core:numberFlag': {
          userValue: 123,
          recommendedValue: 456,
          explanation: 'Number flag',
        },
        '@aws-cdk/core:booleanFlag': {
          userValue: true,
          recommendedValue: false,
          explanation: 'Boolean flag',
        },
      },
    }];

    await displayFlags(flagsData);

    const plainTextOutput = notifySpy.mock.calls.map(x => x[0].message).join('\n').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plainTextOutput).toContain('string-value');
    expect(plainTextOutput).toContain('recommended-string');
    expect(plainTextOutput).toContain('123');
    expect(plainTextOutput).toContain('456');
    expect(plainTextOutput).toContain('true');
    expect(plainTextOutput).toContain('false');
  });
});
