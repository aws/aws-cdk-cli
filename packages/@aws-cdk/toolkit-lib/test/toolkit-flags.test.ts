import { ArtifactType } from '@aws-cdk/cloud-assembly-schema';
import type { CloudAssembly } from '@aws-cdk/cx-api';
import { appFixture, TestIoHost } from './_helpers';
import { Toolkit } from '../lib/toolkit/toolkit';
let ioHost: TestIoHost;

beforeEach(() => {
  jest.restoreAllMocks();
  ioHost = new TestIoHost();
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
  test('should retrieve feature flags in correct structure', async () => {
    const toolkit = new Toolkit({ ioHost });
    const cx = await appFixture(toolkit, 'two-empty-stacks');
    const flags = await toolkit.flags(cx);

    expect(flags.length).toBeGreaterThan(0);
    expect(Array.isArray(flags)).toBe(true);

    const expectedFlags = [
      '@aws-cdk/aws-s3:createDefaultLoggingPolicy',
      '@aws-cdk/core:newStyleStackSynthesis',
      '@aws-cdk/aws-apigateway:usagePlanKeyOrderInsensitiveId',
    ];

    let foundFlags = 0;

    flags.forEach((report) => {
      expect(Object.keys(report.flags).length).toBeGreaterThan(0);
      expect(report).toHaveProperty('module');
      expect(report).toHaveProperty('flags');
      expect(typeof report.module).toBe('string');
      expect(typeof report.flags).toBe('object');

      Object.entries(report.flags).forEach(([flagName, flag]) => {
        expect(typeof flagName).toBe('string');
        expect(flag).toHaveProperty('userValue');
        expect(flag).toHaveProperty('recommendedValue');
        expect(flag).toHaveProperty('explanation');

        expect(typeof flag.explanation).toBe('string');

        if (flag.userValue === null || flag.userValue === undefined) {
          expect(flag.userValue).toBe('-');
        }

        if (flag.explanation === null || flag.explanation === undefined) {
          expect(flag.explanation).toBe('');
        }

        if (expectedFlags.includes(flagName)) {
          foundFlags++;
        }
      });
    });

    expect(foundFlags).toBe(expectedFlags.length);
  });

  test('processes feature flag artifacts correctly when mocked cloud assembly is used', async () => {
    const toolkit = new Toolkit({
      ioHost: new TestIoHost(),
    });

    const mockCloudAssemblySource = createMockCloudAssemblySource({
      'feature-flag-report': {
        type: ArtifactType.FEATURE_FLAG_REPORT,
        properties: {
          module: 'someModule',
          flags: {
            '@aws-cdk/aws-s3:createDefaultLoggingPolicy': {
              userValue: 'true',
              recommendedValue: 'true',
              explanation: 'Enable logging policy for S3',
            },
          },
        },
      },
    });

    const mockFlags = await toolkit.flags(mockCloudAssemblySource as any);

    expect(mockFlags.length).toBe(1);

    const report = mockFlags[0];
    expect(report.module).toBe('someModule');
    expect(report.flags).toHaveProperty('@aws-cdk/aws-s3:createDefaultLoggingPolicy');

    const flag = report.flags['@aws-cdk/aws-s3:createDefaultLoggingPolicy'];
    expect(flag.userValue).toBe('true');
    expect(flag.recommendedValue).toBe('true');
    expect(flag.explanation).toBe('Enable logging policy for S3');
  });

  test('handles multiple feature flag modules', async () => {
    const toolkit = new Toolkit({
      ioHost: new TestIoHost(),
    });

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
    expect(mockFlags[1].module).toBe('module2');
    expect(mockFlags[0].flags).toHaveProperty('flag1');
    expect(mockFlags[1].flags).toHaveProperty('flag2');
  });

  test('filters out non-feature-flag artifacts', async () => {
    const toolkit = new Toolkit({
      ioHost: new TestIoHost(),
    });

    const mockCloudAssemblySource = createMockCloudAssemblySource({
      'feature-flag-report': {
        type: ArtifactType.FEATURE_FLAG_REPORT,
        properties: {
          module: 'testModule',
          flags: {
            testFlag: {
              userValue: true,
              recommendedValue: false,
              explanation: 'Test flag',
            },
          },
        },
      },
      'stack-artifact': {
        type: ArtifactType.AWS_CLOUDFORMATION_STACK,
        properties: {
          templateFile: 'template.json',
        },
      },
      'tree-artifact': {
        type: ArtifactType.CDK_TREE,
        properties: {
          file: 'tree.json',
        },
      },
    });

    const mockFlags = await toolkit.flags(mockCloudAssemblySource as any);

    expect(mockFlags.length).toBe(1);
    expect(mockFlags[0].module).toBe('testModule');
  });
  test('handles various data types for flag values', async () => {
    const toolkit = new Toolkit({
      ioHost: new TestIoHost(),
    });

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
    const flags = mockFlags[0].flags;

    expect(flags.stringFlag.userValue).toBe('string-value');
    expect(flags.stringFlag.recommendedValue).toBe('recommended-string');
    expect(flags.numberFlag.userValue).toBe(123);
    expect(flags.numberFlag.recommendedValue).toBe(456);
    expect(flags.booleanFlag.userValue).toBe(true);
    expect(flags.booleanFlag.recommendedValue).toBe(false);
    expect(flags.arrayFlag.userValue).toEqual(['a', 'b']);
    expect(flags.arrayFlag.recommendedValue).toEqual(['x', 'y']);
    expect(flags.objectFlag.userValue).toEqual({ key: 'value' });
    expect(flags.objectFlag.recommendedValue).toEqual({ key: 'recommended' });
  });
});
