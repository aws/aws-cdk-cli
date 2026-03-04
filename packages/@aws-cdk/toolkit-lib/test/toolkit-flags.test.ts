import type { CloudAssembly } from '@aws-cdk/cloud-assembly-api';
import { ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import { appFixture, TestIoHost, builderFixture } from './_helpers';
import { Toolkit } from '../lib/toolkit/toolkit';

let ioHost: TestIoHost;
beforeEach(() => {
  jest.restoreAllMocks();
  ioHost = new TestIoHost();
});

const toolkit = new Toolkit({
  ioHost: new TestIoHost(), unstableFeatures: ['flags'],
});

function createMockCloudAssemblySource(artifacts: any) {
  return {
    async produce() {
      const mockCloudAssembly = {
        manifest: {
          artifacts: artifacts,
        },
      } as CloudAssembly;

      return {
        cloudAssembly: mockCloudAssembly,
        dispose: jest.fn(),
        [Symbol.asyncDispose]: jest.fn(),
        _unlock: jest.fn(),
      };
    },
  };
}

describe('Toolkit.flags() method', () => {
  test('requires acknowledgment that the feature is unstable', async () => {
    const tk = new Toolkit({ ioHost });
    const cx = await builderFixture(tk, 'stack-with-bucket');

    await expect(
      tk.flags(cx),
    ).rejects.toThrow("Unstable feature 'flags' is not enabled. Please enable it under 'unstableFeatures'");
  });

  test('should retrieve feature flags in correct structure', async () => {
    const tk = new Toolkit({ ioHost, unstableFeatures: ['flags'] });
    const cx = await appFixture(toolkit, 'two-empty-stacks');
    const flags = await tk.flags(cx);

    expect(flags.length).toBeGreaterThan(0);
    expect(Array.isArray(flags)).toBe(true);

    flags.forEach((flag) => {
      expect(flag).toHaveProperty('module');
      expect(flag).toHaveProperty('recommendedValue');
      expect(flag).toHaveProperty('userValue');
      expect(flag).toHaveProperty('explanation');
      expect(flag).toHaveProperty('name');
    });
  });

  test('processes feature flag correctly when mocked cloud assembly is used', async () => {
    const mockCloudAssemblySource = createMockCloudAssemblySource({
      'aws-cdk-lib/feature-flag-report': {
        type: 'cdk:feature-flag-report',
        properties: {
          module: 'aws-cdk-lib',
          flags: {
            '@aws-cdk/core:enableStackNameDuplicates': {
              recommendedValue: true,
              explanation: 'Allow multiple stacks with the same name',
            },
          },
        },
      },
    });

    const mockFlags = await toolkit.flags(mockCloudAssemblySource as any);

    expect(mockFlags.length).toBe(1);
    expect(mockFlags[0].module).toEqual('aws-cdk-lib');
    expect(mockFlags[0].name).toEqual('@aws-cdk/core:enableStackNameDuplicates');
    expect(mockFlags[0].userValue).toBeUndefined();
    expect(mockFlags[0].recommendedValue).toEqual(true);
    expect(mockFlags[0].explanation).toEqual('Allow multiple stacks with the same name');
  });

  test('handles multiple feature flag modules', async () => {
    const mockCloudAssemblySource = createMockCloudAssemblySource({
      'module1-flags': {
        type: ArtifactType.FEATURE_FLAG_REPORT,
        properties: {
          module: 'module1',
          flags: {
            flag1: {
              userValue: true,
              recommendedValue: false,
              explanation: 'Module 1 flag',
            },
          },
        },
      },
      'module2-flags': {
        type: ArtifactType.FEATURE_FLAG_REPORT,
        properties: {
          module: 'module2',
          flags: {
            flag2: {
              userValue: 'value',
              recommendedValue: 'recommended',
              explanation: 'Module 2 flag',
            },
          },
        },
      },
    });

    const mockFlags = await toolkit.flags(mockCloudAssemblySource as any);

    expect(mockFlags.length).toBe(2);
    expect(mockFlags[0].module).toBe('module1');
    expect(mockFlags[0].explanation).toEqual('Module 1 flag');
    expect(mockFlags[0].name).toEqual('flag1');
    expect(mockFlags[0].userValue).toEqual(true);
    expect(mockFlags[0].recommendedValue).toEqual(false);
    expect(mockFlags[1].module).toBe('module2');
    expect(mockFlags[1].explanation).toEqual('Module 2 flag');
    expect(mockFlags[1].name).toEqual('flag2');
    expect(mockFlags[1].userValue).toEqual('value');
    expect(mockFlags[1].recommendedValue).toEqual('recommended');
  });

  test('handles various data types for flag values', async () => {
    const mockCloudAssemblySource = createMockCloudAssemblySource({
      'feature-flag-report': {
        type: ArtifactType.FEATURE_FLAG_REPORT,
        properties: {
          module: 'testModule',
          flags: {
            stringFlag: {
              userValue: 'string-value',
              recommendedValue: 'recommended-string',
              explanation: 'String flag',
            },
            numberFlag: {
              userValue: 123,
              recommendedValue: 456,
              explanation: 'Number flag',
            },
            booleanFlag: {
              userValue: true,
              recommendedValue: false,
              explanation: 'Boolean flag',
            },
            arrayFlag: {
              userValue: ['a', 'b'],
              recommendedValue: ['x', 'y'],
              explanation: 'Array flag',
            },
            objectFlag: {
              userValue: { key: 'value' },
              recommendedValue: { key: 'recommended' },
              explanation: 'Object flag',
            },
          },
        },
      },
    });

    const mockFlags = await toolkit.flags(mockCloudAssemblySource as any);

    expect(mockFlags[0].userValue).toBe('string-value');
    expect(mockFlags[0].recommendedValue).toBe('recommended-string');
    expect(mockFlags[1].userValue).toBe(123);
    expect(mockFlags[1].recommendedValue).toBe(456);
    expect(mockFlags[2].userValue).toBe(true);
    expect(mockFlags[2].recommendedValue).toBe(false);
    expect(mockFlags[3].userValue).toEqual(['a', 'b']);
    expect(mockFlags[3].recommendedValue).toEqual(['x', 'y']);
    expect(mockFlags[4].userValue).toEqual({ key: 'value' });
    expect(mockFlags[4].recommendedValue).toEqual({ key: 'recommended' });
  });
});
