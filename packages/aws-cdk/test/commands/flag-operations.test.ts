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
    const params = {
      flagData: mockFlagsData,
      toolkit: createMockToolkit(),
      ioHelper,
      all: true,
    };
    await displayFlags(params);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('@aws-cdk/s3:anotherFlag');
  });

  test('handles null user values correctly', async () => {
    const params = {
      flagData: mockFlagsData,
      toolkit: createMockToolkit(),
      ioHelper,
      all: true,
    };
    await displayFlags(params);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('<unset>');
  });

  test('handles mixed data types in flag values', async () => {
    const params = {
      flagData: mockFlagsData,
      toolkit: createMockToolkit(),
      ioHelper,
      all: true,
    };
    await displayFlags(params);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('true');
    expect(plainTextOutput).toContain('false');
  });

  test('displays single flag by name', async () => {
    const params = {
      flagData: mockFlagsData,
      toolkit: createMockToolkit(),
      ioHelper,
      flagName: ['@aws-cdk/core:testFlag'],
    };
    await displayFlags(params);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Description: Test flag for unit tests');
    expect(plainTextOutput).toContain('Recommended value: true');
    expect(plainTextOutput).toContain('User value: false');
  });

  test('groups flags by module', async () => {
    const params = {
      flagData: mockFlagsData,
      toolkit: createMockToolkit(),
      ioHelper,
      all: true,
    };
    await displayFlags(params);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('aws-cdk-lib');
    expect(plainTextOutput).toContain('different-module');
  });
  test('displays single flag details when only one substring match is found', async () => {
    const params = {
      flagData: mockFlagsData,
      toolkit: createMockToolkit(),
      ioHelper,
      flagName: ['s3'],
    };
    await displayFlags(params);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Description: Another test flag');
    expect(plainTextOutput).toContain('Recommended value: false');
    expect(plainTextOutput).toContain('User value: undefined');
    expect(plainTextOutput).not.toContain('Found');
    expect(plainTextOutput).not.toContain('matching');
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
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('@aws-cdk/s3:anotherFlag');
  });

  test('displays only differing flags when no specific options are provided', async () => {
    const options: FlagsOptions = {
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

    setupMockToolkitForPrototyping(mockToolkit);

    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      set: true,
      value: 'true',
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    expect(mockToolkit.fromCdkApp).toHaveBeenCalledTimes(1);
    expect(mockToolkit.synth).not.toHaveBeenCalled();
    expect(mockToolkit.diff).not.toHaveBeenCalled();

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
    };

    await handleFlags(nonBooleanFlagsData, ioHelper, options, mockToolkit);

    expect(mockToolkit.fromCdkApp).not.toHaveBeenCalled();
    expect(mockToolkit.synth).not.toHaveBeenCalled();
    expect(mockToolkit.diff).not.toHaveBeenCalled();
  });

  test('sets flag to default value based on unconfiguredBehavesLike.v2 property', async () => {
    const flagsWithUnconfiguredBehavior: FeatureFlag[] = [
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:flagWithV2True',
        recommendedValue: 'false',
        userValue: undefined,
        explanation: 'Flag with unconfiguredBehavesLike.v2 = true',
        unconfiguredBehavesLike: { v2: 'true' },
      },
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:flagWithV2False',
        recommendedValue: 'false',
        userValue: undefined,
        explanation: 'Flag with unconfiguredBehavesLike.v2 = false',
        unconfiguredBehavesLike: { v2: 'false' },
      },
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:flagWithoutV2',
        recommendedValue: 'false',
        userValue: undefined,
        explanation: 'Flag without unconfiguredBehavesLike.v2',
      },
    ];

    const cdkJsonPath = await createCdkJsonFile({});

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      set: true,
      all: true,
      default: true,
    };

    await handleFlags(flagsWithUnconfiguredBehavior, ioHelper, options, mockToolkit);

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:flagWithV2True']).toBe(true);
    expect(updatedJson.context['@aws-cdk/core:flagWithV2False']).toBe(false);
    expect(updatedJson.context['@aws-cdk/core:flagWithoutV2']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });
});

describe('modifyValues', () => {
  test('updates cdk.json file correctly for single flag', async () => {
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
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(true);
    expect(updatedJson.context['@aws-cdk/core:existingFlag']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('sets only unconfigured flags to recommended values', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': false,
      '@aws-cdk/core:matchingFlag': true,
    });

    const mockToolkit = createMockToolkit();
    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      set: true,
      unconfigured: true,
      recommended: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/s3:anotherFlag']).toBe(false);
    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(false);
    expect(updatedJson.context['@aws-cdk/core:matchingFlag']).toBe(true);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });
});

test('sets all flags to recommended values', async () => {
  const cdkJsonPath = await createCdkJsonFile({
    '@aws-cdk/core:testFlag': false,
    '@aws-cdk/core:matchingFlag': true,
  });

  const mockToolkit = createMockToolkit();
  setupMockToolkitForPrototyping(mockToolkit);

  const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
  requestResponseSpy.mockResolvedValue(true);

  const options: FlagsOptions = {
    set: true,
    all: true,
    recommended: true,
  };

  await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

  const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
  const updatedJson = JSON.parse(updatedContent);

  expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(true);
  expect(updatedJson.context['@aws-cdk/core:matchingFlag']).toBe(true);
  expect(updatedJson.context['@aws-cdk/s3:anotherFlag']).toBe(false);

  await cleanupCdkJsonFile(cdkJsonPath);
  requestResponseSpy.mockRestore();
});
