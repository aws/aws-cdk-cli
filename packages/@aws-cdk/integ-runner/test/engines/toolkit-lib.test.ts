/* eslint-disable @typescript-eslint/unbound-method */
import { HotswapMode } from '@aws-cdk/cdk-cli-wrapper';
import { Toolkit, BaseCredentials } from '@aws-cdk/toolkit-lib';
import { ToolkitLibRunnerEngine } from '../../lib/engines/toolkit-lib';

jest.mock('@aws-cdk/toolkit-lib');

const MockedToolkit = Toolkit as jest.MockedClass<typeof Toolkit>;
const MockedBaseCredentials = BaseCredentials as jest.Mocked<typeof BaseCredentials>;

describe('ToolkitLibRunnerEngine', () => {
  let mockToolkit: jest.Mocked<Toolkit>;
  let engine: ToolkitLibRunnerEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToolkit = {
      synth: jest.fn(),
      fromCdkApp: jest.fn(),
      list: jest.fn(),
      deploy: jest.fn(),
      watch: jest.fn(),
      destroy: jest.fn(),
    } as any;
    MockedToolkit.mockImplementation(() => mockToolkit);

    engine = new ToolkitLibRunnerEngine({
      workingDirectory: '/test/dir',
      region: 'us-dummy-1',
    });
  });

  describe('synth', () => {
    it('should call toolkit.synth with correct parameters', async () => {
      const mockCx = { produce: jest.fn() };
      const mockLock = { dispose: jest.fn(), cloudAssembly: { stacksRecursively: [] } };
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.synth.mockResolvedValue(mockLock as any);

      await engine.synth({
        app: 'test-app',
        stacks: ['stack1'],
        validation: true,
      });

      expect(mockToolkit.synth).toHaveBeenCalledWith(mockCx, {
        stacks: {
          strategy: 'pattern-must-match',
          patterns: ['stack1'],
          expand: 'upstream',
        },
        validateStacks: true,
      });
      expect(mockLock.dispose).toHaveBeenCalled();
    });
  });

  describe('synthFast', () => {
    it('should use fromCdkApp and produce for fast synthesis', async () => {
      const mockCx = { produce: jest.fn() };
      const mockLock = { dispose: jest.fn(), cloudAssembly: { stacksRecursively: [] } };
      mockCx.produce.mockResolvedValue(mockLock);
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);

      await engine.synthFast({
        execCmd: ['cdk', 'synth'],
        output: 'cdk.out',
        context: { key: 'value' },
        env: { TEST: 'true' },
      });

      expect(mockToolkit.fromCdkApp).toHaveBeenCalledWith('cdk synth', {
        workingDirectory: '/test/dir',
        outdir: '/test/dir/cdk.out',
        contextStore: expect.any(Object),
        lookups: false,
        env: { TEST: 'true' },
        resolveDefaultEnvironment: false,
        synthOptions: {
          versionReporting: false,
          pathMetadata: false,
          assetMetadata: false,
        },
      });
      expect(mockLock.dispose).toHaveBeenCalled();
    });

    it('should handle missing context error silently', async () => {
      const mockCx = { produce: jest.fn() };
      mockCx.produce.mockRejectedValue(new Error('Missing context keys'));
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);

      await expect(engine.synthFast({
        execCmd: ['cdk', 'synth'],
      })).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return stack names', async () => {
      const mockCx = {};
      const mockStacks = [{ name: 'stack1' }, { name: 'stack2' }];
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.list.mockResolvedValue(mockStacks as any);

      const result = await engine.list({
        app: 'test-app',
        stacks: ['*'],
      });

      expect(result).toEqual(['stack1', 'stack2']);
      expect(mockToolkit.list).toHaveBeenCalledWith(mockCx, {
        stacks: {
          strategy: 'pattern-must-match',
          patterns: ['*'],
          expand: 'upstream',
        },
      });
    });
  });

  describe('deploy', () => {
    it('should call toolkit.deploy with correct parameters', async () => {
      const mockCx = {};
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);

      await engine.deploy({
        app: 'test-app',
        stacks: ['stack1'],
        roleArn: 'arn:aws:iam::123456789012:role/test',
        traceLogs: true,
        hotswap: HotswapMode.FALL_BACK,
      });

      expect(mockToolkit.deploy).toHaveBeenCalledWith(mockCx, {
        roleArn: 'arn:aws:iam::123456789012:role/test',
        traceLogs: true,
        stacks: {
          strategy: 'pattern-must-match',
          patterns: ['stack1'],
          expand: 'upstream',
        },
        deploymentMethod: {
          method: 'hotswap',
          fallback: { method: 'change-set' },
        },
        outputsFile: undefined,
      });
    });

    it('should pass outputsFile with absolute path when provided', async () => {
      const mockCx = {};
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);

      await engine.deploy({
        app: 'test-app',
        stacks: ['stack1'],
        outputsFile: 'assertion-results.json',
      });

      expect(mockToolkit.deploy).toHaveBeenCalledWith(mockCx, {
        stacks: {
          strategy: 'pattern-must-match',
          patterns: ['stack1'],
          expand: 'upstream',
        },
        deploymentMethod: {
          method: 'change-set',
        },
        outputsFile: '/test/dir/assertion-results.json',
      });
    });

    it('should call watch when watch option is true', async () => {
      const mockCx = {};
      const mockWatcher = { waitForEnd: jest.fn() };
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.watch.mockResolvedValue(mockWatcher as any);

      await engine.deploy({
        app: 'test-app',
        watch: true,
      });

      expect(mockToolkit.watch).toHaveBeenCalled();
      expect(mockWatcher.waitForEnd).toHaveBeenCalled();
    });
  });

  describe('watch', () => {
    it('should handle watch errors and call events', async () => {
      const mockCx = {};
      const events = {
        onStderr: jest.fn(),
        onClose: jest.fn(),
      };
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.watch.mockRejectedValue(new Error('Watch failed'));

      await engine.watch({
        app: 'test-app',
      }, events);

      expect(events.onStderr).toHaveBeenCalledWith('Error: Watch failed');
      expect(events.onClose).toHaveBeenCalledWith(1);
    });

    it('should call onClose with 0 on success', async () => {
      const mockCx = {};
      const mockWatcher = { waitForEnd: jest.fn() };
      const events = { onClose: jest.fn() };
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.watch.mockResolvedValue(mockWatcher as any);

      await engine.watch({
        app: 'test-app',
      }, events);

      expect(events.onClose).toHaveBeenCalledWith(0);
    });
  });

  describe('destroy', () => {
    it('should call toolkit.destroy with correct parameters', async () => {
      const mockCx = {};
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);

      await engine.destroy({
        app: 'test-app',
        stacks: ['stack1'],
        roleArn: 'arn:aws:iam::123456789012:role/test',
      });

      expect(mockToolkit.destroy).toHaveBeenCalledWith(mockCx, {
        roleArn: 'arn:aws:iam::123456789012:role/test',
        stacks: {
          strategy: 'pattern-must-match',
          patterns: ['stack1'],
          expand: 'upstream',
        },
      });
    });
  });

  describe('constructor options', () => {
    it('should handle showOutput option', () => {
      new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        showOutput: true,
        region: 'us-dummy-1',
      });

      expect(MockedToolkit).toHaveBeenCalledWith(expect.objectContaining({
        ioHost: expect.any(Object),
      }));
    });

    it('should pass profile to BaseCredentials', () => {
      MockedBaseCredentials.awsCliCompatible = jest.fn();

      new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
        profile: 'test-profile',
      });

      expect(MockedBaseCredentials.awsCliCompatible).toHaveBeenCalledWith({
        profile: 'test-profile',
        defaultRegion: 'us-dummy-1',
      });
    });

    it('should throw error when no app is provided', async () => {
      await expect(engine.synth({} as any)).rejects.toThrow('No app provided');
    });
  });
});
