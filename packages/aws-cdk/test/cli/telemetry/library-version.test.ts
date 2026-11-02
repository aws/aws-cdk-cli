import { createRequire } from 'module';
import * as fs from 'fs-extra';
import type { IoHelper } from '../../../lib/api-private';
import { getLibraryVersion } from '../../../lib/cli/telemetry/library-version';
import { run } from '../../../lib/private/tools';

// Mock module resolution so we don't depend on this repo's own `aws-cdk-lib` install
jest.mock('module', () => ({
  createRequire: jest.fn(),
}));

// Mocked only so we can assert that we never reach for a subprocess
jest.mock('@aws-cdk/private-tools/lib/subprocess', () => ({
  run: jest.fn(),
}));

// Mock fs-extra
jest.mock('fs-extra', () => ({
  existsSync: jest.fn(),
  readJSONSync: jest.fn(),
}));

const mockRun = run as jest.MockedFunction<typeof run>;
const mockCreateRequire = createRequire as jest.MockedFunction<typeof createRequire>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockReadJSONSync = fs.readJSONSync as jest.MockedFunction<typeof fs.readJSONSync>;

/**
 * Make `createRequire()` return a `require` whose `resolve()` behaves as given
 */
function mockResolve(impl: () => string) {
  mockCreateRequire.mockReturnValue({ resolve: jest.fn(impl) } as any);
}

describe('getLibraryVersion', () => {
  let mockIoHelper: IoHelper;
  let traceSpy: jest.Mock;

  beforeEach(() => {
    traceSpy = jest.fn();
    mockIoHelper = {
      defaults: {
        trace: traceSpy,
      },
    } as any;

    jest.clearAllMocks();
  });

  test('returns version when aws-cdk-lib is found and package.json is valid', async () => {
    const mockLibPath = '/path/to/node_modules/aws-cdk-lib/index.js';
    const mockPackageJsonPath = '/path/to/node_modules/aws-cdk-lib/package.json';
    const expectedVersion = '2.100.0';

    mockResolve(() => mockLibPath);
    mockExistsSync.mockReturnValue(true);
    mockReadJSONSync.mockReturnValue({ version: expectedVersion });

    const result = await getLibraryVersion(mockIoHelper);

    expect(result).toBe(expectedVersion);
    expect(mockExistsSync).toHaveBeenCalledWith(mockLibPath);
    expect(mockReadJSONSync).toHaveBeenCalledWith(mockPackageJsonPath);
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test('resolves from the app directory, not from the CLI installation', async () => {
    mockResolve(() => '/path/to/node_modules/aws-cdk-lib/index.js');
    mockExistsSync.mockReturnValue(true);
    mockReadJSONSync.mockReturnValue({ version: '2.100.0' });

    await getLibraryVersion(mockIoHelper);

    // Anchored inside the current working directory so that resolution walks up
    // the app's `node_modules`, the same way the app itself would resolve it.
    expect(mockCreateRequire).toHaveBeenCalledWith(expect.stringContaining(process.cwd()));
  });

  test('resolves in-process, without spawning a subprocess', async () => {
    mockResolve(() => '/path/to/node_modules/aws-cdk-lib/index.js');
    mockExistsSync.mockReturnValue(true);
    mockReadJSONSync.mockReturnValue({ version: '2.100.0' });

    await getLibraryVersion(mockIoHelper);

    expect(mockRun).not.toHaveBeenCalled();
  });

  test('returns undefined and logs trace when resolved path does not exist', async () => {
    const mockLibPath = '/nonexistent/path/to/aws-cdk-lib/index.js';
    mockResolve(() => mockLibPath);
    mockExistsSync.mockReturnValue(false);

    const result = await getLibraryVersion(mockIoHelper);

    expect(result).toBeUndefined();
    expect(mockExistsSync).toHaveBeenCalledWith(mockLibPath);
    expect(mockReadJSONSync).not.toHaveBeenCalled();
    expect(traceSpy).toHaveBeenCalledWith(
      'Could not get CDK Library Version: require.resolve("aws-cdk-lib") did not return a file path',
    );
  });

  test('returns undefined and logs trace when aws-cdk-lib cannot be resolved', async () => {
    const resolveError = new Error("Cannot find module 'aws-cdk-lib'");
    mockResolve(() => {
      throw resolveError;
    });

    const result = await getLibraryVersion(mockIoHelper);

    expect(result).toBeUndefined();
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadJSONSync).not.toHaveBeenCalled();
    expect(traceSpy).toHaveBeenCalledWith(`Could not get CDK Library Version: ${resolveError}`);
  });

  test('handles package.json without version field', async () => {
    const mockLibPath = '/path/to/node_modules/aws-cdk-lib/index.js';
    mockResolve(() => mockLibPath);
    mockExistsSync.mockReturnValue(true);
    mockReadJSONSync.mockReturnValue({ name: 'aws-cdk-lib' });

    const result = await getLibraryVersion(mockIoHelper);

    expect(result).toBeUndefined();
    expect(traceSpy).toHaveBeenCalledWith('Could not get CDK Library Version: package.json does not have version field');
  });
});
