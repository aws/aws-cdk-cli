import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureFlag, Toolkit } from '@aws-cdk/toolkit-lib';
import { asIoHelper } from '../../lib/api-private';
import { CliIoHost } from '../../lib/cli/io-host';
import type { FlagsOptions } from '../../lib/cli/user-input';
import { displayFlags, handleFlags } from '../../lib/commands/flag-operations';

let oldDir: string;
let tmpDir: string;
let ioHost = CliIoHost.instance();
let notifySpy: jest.SpyInstance<Promise<void>>;
let ioHelper = asIoHelper(ioHost, 'flags');

const mockFlagsData: FeatureFlag[] = [
  {
    module: 'aws-cdk-lib',
    name: '@aws-cdk/core:testFlag',
    recommendedValue: 'true',
    userValue: 'false',
    explanation: 'Test flag for unit tests',
  },
  {
    module: 'aws-cdk-lib',
    name: '@aws-cdk/s3:anotherFlag',
    recommendedValue: 'false',
    userValue: undefined,
    explanation: 'Another test flag',
  },
  {
    module: 'different-module',
    name: '@aws-cdk/core:matchingFlag',
    recommendedValue: 'true',
    userValue: 'true',
    explanation: 'Flag that matches recommendation',
  },
];

function createMockToolkit(): jest.Mocked<Toolkit> {
  return {
    fromCdkApp: jest.fn(),
    synth: jest.fn(),
    diff: jest.fn(),
  } as any;
}

function createMockCloudAssembly() {
  return {
    stacksRecursively: [
      {
        templateFullPath: '/mock/path/template.json',
        hierarchicalId: 'TestStack',
      },
    ],
  };
}

async function createCdkJsonFile(context: Record<string, any> = {}): Promise<string> {
  const cdkJsonPath = path.join(process.cwd(), 'cdk.json');
  const cdkJsonContent = {
    app: 'node app.js',
    context,
  };
  await fs.promises.writeFile(cdkJsonPath, JSON.stringify(cdkJsonContent, null, 2));
  return cdkJsonPath;
}

async function cleanupCdkJsonFile(cdkJsonPath: string): Promise<void> {
  await fs.promises.unlink(cdkJsonPath);
}

function setupMockToolkitForPrototyping(mockToolkit: jest.Mocked<Toolkit>) {
  const mockCloudAssembly = createMockCloudAssembly();
  const mockCx = { cloudAssembly: mockCloudAssembly };

  mockToolkit.fromCdkApp.mockResolvedValue({} as any);
  mockToolkit.synth.mockResolvedValue(mockCx as any);
}

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
    await displayFlags(mockFlagsData, ioHelper, undefined, true);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('@aws-cdk/s3:anotherFlag');
  });

  test('handles null user values correctly', async () => {
    await displayFlags(mockFlagsData, ioHelper, undefined, true);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('<unset>');
  });

  test('handles mixed data types in flag values', async () => {
    await displayFlags(mockFlagsData, ioHelper, undefined, true);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('true');
    expect(plainTextOutput).toContain('false');
  });

  test('displays single flag by name', async () => {
    await displayFlags(mockFlagsData, ioHelper, '@aws-cdk/core:testFlag');

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Description: Test flag for unit tests');
    expect(plainTextOutput).toContain('Recommended value: true');
    expect(plainTextOutput).toContain('User value: false');
  });

  test('groups flags by module', async () => {
    await displayFlags(mockFlagsData, ioHelper, undefined, true);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('aws-cdk-lib');
    expect(plainTextOutput).toContain('different-module');
  });
});

describe('handleFlags', () => {
  let mockToolkit: jest.Mocked<Toolkit>;

  beforeEach(() => {
    mockToolkit = createMockToolkit();
  });

  test('displays specific flag when FLAGNAME is provided without set option', async () => {
    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      set: false,
      all: false,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Description: Test flag for unit tests');
    expect(plainTextOutput).toContain('Recommended value: true');
    expect(plainTextOutput).toContain('User value: false');
  });

  test('displays all flags when all option is true', async () => {
    const options: FlagsOptions = {
      all: true,
      set: false,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('@aws-cdk/s3:anotherFlag');
  });

  test('displays only differing flags when no specific options are provided', async () => {
    const options: FlagsOptions = {
      set: false,
      all: false,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('@aws-cdk/s3:anotherFlag');
    expect(plainTextOutput).not.toContain('@aws-cdk/core:matchingFlag');
  });

  test('handles flag not found for specific flag query', async () => {
    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:nonExistentFlag'],
      set: false,
      all: false,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Flag not found.');
  });

  test('calls prototypeChanges when set option is true with valid flag', async () => {
    const cdkJsonPath = await createCdkJsonFile();

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(false);

    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      set: true,
      value: 'true',
      all: false,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    expect(mockToolkit.fromCdkApp).toHaveBeenCalledTimes(2);
    expect(mockToolkit.synth).toHaveBeenCalledTimes(2);
    expect(mockToolkit.diff).toHaveBeenCalled();
    expect(requestResponseSpy).toHaveBeenCalled();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Operation cancelled');

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('does not resynthesize when setting flag to same value as current context', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': true,
    });

    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      set: true,
      value: 'true',
      all: false,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    expect(mockToolkit.fromCdkApp).not.toHaveBeenCalled();
    expect(mockToolkit.synth).not.toHaveBeenCalled();
    expect(mockToolkit.diff).not.toHaveBeenCalled();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Flag is already set to the specified value. No changes needed.');

    await cleanupCdkJsonFile(cdkJsonPath);
  });

  test('prototyping does not modify actual context values until confirmed', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': false,
      '@aws-cdk/core:existingFlag': true,
    });

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(false);

    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      set: true,
      value: 'true',
      all: false,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const finalContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const finalJson = JSON.parse(finalContent);

    expect(finalJson.context['@aws-cdk/core:testFlag']).toBe(false);
    expect(finalJson.context['@aws-cdk/core:existingFlag']).toBe(true);

    expect(mockToolkit.fromCdkApp).toHaveBeenCalledTimes(2);
    expect(mockToolkit.synth).toHaveBeenCalledTimes(2);
    expect(mockToolkit.diff).toHaveBeenCalled();
    expect(requestResponseSpy).toHaveBeenCalled();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Operation cancelled');

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('rejects non-boolean flags', async () => {
    const nonBooleanFlagsData: FeatureFlag[] = [
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:nonBooleanFlag',
        recommendedValue: 'some-string-value',
        userValue: undefined,
        explanation: 'A flag with non-boolean recommended value',
      },
    ];

    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:nonBooleanFlag'],
      set: true,
      value: 'true',
      all: false,
    };

    await handleFlags(nonBooleanFlagsData, ioHelper, options, mockToolkit);

    expect(mockToolkit.fromCdkApp).not.toHaveBeenCalled();
    expect(mockToolkit.synth).not.toHaveBeenCalled();
    expect(mockToolkit.diff).not.toHaveBeenCalled();
  });
});

describe('modifyValues', () => {
  test('updates cdk.json file correctly', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:existingFlag': false,
    });

    const mockToolkit = createMockToolkit();
    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      set: true,
      value: 'true',
      all: false,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(true);
    expect(updatedJson.context['@aws-cdk/core:existingFlag']).toBe(false);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Flag value updated successfully.');

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });
});
