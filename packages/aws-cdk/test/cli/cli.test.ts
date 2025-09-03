import * as cdkToolkitModule from '../../lib/cli/cdk-toolkit';
import { Notices } from '../../lib/api/notices';
import { exec } from '../../lib/cli/cli';
import { CliIoHost } from '../../lib/cli/io-host';
import { Configuration } from '../../lib/cli/user-configuration';
import { TestIoHost } from '../_helpers/io-host';

// Store original version module exports so we don't conflict with other tests
const originalVersion = jest.requireActual('../../lib/cli/version');

const ioHost = new TestIoHost();
const ioHelper = ioHost.asHelper();

jest.mock('@aws-cdk/cx-api');
jest.mock('../../lib/cli/platform-warnings', () => ({
  checkForPlatformWarnings: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/cli/user-configuration', () => ({
  Configuration: jest.fn().mockImplementation(() => ({
    loadConfigFiles: jest.fn().mockResolvedValue(undefined),
    settings: {
      get: jest.fn().mockReturnValue(undefined),
    },
    context: {
      get: jest.fn().mockReturnValue([]),
    },
  })),
}));

const actualUserConfig = jest.requireActual('../../lib/cli/user-configuration');
Configuration.fromArgs = jest.fn().mockImplementation(() => actualUserConfig.Configuration.fromArgs(ioHelper));
Configuration.fromArgsAndFiles = jest.fn().mockImplementation(() => actualUserConfig.Configuration.fromArgs(ioHelper));

jest.mock('../../lib/cli/parse-command-line-arguments', () => ({
  parseCommandLineArguments: jest.fn().mockImplementation((args) => {
    let result = {};
    
    // Handle commands
    if (args.includes('version')) {
      result = { ...result, _: ['version'] }
    } else if (args.includes('migrate')) {
      result = {
        ...result,
        _: ['migrate'],
        'language': 'typescript',
        'stack-name': 'sampleStack',
      }
      
      // Handle language aliases for migrate command
      if (args.includes('ts')) {
        result = { ...result, 'language': 'typescript' }
      }
    }

    // Handle notices flags
    if (args.includes('--notices')) {
      result = { ...result, notices: true }
    } else if (args.includes('--no-notices')) {
      result = { ...result, notices: false }
    }

    // Handle verbose flags
    const verboseCount = args.filter((arg: string) => arg === '-v').length;
    if (verboseCount > 0) {
      result = { ...result, verbose: verboseCount }
    }
    
    const verboseIndex = args.findIndex((arg: string) => arg === '--verbose');
    if (verboseIndex !== -1 && args[verboseIndex + 1]) {
      result = { ...result, verbose: parseInt(args[verboseIndex + 1], 10) }
    }

    return Promise.resolve(result);
  }),
}));

describe('exec verbose flag tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up version module for our tests
    jest.mock('../../lib/cli/version', () => ({
      ...originalVersion,
      DISPLAY_VERSION: 'test-version',
      displayVersionMessage: jest.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    // Restore the version module to its original state
    jest.resetModules();
    jest.setMock('../../lib/cli/version', originalVersion);
  });

  test('should not set log level when no verbose flag is present', async () => {
    await exec(['version']);
    expect(CliIoHost.instance().logLevel).toBe('info');
  });

  test('should set DEBUG level with single -v flag', async () => {
    await exec(['-v', 'version']);
    expect(CliIoHost.instance().logLevel).toBe('debug');
  });

  test('should set TRACE level with double -v flag', async () => {
    await exec(['-v', '-v', 'version']);
    expect(CliIoHost.instance().logLevel).toBe('trace');
  });

  test('should set DEBUG level with --verbose=1', async () => {
    await exec(['--verbose', '1', 'version']);
    expect(CliIoHost.instance().logLevel).toBe('debug');
  });

  test('should set TRACE level with --verbose=2', async () => {
    await exec(['--verbose', '2', 'version']);
    expect(CliIoHost.instance().logLevel).toBe('trace');
  });

  test('should set TRACE level with verbose level > 2', async () => {
    await exec(['--verbose', '3', 'version']);
    expect(CliIoHost.instance().logLevel).toBe('trace');
  });
});

describe('notices configuration tests', () => {
  let mockNoticesCreate: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock the Notices.create method
    mockNoticesCreate = jest.spyOn(Notices, 'create').mockReturnValue({
      refresh: jest.fn().mockResolvedValue(undefined),
      display: jest.fn(),
    } as any);

    // Set up version module for our tests
    jest.mock('../../lib/cli/version', () => ({
      ...originalVersion,
      DISPLAY_VERSION: 'test-version',
      displayVersionMessage: jest.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    mockNoticesCreate.mockRestore();
    // Restore the version module to its original state
    jest.resetModules();
    jest.setMock('../../lib/cli/version', originalVersion);
  });

  test('should send notices to "stderr" when passing --notices flag in CLI', async () => {
    await exec(['--notices', 'version']);

    expect(mockNoticesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ioHost: expect.objectContaining({
          noticesDestination: 'stderr',
        }),
      }),
    );
  });

  test('should send notices to "drop" when passing --no-notices in CLI', async () => {
    await exec(['--no-notices', 'version']);

    expect(mockNoticesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ioHost: expect.objectContaining({
          noticesDestination: 'drop',
        }),
      }),
    );
  });

  test('should send notices to "drop" when notices: false in settings and no CLI flag is provided', async () => {
    // Mock configuration to return notices: false
    const mockConfig = {
      loadConfigFiles: jest.fn().mockResolvedValue(undefined),
      settings: {
        get: jest.fn().mockImplementation((key: string[]) => {
          if (key[0] === 'notices') return false;
          return undefined;
        }),
      },
      context: {
        get: jest.fn().mockReturnValue([]),
      },
    };

    (Configuration as any).mockImplementation(() => mockConfig);
    Configuration.fromArgsAndFiles = jest.fn().mockImplementation(() => mockConfig);

    await exec(['version']);

    expect(mockNoticesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ioHost: expect.objectContaining({
          noticesDestination: 'drop',
        }),
      }),
    );
  });

  test.each([
    {
      envVar: 'TEAMCITY_VERSION',
      description: 'TeamCity',
      scenarios: [
        {
          name: 'should send notices to "drop" by default when no settings or CLI flags are provided',
          configNotices: undefined,
          cliArgs: ['version'],
          expectedDestination: 'drop',
        },
        {
          name: 'should send notices to "stderr" when config setting notices=true',
          configNotices: true,
          cliArgs: ['version'],
          expectedDestination: 'stderr',
        },
        {
          name: 'should send notices to "stderr" when passing --notices CLI flag',
          configNotices: undefined,
          cliArgs: ['--notices', 'version'],
          expectedDestination: 'stderr',
        },
        {
          name: 'should send notices to "drop"  when passing --no-notices CLI flag, even when config has notices=true',
          configNotices: true,
          cliArgs: ['--no-notices', 'version'],
          expectedDestination: 'drop',
        },
      ],
    },
    {
      envVar: 'TF_BUILD',
      description: 'Azure DevOps',
      scenarios: [
        {
          name: 'should send notices to "drop" when no settings or CLI flags are provided',
          configNotices: undefined,
          cliArgs: ['version'],
          expectedDestination: 'drop',
        },
        {
          name: 'should send notices to "stderr" config setting notices=true',
          configNotices: true,
          cliArgs: ['version'],
          expectedDestination: 'stderr',
        },
        {
          name: 'should send notices to "stderr" --notices CLI flag',
          configNotices: undefined,
          cliArgs: ['--notices', 'version'],
          expectedDestination: 'stderr',
        },
        {
          name: 'should send notices to "drop" when passing --no-notices CLI flag, even when config has notices=true',
          configNotices: true,
          cliArgs: ['--no-notices', 'version'],
          expectedDestination: 'drop',
        },
      ],
    },
  ])('CI environment with $description', async ({ envVar, scenarios }) => {
    for (const scenario of scenarios) {
      // Store original environment variables
      const originalCI = process.env.CI;
      const originalEnvVar = process.env[envVar];

      // Set CI environment variables
      process.env.CI = '1';
      process.env[envVar] = '1';

      try {
        // Mock configuration
        const mockConfig = {
          loadConfigFiles: jest.fn().mockResolvedValue(undefined),
          settings: {
            get: jest.fn().mockImplementation((key: string[]) => {
              if (key[0] === 'notices') return scenario.configNotices;
              return undefined;
            }),
          },
          context: {
            get: jest.fn().mockReturnValue([]),
          },
        };

        (Configuration as any).mockImplementation(() => mockConfig);
        Configuration.fromArgsAndFiles = jest.fn().mockImplementation(() => mockConfig);

        await exec(scenario.cliArgs);

        expect(mockNoticesCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            ioHost: expect.objectContaining({
              noticesDestination: scenario.expectedDestination,
            }),
          }),
        );
      } finally {
        // Restore original environment variables
        if (originalCI !== undefined) {
          process.env.CI = originalCI;
        } else {
          delete process.env.CI;
        }
        if (originalEnvVar !== undefined) {
          process.env[envVar] = originalEnvVar;
        } else {
          delete process.env[envVar];
        }
      }
    }
  });

  test('should read notices=true setting from configuration', async () => {
    // Mock configuration to return notices: true
    const mockConfig = {
      loadConfigFiles: jest.fn().mockResolvedValue(undefined),
      settings: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key[0] === 'notices') return true;
          return undefined;
        }),
      },
      context: {
        get: jest.fn().mockReturnValue([]),
      },
    };

    (Configuration as any).mockImplementation(() => mockConfig);
    Configuration.fromArgsAndFiles = jest.fn().mockImplementation(() => mockConfig);

    await exec(['version']);

    expect(mockNoticesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ioHost: expect.objectContaining({
          noticesDestination: 'stderr',
        }),
      }),
    );
  });

  test('should send notices to "drop" when passing --no-notices in CLI and config set to notices: false', async () => {
    // Mock configuration to return notices: true, but CLI flag should override
    const mockConfig = {
      loadConfigFiles: jest.fn().mockResolvedValue(undefined),
      settings: {
        get: jest.fn().mockImplementation((key: string) => {
          if (key[0] === 'notices') return true;
          return undefined;
        }),
      },
      context: {
        get: jest.fn().mockReturnValue([]),
      },
    };

    (Configuration as any).mockImplementation(() => mockConfig);
    Configuration.fromArgsAndFiles = jest.fn().mockImplementation(() => mockConfig);

    await exec(['--no-notices', 'version']);

    expect(mockNoticesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ioHost: expect.objectContaining({
          noticesDestination: 'drop',
        }),
      }),
    );
  });

  test.each([
    { value: undefined, expected: 'stderr', description: 'undefined (autodetection)' },
    { value: false, expected: 'drop', description: 'boolean false' },
    { value: true, expected: 'stderr', description: 'boolean true' },
    // support string "false" as false
    { value: 'false', expected: 'drop', description: 'string "false"' },
    { value: 'truthy', expected: 'stderr', description: 'string "truthy"' },
    { value: 0, expected: 'drop', description: 'numeric 0' },
    { value: 1, expected: 'stderr', description: 'numeric 1' },
    { value: '', expected: 'drop', description: 'empty string' },
    { value: null, expected: 'drop', description: 'null' },
  ])('should send notices to "$expected" config value: $description', async ({ value, expected }) => {
    // Mock configuration to return the test value
    const mockConfig = {
      loadConfigFiles: jest.fn().mockResolvedValue(undefined),
      settings: {
        get: jest.fn().mockImplementation((key: string[]) => {
          if (key[0] === 'notices') return value;
          return undefined;
        }),
      },
      context: {
        get: jest.fn().mockReturnValue([]),
      },
    };

    (Configuration as any).mockImplementation(() => mockConfig);
    Configuration.fromArgsAndFiles = jest.fn().mockImplementation(() => mockConfig);

    await exec(['version']);

    expect(mockNoticesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ioHost: expect.objectContaining({
          noticesDestination: expected,
        }),
      }),
    );
  });

  test('should convert language alias to full language name', async () => {
    const migrateSpy = jest.spyOn(cdkToolkitModule.CdkToolkit.prototype, 'migrate').mockResolvedValue();

    await exec(['migrate', '--language', 'ts', '--stack-name', 'sampleStack']);

    expect(migrateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'typescript',
      }),
    );
  });
});
