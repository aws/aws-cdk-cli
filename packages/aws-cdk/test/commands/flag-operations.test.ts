import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureFlag, Toolkit } from '@aws-cdk/toolkit-lib';
// @ts-ignore
import { Select } from 'enquirer';
import type { IoHelper } from '../../lib/api-private';
import { asIoHelper } from '../../lib/api-private';
import { CliIoHost } from '../../lib/cli/io-host';
import type { FlagsOptions } from '../../lib/cli/user-input';
import { FlagCommandHandler } from '../../lib/commands/flags/flags';
import { FlagOperations } from '../../lib/commands/flags/operations';

jest.mock('enquirer', () => ({
  Select: jest.fn(),
}));

let oldDir: string;
let tmpDir: string;
let ioHost = CliIoHost.instance();
let notifySpy: jest.SpyInstance<Promise<void>>;
let ioHelper = asIoHelper(ioHost, 'flags');
let mockToolkit: jest.Mocked<Toolkit>;

const mockFlagsData: FeatureFlag[] = [
  {
    module: 'aws-cdk-lib',
    name: '@aws-cdk/core:testFlag',
    recommendedValue: true,
    userValue: false,
    explanation: 'Test flag for unit tests',
  },
  {
    module: 'aws-cdk-lib',
    name: '@aws-cdk/core:needsAttention',
    recommendedValue: true,
    userValue: undefined,
    explanation: 'Test flag for unit tests',
  },
  {
    module: 'aws-cdk-lib',
    name: '@aws-cdk/s3:anotherFlag',
    recommendedValue: false,
    userValue: undefined,
    explanation: 'Another test flag',
  },
  {
    module: 'different-module',
    name: '@aws-cdk/core:matchingFlag',
    recommendedValue: true,
    userValue: true,
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

function setupMockToolkitForPrototyping(mockTk: jest.Mocked<Toolkit>) {
  const mockCloudAssembly = createMockCloudAssembly();
  const mockCx = { cloudAssembly: mockCloudAssembly };

  mockTk.fromCdkApp.mockResolvedValue({} as any);
  mockTk.synth.mockResolvedValue(mockCx as any);
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
  mockToolkit = createMockToolkit();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function output() {
  return notifySpy.mock.calls.map(x => x[0].message).join('\n').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

describe('displayFlags', () => {
  test('displays multiple feature flags', async () => {
    const options = { all: true };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('@aws-cdk/s3:anotherFlag');
  });

  test('handles null user values correctly', async () => {
    const options = { all: true };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('<unset>');
  });

  test('handles mixed data types in flag values', async () => {
    const options = { all: true };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('true');
    expect(plainTextOutput).toContain('false');
  });

  test('displays single flag by name', async () => {
    const options = { FLAGNAME: ['@aws-cdk/core:testFlag'] };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Description: Test flag for unit tests');
    expect(plainTextOutput).toContain('Recommended value: true');
    expect(plainTextOutput).toContain('User value: false');
  });

  test('groups flags by module', async () => {
    const options = { all: true };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('aws-cdk-lib');
    expect(plainTextOutput).toContain('different-module');
  });

  test('sorts flags by module name and then by flag name within module', async () => {
    // This test targets the sorting logic in displayFlagTable:
    // if (a.module !== b.module) { return a.module.localeCompare(b.module); }
    // return a.name.localeCompare(b.name);

    const flagsForSortingTest: FeatureFlag[] = [
      {
        module: 'z-module',
        name: '@aws-cdk/z:flagB',
        recommendedValue: 'true',
        userValue: undefined,
        explanation: 'Flag B in Z module',
      },
      {
        module: 'a-module',
        name: '@aws-cdk/a:flagZ',
        recommendedValue: 'true',
        userValue: undefined,
        explanation: 'Flag Z in A module',
      },
      {
        module: 'a-module',
        name: '@aws-cdk/a:flagA',
        recommendedValue: 'true',
        userValue: undefined,
        explanation: 'Flag A in A module',
      },
      {
        module: 'z-module',
        name: '@aws-cdk/z:flagA',
        recommendedValue: 'true',
        userValue: undefined,
        explanation: 'Flag A in Z module',
      },
    ];

    const params = {
      flagData: flagsForSortingTest,
      toolkit: mockToolkit,
      ioHelper,
      all: true,
    };
    await displayFlags(params);

    const plainTextOutput = output();

    // Verify that modules are sorted alphabetically (a-module before z-module)
    const aModuleIndex = plainTextOutput.indexOf('Module: a-module');
    const zModuleIndex = plainTextOutput.indexOf('Module: z-module');
    expect(aModuleIndex).toBeLessThan(zModuleIndex);

    // Verify that within a-module, flags are sorted alphabetically (flagA before flagZ)
    const flagAIndex = plainTextOutput.indexOf('@aws-cdk/a:flagA');
    const flagZIndex = plainTextOutput.indexOf('@aws-cdk/a:flagZ');
    expect(flagAIndex).toBeLessThan(flagZIndex);

    // Verify that within z-module, flags are sorted alphabetically (flagA before flagB)
    const zFlagAIndex = plainTextOutput.indexOf('@aws-cdk/z:flagA');
    const zFlagBIndex = plainTextOutput.indexOf('@aws-cdk/z:flagB');
    expect(zFlagAIndex).toBeLessThan(zFlagBIndex);
  });

  test('does not display flag when unconfigured behavior is the same as recommended behavior', async () => {
    const params = {
      flagData: mockFlagsData,
      toolkit: mockToolkit,
      ioHelper,
      all: true,
    };
    await displayFlags(params);

    const plainTextOutput = output();
    expect(plainTextOutput).not.toContain('  @aws-cdk/core:anotherMatchingFlag');
  });

  test('displays single flag details when only one substring match is found', async () => {
    const options = { FLAGNAME: ['s3'] };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, createMockToolkit());
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Description: Another test flag');
    expect(plainTextOutput).toContain('Recommended value: false');
    expect(plainTextOutput).toContain('User value: undefined');
    expect(plainTextOutput).not.toContain('Found');
    expect(plainTextOutput).not.toContain('matching');
  });

  test('returns "Flag not found" if user enters non-matching substring', async () => {
    const options = { FLAGNAME: ['qwerty'] };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, createMockToolkit());
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Flag matching \"qwerty\" not found.');
  });

  test('returns all matching flags if user enters common substring', async () => {
    const options = { FLAGNAME: ['flag'] };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, createMockToolkit());
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('@aws-cdk/s3:anotherFlag');
    expect(plainTextOutput).toContain('@aws-cdk/core:matchingFlag');
  });

  test('returns all matching flags if user enters multiple substrings', async () => {
    const options = { FLAGNAME: ['matching', 'test'] };
    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, createMockToolkit());
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('@aws-cdk/core:matchingFlag');
    expect(plainTextOutput).not.toContain('@aws-cdk/s3:anotherFlag');
  });

  test('displays empty table message when all flags are set to recommended values', async () => {
    // Create test data where all flags are set to their recommended values
    const allRecommendedFlagsData: FeatureFlag[] = [
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:flag1',
        recommendedValue: 'true',
        userValue: 'true',
        explanation: 'Flag 1 set to recommended value',
      },
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:flag2',
        recommendedValue: 'false',
        userValue: 'false',
        explanation: 'Flag 2 set to recommended value',
      },
    ];

    const params = {
      flagData: allRecommendedFlagsData,
      toolkit: createMockToolkit(),
      ioHelper,
      // Not using --all, so it should filter to only show non-recommended flags
    };
    await displayFlags(params);

    const plainTextOutput = output();
    // Should still show the table headers for API consistency
    expect(plainTextOutput).toContain('Recommended');
    // Should show helpful message after the empty table
    expect(plainTextOutput).toContain('✅ All feature flags are already set to their recommended values.');
    expect(plainTextOutput).toContain('Use \'cdk flags --all --unstable=flags\' to see all flags and their current values.');
    // Should not show the actual flag names since they're filtered out
    expect(plainTextOutput).not.toContain('  @aws-cdk/core:flag1');
    expect(plainTextOutput).not.toContain('  @aws-cdk/core:flag2');
  });

  test('does not show empty table message when some flags are not set to recommended values', async () => {
    // Use the original mockFlagsData which has mixed flag states
    // @aws-cdk/core:testFlag has userValue 'false' but recommendedValue 'true'
    // @aws-cdk/s3:anotherFlag has userValue undefined (not set to recommended)
    const params = {
      flagData: mockFlagsData,
      toolkit: createMockToolkit(),
      ioHelper,
      // Not using --all, so it should show flags that need attention
    };
    await displayFlags(params);

    const plainTextOutput = output();
    // Should show the table with flags that need attention
    expect(plainTextOutput).not.toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).not.toContain('@aws-cdk/s3:anotherFlag');
    expect(plainTextOutput).toContain('@aws-cdk/core:needsAttention');
    // Should NOT show the helpful message since there are flags to display
    expect(plainTextOutput).not.toContain('✅ All feature flags are already set to their recommended values.');
    expect(plainTextOutput).not.toContain('Use \'cdk flags --all --unstable=flags\' to see all flags and their current values.');
  });
});

describe('processFlagsCommand', () => {
  test('displays specific flag when FLAGNAME is provided without set option', async () => {
    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Description: Test flag for unit tests');
    expect(plainTextOutput).toContain('Recommended value: true');
    expect(plainTextOutput).toContain('User value: false');
  });

  test('displays all flags when all option is true', async () => {
    const options: FlagsOptions = {
      all: true,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('  @aws-cdk/core:testFlag');
    expect(plainTextOutput).toContain('  @aws-cdk/s3:anotherFlag');
  });

  test('displays only unset flags when no specific options are provided', async () => {
    const options: FlagsOptions = {
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).not.toContain('@aws-cdk/core:testFlag');
    expect(plainTextOutput).not.toContain('@aws-cdk/s3:anotherFlag'); // Recommended: false, effective: false
    expect(plainTextOutput).toContain('@aws-cdk/core:needsAttention');
    expect(plainTextOutput).not.toContain('@aws-cdk/core:matchingFlag');
  });

  test('handles flag not found for specific flag query', async () => {
    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:nonExistentFlag'],
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Flag matching \"@aws-cdk/core:nonExistentFlag\" not found.');
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

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

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

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

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

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

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

    const flagOperations = new FlagCommandHandler(nonBooleanFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

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

    const flagOperations = new FlagCommandHandler(flagsWithUnconfiguredBehavior, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:flagWithV2True']).toBe(true);
    expect(updatedJson.context['@aws-cdk/core:flagWithV2False']).toBe(false);
    expect(updatedJson.context['@aws-cdk/core:flagWithoutV2']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('displays notice when user is on incompatible version', async () => {
    const mockNoFlagsData: FeatureFlag[] = [];

    const options: FlagsOptions = {};

    const flagOperations = new FlagCommandHandler(mockNoFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('The \'cdk flags\' command is not compatible with the AWS CDK library used by your application. Please upgrade to 2.212.0 or above.');
  });

  test('shows error when --set is used without required options', async () => {
    const options: FlagsOptions = {
      set: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: When using --set, you must specify either --all, --unconfigured, or provide a specific flag name.');
  });

  test('shows error when --set is used with --recommended but no target flags', async () => {
    const options: FlagsOptions = {
      set: true,
      recommended: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: When using --set, you must specify either --all, --unconfigured, or provide a specific flag name.');
  });

  test('shows error when using both --all and a specific flag name', async () => {
    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      all: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: Cannot use both --all and a specific flag name. Please use either --all to show all flags or specify a single flag name.');
  });

  test('shows error when using options without --set', async () => {
    const options: FlagsOptions = {
      value: 'true',
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: This option can only be used with --set.');
  });

  test('shows error when using --value without a specific flag name', async () => {
    const options: FlagsOptions = {
      value: 'true',
      set: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: --value requires a specific flag name. Please specify a flag name when providing a value.');
  });

  test('shows error when using both --recommended and --default', async () => {
    const options: FlagsOptions = {
      recommended: true,
      default: true,
      set: true,
      all: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: Cannot use both --recommended and --default. Please choose one option.');
  });

  test('shows error when using both --unconfigured and --all', async () => {
    const options: FlagsOptions = {
      set: true,
      unconfigured: true,
      all: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: Cannot use both --unconfigured and --all. Please choose one option.');
  });

  test('shows error when using both --unconfigured and a specific flag name', async () => {
    const options: FlagsOptions = {
      set: true,
      unconfigured: true,
      FLAGNAME: ['@aws-cdk/core:testFlag'],
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: Cannot use --unconfigured with a specific flag name. --unconfigured works with multiple flags.');
  });

  test('shows error when setting a flag without providing a value', async () => {
    const options: FlagsOptions = {
      set: true,
      FLAGNAME: ['@aws-cdk/core:testFlag'],
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: When setting a specific flag, you must provide a --value.');
  });

  test('shows error when using --set with --all without --recommended or --default', async () => {
    const options: FlagsOptions = {
      set: true,
      all: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: When using --set with --all, you must specify either --recommended or --default.');
  });

  test('shows error when using --set with --unconfigured without --recommended or --default', async () => {
    const options: FlagsOptions = {
      set: true,
      unconfigured: true,
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Error: When using --set with --unconfigured, you must specify either --recommended or --default.');
  });

  test('shows error when trying to set a flag that does not exist', async () => {
    const options: FlagsOptions = {
      set: true,
      FLAGNAME: ['@aws-cdk/core:nonExistentFlag'],
      value: 'true',
    };

    await handleFlags(mockFlagsData, ioHelper, options, mockToolkit);

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Flag not found.');
  });

  test('calls setMultipleFlagsIfSupported when using --set with --unconfigured and --default', async () => {
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
    ];

    const cdkJsonPath = await createCdkJsonFile({});

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      set: true,
      unconfigured: true,
      default: true,
    };

    await handleFlags(flagsWithUnconfiguredBehavior, ioHelper, options, mockToolkit);

    // Verify that the prototyping process was called (indicating setMultipleFlagsIfSupported was executed)
    expect(mockToolkit.fromCdkApp).toHaveBeenCalled();
    expect(mockToolkit.synth).toHaveBeenCalled();
    expect(mockToolkit.diff).toHaveBeenCalled();
    expect(requestResponseSpy).toHaveBeenCalled();

    // Verify that the flags were set to their default values based on unconfiguredBehavesLike.v2
    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:flagWithV2True']).toBe(true);
    expect(updatedJson.context['@aws-cdk/core:flagWithV2False']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('handles boolean flag values correctly in toBooleanValue function', async () => {
    const flagsWithBooleanRecommendedValues: FeatureFlag[] = [
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:booleanTrueFlag',
        recommendedValue: true,
        userValue: undefined,
        explanation: 'Flag with boolean true recommended value',
      },
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:booleanFalseFlag',
        recommendedValue: false,
        userValue: undefined,
        explanation: 'Flag with boolean false recommended value',
      },
    ];

    const cdkJsonPath = await createCdkJsonFile({});

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      set: true,
      all: true,
      recommended: true,
    };

    await handleFlags(flagsWithBooleanRecommendedValues, ioHelper, options, mockToolkit);

    // Verify that the flags were set correctly using boolean values
    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    // These should be set to their boolean recommended values, testing the toBooleanValue boolean branch
    expect(updatedJson.context['@aws-cdk/core:booleanTrueFlag']).toBe(true);
    expect(updatedJson.context['@aws-cdk/core:booleanFalseFlag']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });
});

describe('modifyValues', () => {
  test('updates cdk.json file correctly for single flag', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:existingFlag': false,
    });

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      set: true,
      value: 'true',
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

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

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      set: true,
      unconfigured: true,
      recommended: true,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/s3:anotherFlag']).toBe(false);
    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(false);
    expect(updatedJson.context['@aws-cdk/core:matchingFlag']).toBe(true);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('sets all flags to recommended values', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': false,
      '@aws-cdk/core:matchingFlag': true,
    });

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      set: true,
      all: true,
      recommended: true,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(true);
    expect(updatedJson.context['@aws-cdk/core:matchingFlag']).toBe(true);
    expect(updatedJson.context['@aws-cdk/s3:anotherFlag']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });
});

describe('checkDefaultBehavior', () => {
  test('calls setMultipleFlags when unconfiguredBehavesLike is present', async () => {
    const flagsWithUnconfiguredBehavior: FeatureFlag[] = [
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:testFlag',
        recommendedValue: 'true',
        userValue: undefined,
        explanation: 'Test flag',
        unconfiguredBehavesLike: { v2: 'true' },
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

    const flagOperations = new FlagCommandHandler(flagsWithUnconfiguredBehavior, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    expect(mockToolkit.fromCdkApp).toHaveBeenCalled();
    expect(mockToolkit.synth).toHaveBeenCalled();

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('shows error when unconfiguredBehavesLike is not present', async () => {
    const flagsWithoutUnconfiguredBehavior: FeatureFlag[] = [
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:testFlag',
        recommendedValue: 'true',
        userValue: undefined,
        explanation: 'Test flag',
      },
    ];

    const options: FlagsOptions = {
      set: true,
      all: true,
      default: true,
    };

    const flagOperations = new FlagCommandHandler(flagsWithoutUnconfiguredBehavior, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('The --default options are not compatible with the AWS CDK library used by your application.');
    expect(mockToolkit.fromCdkApp).not.toHaveBeenCalled();
  });
});

describe('interactive prompts lead to the correct function calls', () => {
  beforeEach(() => {
    setupMockToolkitForPrototyping(mockToolkit);
    jest.clearAllMocks();
  });

  test('setMultipleFlags() is called if \'Set all flags to recommended values\' is selected', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': false,
      '@aws-cdk/core:matchingFlag': true,
    });

    const mockRun = jest.fn().mockResolvedValue('Set all flags to recommended values');
    Select.mockImplementation(() => ({ run: mockRun }));

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      interactive: true,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    expect(mockToolkit.fromCdkApp).toHaveBeenCalledTimes(2);
    expect(mockToolkit.synth).toHaveBeenCalledTimes(2);
    expect(mockToolkit.diff).toHaveBeenCalled();
    expect(requestResponseSpy).toHaveBeenCalled();

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(true);
    expect(updatedJson.context['@aws-cdk/core:matchingFlag']).toBe(true);
    expect(updatedJson.context['@aws-cdk/s3:anotherFlag']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('setMultipleFlags() is called if \'Set unconfigured flags to recommended values\' is selected', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': false,
    });

    const mockRun = jest.fn().mockResolvedValue('Set unconfigured flags to recommended values');
    Select.mockImplementation(() => ({ run: mockRun }));

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      interactive: true,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    expect(mockToolkit.fromCdkApp).toHaveBeenCalledTimes(2);
    expect(mockToolkit.synth).toHaveBeenCalledTimes(2);
    expect(mockToolkit.diff).toHaveBeenCalled();

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(false);
    expect(updatedJson.context['@aws-cdk/s3:anotherFlag']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('setMultipleFlags() is called if \'Set unconfigured flags to their implied configuration\' is selected', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': false,
    });

    const mockRun = jest.fn().mockResolvedValue('Set unconfigured flags to their implied configuration (record current behavior)');
    Select.mockImplementation(() => ({ run: mockRun }));

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const flagsWithUnconfiguredBehavior: FeatureFlag[] = [
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:testFlag',
        recommendedValue: 'true',
        userValue: 'false',
        explanation: 'Test flag for unit tests',
        unconfiguredBehavesLike: { v2: 'true' },
      },
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/s3:anotherFlag',
        recommendedValue: 'false',
        userValue: undefined,
        explanation: 'Another test flag',
        unconfiguredBehavesLike: { v2: 'false' },
      },
    ];

    const options: FlagsOptions = {
      interactive: true,
    };

    const flagOperations = new FlagCommandHandler(flagsWithUnconfiguredBehavior, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    expect(mockToolkit.fromCdkApp).toHaveBeenCalledTimes(2);
    expect(mockToolkit.synth).toHaveBeenCalledTimes(2);
    expect(mockToolkit.diff).toHaveBeenCalled();

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('setFlag() is called if \'Modify a specific flag\' is selected', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': false,
    });

    let promptNumber = 0;
    const mockRun = jest.fn().mockImplementation(() => {
      promptNumber++;
      if (promptNumber === 1) return Promise.resolve('Modify a specific flag');
      if (promptNumber === 2) return Promise.resolve('@aws-cdk/core:testFlag');
      if (promptNumber === 3) return Promise.resolve('true');
      return Promise.resolve('Exit');
    });

    Select.mockImplementation(() => ({ run: mockRun }));

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      interactive: true,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    expect(mockToolkit.fromCdkApp).toHaveBeenCalledTimes(2);
    expect(mockToolkit.synth).toHaveBeenCalledTimes(2);
    expect(mockToolkit.diff).toHaveBeenCalled();

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(true);

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('Returns early if \'Exit\' is selected', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:testFlag': false,
    });

    const mockRun = jest.fn().mockResolvedValue('Exit');
    Select.mockImplementation(() => ({ run: mockRun }));

    const options: FlagsOptions = {
      interactive: true,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    expect(mockToolkit.fromCdkApp).not.toHaveBeenCalled();
    expect(mockToolkit.synth).not.toHaveBeenCalled();
    expect(mockToolkit.diff).not.toHaveBeenCalled();

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);

    expect(updatedJson.context['@aws-cdk/core:testFlag']).toBe(false);

    await cleanupCdkJsonFile(cdkJsonPath);
  });

  test('enquirer prompts are called with correct options for main menu', async () => {
    const cdkJsonPath = await createCdkJsonFile();

    const mockRun = jest.fn().mockResolvedValue('Exit');
    Select.mockImplementation(() => ({ run: mockRun }));

    const options: FlagsOptions = {
      interactive: true,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    expect(Select).toHaveBeenCalledWith({
      name: 'option',
      message: 'Menu',
      choices: [
        'Set all flags to recommended values',
        'Set unconfigured flags to recommended values',
        'Set unconfigured flags to their implied configuration (record current behavior)',
        'Modify a specific flag',
        'Exit',
      ],
    });

    await cleanupCdkJsonFile(cdkJsonPath);
  });
});

describe('CLI context parameters', () => {
  beforeEach(() => {
    setupMockToolkitForPrototyping(mockToolkit);
    jest.clearAllMocks();
  });

  test('CLI context values are merged with file context during prototyping', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:existingFlag': true,
    });

    setupMockToolkitForPrototyping(mockToolkit);

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(false);

    const cliContextValues = {
      foo: 'bar',
      myContextParam: 'myValue',
    };

    const options: FlagsOptions = {
      FLAGNAME: ['@aws-cdk/core:testFlag'],
      set: true,
      value: 'true',
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit, cliContextValues);
    await flagOperations.processFlagsCommand();

    // Verify that fromCdkApp was called
    expect(mockToolkit.fromCdkApp).toHaveBeenCalledTimes(2);

    // Get the first call's context store and verify it contains merged context
    // fromCdkApp(app, { contextStore: ..., outdir: ... }) was called
    const firstCallArgs = mockToolkit.fromCdkApp.mock.calls[0]; // Get first call arguments
    const contextStore = firstCallArgs[1]?.contextStore; // Extract contextStore from second argument (options object)
    expect(contextStore).toBeDefined();

    // contextStore is defined as we've verified above
    const contextData = await contextStore!.read();

    // Verify both file context and CLI context are present
    expect(contextData).toEqual({
      '@aws-cdk/core:existingFlag': true, // from cdk.json
      '@aws-cdk/core:testFlag': true,      // set by the operation
      foo: 'bar',                          // from CLI
      myContextParam: 'myValue',           // from CLI
    });

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('CLI context values are passed to synthesis during safe flag checking', async () => {
    const cdkJsonPath = await createCdkJsonFile({
      '@aws-cdk/core:fileFlag': false,
    });

    mockToolkit.diff.mockResolvedValue({
      TestStack: { differenceCount: 0 } as any,
    });

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(false);

    const cliContextValues = {
      myCliParam: 'cliValue',
      anotherParam: 'anotherValue',
    };

    const options: FlagsOptions = {
      safe: true,
      concurrency: 4,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit, cliContextValues);
    await flagOperations.processFlagsCommand();

    // Verify that fromCdkApp was called during safe flag checking
    expect(mockToolkit.fromCdkApp).toHaveBeenCalled();

    // Get the first call's context store and verify it contains merged context
    // fromCdkApp(app, { contextStore: ..., outdir: ... }) was called
    const firstCallArgs = mockToolkit.fromCdkApp.mock.calls[0]; // Get first call arguments
    const contextStore = firstCallArgs[1]?.contextStore; // Extract contextStore from second argument (options object)
    expect(contextStore).toBeDefined();

    // contextStore is defined as we've verified above
    const contextData = await contextStore!.read();

    // Verify both file context and CLI context are merged
    expect(contextData).toEqual({
      '@aws-cdk/core:fileFlag': false,  // from cdk.json
      myCliParam: 'cliValue',            // from CLI
      anotherParam: 'anotherValue',      // from CLI
    });

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });
});

describe('setSafeFlags', () => {
  beforeEach(() => {
    setupMockToolkitForPrototyping(mockToolkit);
    jest.clearAllMocks();
  });

  test('shows ts-node performance tip when ts-node is detected in cdk.json app command', async () => {
    const cdkJsonPath = await createCdkJsonFile({});
    await fs.promises.writeFile(cdkJsonPath, JSON.stringify({
      app: 'npx ts-node --prefer-ts-exts bin/app.ts',
      context: {},
    }, null, 2));

    mockToolkit.diff.mockResolvedValue({
      TestStack: { differenceCount: 0 } as any,
    });

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(false);

    const options: FlagsOptions = {
      safe: true,
      concurrency: 4,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Repeated synths with ts-node will type-check the application on every synth. Add --transpileOnly to cdk.json\'s "app" command to make this operation faster.');

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('shows ts-node performance tip when user supplies --app option with ts-node', async () => {
    const cdkJsonPath = await createCdkJsonFile({});

    mockToolkit.diff.mockResolvedValue({
      TestStack: { differenceCount: 0 } as any,
    });

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(false);

    const options: FlagsOptions & { app?: string } = {
      safe: true,
      concurrency: 4,
      app: 'npx ts-node bin/app.ts',
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Repeated synths with ts-node will type-check the application on every synth. Add --transpileOnly to cdk.json\'s "app" command to make this operation faster.');

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('returns early when no unconfigured flags exist', async () => {
    const configuredFlags: FeatureFlag[] = [
      {
        module: 'aws-cdk-lib',
        name: '@aws-cdk/core:configuredFlag',
        recommendedValue: 'true',
        userValue: 'true',
        explanation: 'Already configured flag',
      },
    ];

    const cdkJsonPath = await createCdkJsonFile({});

    const options: FlagsOptions = {
      safe: true,
      concurrency: 4,
    };

    const flagOperations = new FlagCommandHandler(configuredFlags, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('All feature flags are configured.');
    expect(mockToolkit.fromCdkApp).not.toHaveBeenCalled();

    await cleanupCdkJsonFile(cdkJsonPath);
  });

  test('identifies safe flags that can be set without template changes', async () => {
    const cdkJsonPath = await createCdkJsonFile({});

    mockToolkit.diff.mockResolvedValue({
      TestStack: { differenceCount: 0 } as any,
    });

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      safe: true,
      concurrency: 4,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('Flags that can be set without template changes:');
    expect(plainTextOutput).toContain('@aws-cdk/s3:anotherFlag -> false');

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });

  test('handles case where no flags are safe to set', async () => {
    const cdkJsonPath = await createCdkJsonFile({});

    mockToolkit.diff.mockResolvedValue({
      TestStack: { differenceCount: 1 } as any,
    });

    const options: FlagsOptions = {
      safe: true,
      concurrency: 4,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const plainTextOutput = output();
    expect(plainTextOutput).toContain('No more flags can be set without causing template changes.');

    await cleanupCdkJsonFile(cdkJsonPath);
  });

  test('applies safe flags when user confirms', async () => {
    const cdkJsonPath = await createCdkJsonFile({});

    mockToolkit.diff.mockResolvedValue({
      TestStack: { differenceCount: 0 } as any,
    });

    const requestResponseSpy = jest.spyOn(ioHelper, 'requestResponse');
    requestResponseSpy.mockResolvedValue(true);

    const options: FlagsOptions = {
      safe: true,
      concurrency: 4,
    };

    const flagOperations = new FlagCommandHandler(mockFlagsData, ioHelper, options, mockToolkit);
    await flagOperations.processFlagsCommand();

    const updatedContent = await fs.promises.readFile(cdkJsonPath, 'utf-8');
    const updatedJson = JSON.parse(updatedContent);
    expect(updatedJson.context['@aws-cdk/s3:anotherFlag']).toBe(false);
    expect(requestResponseSpy).toHaveBeenCalled();

    await cleanupCdkJsonFile(cdkJsonPath);
    requestResponseSpy.mockRestore();
  });
});

interface FlagOperationsParams {
  flagData: FeatureFlag[];
  toolkit: Toolkit;
  ioHelper: IoHelper;

  /** User ran --recommended option */
  recommended?: boolean;

  /** User ran --all option */
  all?: boolean;

  /** User provided --value field */
  value?: string;

  /** User provided FLAGNAME field */
  flagName?: string[];

  /** User ran --default option */
  default?: boolean;

  /** User ran --unconfigured option */
  unconfigured?: boolean;
}

async function displayFlags(params: FlagOperationsParams): Promise<void> {
  const f = new FlagOperations(params.flagData, params.toolkit, params.ioHelper);
  await f.displayFlags(params);
}

async function handleFlags(
  flagData: FeatureFlag[],
  _ioHelper: IoHelper,
  options: FlagsOptions,
  toolkit: Toolkit,
  cliContextValues: Record<string, any> = {},
) {
  const f = new FlagCommandHandler(flagData, _ioHelper, options, toolkit, cliContextValues);
  await f.processFlagsCommand();
}
