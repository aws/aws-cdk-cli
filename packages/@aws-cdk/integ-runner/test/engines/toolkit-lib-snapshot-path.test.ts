/* eslint-disable @typescript-eslint/unbound-method */
import * as path from 'path';
import { Toolkit } from '@aws-cdk/toolkit-lib';
import * as fs from 'fs-extra';
import { ToolkitLibRunnerEngine } from '../../lib/engines/toolkit-lib';

jest.mock('@aws-cdk/toolkit-lib');
jest.mock('fs-extra');

const MockedToolkit = Toolkit as jest.MockedClass<typeof Toolkit>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('ToolkitLibRunnerEngine - Snapshot Path Handling', () => {
  let mockToolkit: jest.Mocked<Toolkit>;
  let engine: ToolkitLibRunnerEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToolkit = {
      fromCdkApp: jest.fn(),
      fromAssemblyDirectory: jest.fn(),
      synth: jest.fn(),
    } as any;
    MockedToolkit.mockImplementation(() => mockToolkit);

    engine = new ToolkitLibRunnerEngine({
      workingDirectory: '/test/dir',
      region: 'us-dummy-1',
    });
  });

  it('should use fromAssemblyDirectory when app is a path to existing snapshot directory', async () => {
    const snapshotPath = 'test.snapshot';
    const fullSnapshotPath = path.join('/test/dir', snapshotPath);
    const mockCx = { produce: jest.fn() };
    const mockLock = { dispose: jest.fn(), cloudAssembly: { stacksRecursively: [] } };

    // Mock fs to indicate the snapshot directory exists
    mockedFs.pathExistsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as any);

    mockToolkit.fromAssemblyDirectory.mockResolvedValue(mockCx as any);
    mockToolkit.synth.mockResolvedValue(mockLock as any);

    await engine.synth({
      app: snapshotPath,
      stacks: ['stack1'],
    });

    expect(mockedFs.pathExistsSync).toHaveBeenCalledWith(fullSnapshotPath);
    expect(mockedFs.statSync).toHaveBeenCalledWith(fullSnapshotPath);
    expect(mockToolkit.fromAssemblyDirectory).toHaveBeenCalledWith(fullSnapshotPath);
    expect(mockToolkit.fromCdkApp).not.toHaveBeenCalled();
  });

  it('should use fromCdkApp when app is not a path to existing directory', async () => {
    const appCommand = 'node bin/app.js';
    const mockCx = { produce: jest.fn() };
    const mockLock = { dispose: jest.fn(), cloudAssembly: { stacksRecursively: [] } };

    // Mock fs to indicate the path doesn't exist
    mockedFs.pathExistsSync.mockReturnValue(false);

    mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
    mockToolkit.synth.mockResolvedValue(mockLock as any);

    await engine.synth({
      app: appCommand,
      stacks: ['stack1'],
    });

    expect(mockToolkit.fromCdkApp).toHaveBeenCalledWith(appCommand, expect.any(Object));
    expect(mockToolkit.fromAssemblyDirectory).not.toHaveBeenCalled();
  });

  it('should use fromCdkApp when app path exists but is not a directory', async () => {
    const appPath = 'app.js';
    const fullAppPath = path.join('/test/dir', appPath);
    const mockCx = { produce: jest.fn() };
    const mockLock = { dispose: jest.fn(), cloudAssembly: { stacksRecursively: [] } };

    // Mock fs to indicate the path exists but is not a directory
    mockedFs.pathExistsSync.mockReturnValue(true);
    mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

    mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
    mockToolkit.synth.mockResolvedValue(mockLock as any);

    await engine.synth({
      app: appPath,
      stacks: ['stack1'],
    });

    expect(mockedFs.pathExistsSync).toHaveBeenCalledWith(fullAppPath);
    expect(mockedFs.statSync).toHaveBeenCalledWith(fullAppPath);
    expect(mockToolkit.fromCdkApp).toHaveBeenCalledWith(appPath, expect.any(Object));
    expect(mockToolkit.fromAssemblyDirectory).not.toHaveBeenCalled();
  });
});
