/* eslint-disable @typescript-eslint/unbound-method */
import * as os from 'os';
import * as path from 'path';
import { Toolkit, BaseCredentials } from '@aws-cdk/toolkit-lib';
import * as fs from 'fs-extra';
import { ProxyAgentProvider } from '../../lib/engines/proxy-agent';
import { ToolkitLibRunnerEngine } from '../../lib/engines/toolkit-lib';

jest.mock('@aws-cdk/toolkit-lib');
jest.mock('proxy-agent', () => ({
  ProxyAgent: jest.fn().mockImplementation((opts: any) => ({
    _proxyAgentOpts: opts,
  })),
}));

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
    it('should use fromCdkApp and produce for fast synthesis', async () => {
      const mockCx = { produce: jest.fn() };
      const mockLock = { [Symbol.asyncDispose]: jest.fn(), cloudAssembly: { stacksRecursively: [] } };
      mockCx.produce.mockResolvedValue(mockLock);
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.synth.mockImplementation((cx) => cx.produce() as any);

      await engine.synth({
        app: 'cdk synth',
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
      expect(mockLock[Symbol.asyncDispose]).toHaveBeenCalled();
    });

    it('should handle missing context error silently', async () => {
      const mockCx = { produce: jest.fn() };
      mockCx.produce.mockRejectedValue(new Error('Missing context keys'));
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.synth.mockImplementation((cx) => cx.produce() as any);

      await expect(engine.synth({
        app: 'cdk synth',
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
          method: 'change-set',
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

  describe('per-action profile override', () => {
    it('should use a different profile for deploy when cdkCommandOptions specifies one', async () => {
      MockedBaseCredentials.awsCliCompatible = jest.fn();

      const overrideEngine = new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
        profile: 'default-profile',
      });

      expect(MockedBaseCredentials.awsCliCompatible).toHaveBeenCalledWith({
        profile: 'default-profile',
        defaultRegion: 'us-dummy-1',
      });

      const mockCx = {};
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);

      await overrideEngine.deploy({
        app: 'test-app',
        stacks: ['stack1'],
        profile: 'override-profile',
      });

      expect(MockedBaseCredentials.awsCliCompatible).toHaveBeenCalledWith({
        profile: 'override-profile',
        defaultRegion: 'us-dummy-1',
      });
    });

    it('should use a different profile for destroy when cdkCommandOptions specifies one', async () => {
      MockedBaseCredentials.awsCliCompatible = jest.fn();

      const overrideEngine = new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
        profile: 'default-profile',
      });

      const mockCx = {};
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);

      await overrideEngine.destroy({
        app: 'test-app',
        stacks: ['stack1'],
        profile: 'override-profile',
      });

      expect(MockedBaseCredentials.awsCliCompatible).toHaveBeenCalledWith({
        profile: 'override-profile',
        defaultRegion: 'us-dummy-1',
      });
    });

    it('should use a different profile for list when options specify one', async () => {
      MockedBaseCredentials.awsCliCompatible = jest.fn();

      const overrideEngine = new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
        profile: 'default-profile',
      });

      const mockCx = {};
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.list.mockResolvedValue([]);

      await overrideEngine.list({
        app: 'test-app',
        stacks: ['stack1'],
        profile: 'override-profile',
      });

      expect(MockedBaseCredentials.awsCliCompatible).toHaveBeenCalledWith({
        profile: 'override-profile',
        defaultRegion: 'us-dummy-1',
      });
    });

    it('should use a different profile for watch when options specify one', async () => {
      MockedBaseCredentials.awsCliCompatible = jest.fn();

      const overrideEngine = new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
        profile: 'default-profile',
      });

      const mockCx = {};
      const mockWatcher = { waitForEnd: jest.fn() };
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);
      mockToolkit.watch.mockResolvedValue(mockWatcher as any);

      await overrideEngine.watch({
        app: 'test-app',
        stacks: ['stack1'],
        profile: 'override-profile',
      });

      expect(MockedBaseCredentials.awsCliCompatible).toHaveBeenCalledWith({
        profile: 'override-profile',
        defaultRegion: 'us-dummy-1',
      });
    });

    it('should reuse cached toolkit when deploy profile matches constructor profile', async () => {
      MockedBaseCredentials.awsCliCompatible = jest.fn();

      const sameProfileEngine = new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
        profile: 'same-profile',
      });

      const constructorCallCount = MockedToolkit.mock.calls.length;

      const mockCx = {};
      mockToolkit.fromCdkApp.mockResolvedValue(mockCx as any);

      await sameProfileEngine.deploy({
        app: 'test-app',
        stacks: ['stack1'],
        profile: 'same-profile',
      });

      // Toolkit is reused from cache when profile matches
      expect(MockedToolkit).toHaveBeenCalledTimes(constructorCallCount);
    });
  });

  describe('proxy configuration', () => {
    beforeEach(() => {
      ProxyAgentProvider.clearCache();
    });

    it('should pass agent to Toolkit sdkConfig', () => {
      new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
      });

      expect(MockedToolkit).toHaveBeenCalledWith(expect.objectContaining({
        sdkConfig: expect.objectContaining({
          httpOptions: expect.objectContaining({
            agent: expect.any(Object),
          }),
        }),
      }));
    });

    it('should pass proxy address to ProxyAgentProvider', () => {
      const spy = jest.spyOn(ProxyAgentProvider, 'getOrCreate');

      new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
        proxy: 'http://my-proxy:8080',
      });

      expect(spy).toHaveBeenCalledWith({
        proxyAddress: 'http://my-proxy:8080',
        caBundlePath: undefined,
      });
    });

    it('should pass caBundlePath to ProxyAgentProvider', () => {
      const spy = jest.spyOn(ProxyAgentProvider, 'getOrCreate');

      new ToolkitLibRunnerEngine({
        workingDirectory: '/test',
        region: 'us-dummy-1',
        caBundlePath: '/path/to/ca.pem',
      });

      expect(spy).toHaveBeenCalledWith({
        proxyAddress: undefined,
        caBundlePath: '/path/to/ca.pem',
      });
    });

    it('should reuse cached agent for identical options', () => {
      const agent1 = ProxyAgentProvider.getOrCreate({ proxyAddress: 'http://proxy:8080' });
      const agent2 = ProxyAgentProvider.getOrCreate({ proxyAddress: 'http://proxy:8080' });

      expect(agent1).toBe(agent2);
    });

    it('should create different agents for different options', () => {
      const agent1 = ProxyAgentProvider.getOrCreate({ proxyAddress: 'http://proxy1:8080' });
      const agent2 = ProxyAgentProvider.getOrCreate({ proxyAddress: 'http://proxy2:8080' });

      expect(agent1).not.toBe(agent2);
    });

    it('should read CA bundle from file', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-test-'));
      const caPath = path.join(tmpDir, 'ca-bundle.pem');
      fs.writeFileSync(caPath, 'test-ca-cert');

      try {
        const agent = ProxyAgentProvider.getOrCreate({ caBundlePath: caPath }) as any;
        expect(agent._proxyAgentOpts.ca).toBe('test-ca-cert');
      } finally {
        fs.removeSync(tmpDir);
      }
    });

    it('should read CA bundle from AWS_CA_BUNDLE env var', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-test-'));
      const caPath = path.join(tmpDir, 'env-ca-bundle.pem');
      fs.writeFileSync(caPath, 'env-ca-cert');
      const original = process.env.AWS_CA_BUNDLE;
      process.env.AWS_CA_BUNDLE = caPath;

      try {
        const agent = ProxyAgentProvider.getOrCreate() as any;
        expect(agent._proxyAgentOpts.ca).toBe('env-ca-cert');
      } finally {
        if (original === undefined) {
          delete process.env.AWS_CA_BUNDLE;
        } else {
          process.env.AWS_CA_BUNDLE = original;
        }
        fs.removeSync(tmpDir);
      }
    });

    it('should handle non-existent CA bundle path gracefully', () => {
      const agent = ProxyAgentProvider.getOrCreate({ caBundlePath: '/nonexistent/ca-bundle.pem' }) as any;
      expect(agent._proxyAgentOpts.ca).toBeUndefined();
    });
  });
});

