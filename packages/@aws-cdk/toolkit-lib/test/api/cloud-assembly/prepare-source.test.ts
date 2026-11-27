import os from 'os';
import * as path from 'path';
import * as cxapi from '@aws-cdk/cx-api';
import * as fs from 'fs-extra';
import { frameworkSupportsContextOverflow, writeContextToEnv } from '../../../lib/api/cloud-assembly/private/prepare-source';
import type { ConstructTreeNode } from '../../../lib/api/tree';

describe('writeContextToEnv', () => {
  afterEach(() => jest.restoreAllMocks());

  test.each(['linux', 'win32'] as const)('does not subtract unrelated environment variables on %s', async (platform) => {
    jest.spyOn(os, 'platform').mockReturnValue(platform);
    const env: Record<string, string | undefined> = Object.fromEntries(
      Array.from({ length: 24 }, (_, i) => [`EXTRA_${i}`, 'a'.repeat(6_000)]),
    );
    const context = { probe: 'small' };

    const cleanup = writeContextToEnv(env, context, 'shell');
    try {
      expect(env[cxapi.CONTEXT_ENV]).toEqual(JSON.stringify(context));
      expect(env[cxapi.CONTEXT_OVERFLOW_LOCATION_ENV]).toBeUndefined();
      expect(env.EXTRA_0).toHaveLength(6_000);
      expect(env.EXTRA_23).toHaveLength(6_000);
    } finally {
      await cleanup();
    }
  });

  test.each([
    ['linux', 'shell', 131072],
    ['win32', 'shell', 8191],
    ['win32', 'process', 32760],
  ] as const)('reserves the entry delimiters at the %s/%s boundary', async (platform, mode, limit) => {
    jest.spyOn(os, 'platform').mockReturnValue(platform);
    const entryOverhead = Buffer.byteLength(`${cxapi.CONTEXT_ENV}=\0`);
    const jsonOverhead = Buffer.byteLength(JSON.stringify({ value: '' }));

    for (const extra of [0, 1]) {
      const env: Record<string, string | undefined> = {};
      const context = { value: 'x'.repeat(limit - entryOverhead - jsonOverhead + extra) };
      const cleanup = writeContextToEnv(env, context, mode);
      try {
        if (extra === 0) {
          expect(Buffer.byteLength(`${cxapi.CONTEXT_ENV}=${env[cxapi.CONTEXT_ENV]}\0`)).toEqual(limit);
          expect(JSON.parse(env[cxapi.CONTEXT_ENV]!)).toEqual(context);
          expect(env[cxapi.CONTEXT_OVERFLOW_LOCATION_ENV]).toBeUndefined();
        } else {
          expect(JSON.parse(env[cxapi.CONTEXT_ENV]!)).toEqual({});
          expect(fs.readJSONSync(env[cxapi.CONTEXT_OVERFLOW_LOCATION_ENV]!)).toEqual(context);
        }
      } finally {
        await cleanup();
      }
    }
  });

  test.each([
    ['linux', 'shell', 131072],
    ['win32', 'shell', 8191],
    ['win32', 'process', 32760],
  ] as const)('preserves Unicode context and cleans up overflow on %s/%s', async (platform, mode, limit) => {
    jest.spyOn(os, 'platform').mockReturnValue(platform);
    const env: Record<string, string | undefined> = {};
    const context = { first: 'é😀"\n'.repeat(Math.floor(limit / 64)), second: 'x'.repeat(limit) };
    const cleanup = writeContextToEnv(env, context, mode);
    const overflowFile = env[cxapi.CONTEXT_OVERFLOW_LOCATION_ENV]!;
    try {
      expect(Buffer.byteLength(`${cxapi.CONTEXT_ENV}=${env[cxapi.CONTEXT_ENV]}\0`)).toBeLessThanOrEqual(limit);
      expect(JSON.parse(env[cxapi.CONTEXT_ENV]!)).toEqual({ first: context.first });
      expect({ ...JSON.parse(env[cxapi.CONTEXT_ENV]!), ...fs.readJSONSync(overflowFile) }).toEqual(context);
    } finally {
      await cleanup();
    }
    expect(fs.existsSync(path.dirname(overflowFile))).toBe(false);
    await cleanup();
  });

  test('keeps Windows in-process context above the cmd.exe limit inline', async () => {
    jest.spyOn(os, 'platform').mockReturnValue('win32');
    const env: Record<string, string | undefined> = {};
    const context = { value: 'x'.repeat(12_000) };
    const cleanup = writeContextToEnv(env, context, 'process');
    try {
      expect(JSON.parse(env[cxapi.CONTEXT_ENV]!)).toEqual(context);
      expect(env[cxapi.CONTEXT_OVERFLOW_LOCATION_ENV]).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

describe('frameworkSupportsContextOverflow', () => {
  test('returns true for undefined tree', () => {
    expect(frameworkSupportsContextOverflow(undefined)).toBe(true);
  });

  test('returns true for empty tree', () => {
    expect(frameworkSupportsContextOverflow({} as any)).toBe(true);
  });

  test('returns true for tree with non-App constructs', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        stack1: {
          id: 'stack1',
          path: 'stack1',
          constructInfo: {
            fqn: 'aws-cdk-lib.Stack',
            version: '2.50.0',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(true);
  });

  test('returns false for v1 App', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app: {
          id: 'app',
          path: 'app',
          constructInfo: {
            fqn: '@aws-cdk/core.App',
            version: '1.180.0',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(false);
  });

  test('returns false for v2 App with version <= 2.38.0', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app: {
          id: 'app',
          path: 'app',
          constructInfo: {
            fqn: 'aws-cdk-lib.App',
            version: '2.38.0',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(false);
  });

  test('returns true for v2 App with version > 2.38.0', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app: {
          id: 'app',
          path: 'app',
          constructInfo: {
            fqn: 'aws-cdk-lib.App',
            version: '2.38.1',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(true);
  });

  test('returns true for v2 App with developer version (0.0.0)', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app: {
          id: 'app',
          path: 'app',
          constructInfo: {
            fqn: 'aws-cdk-lib.App',
            version: '0.0.0',
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(true);
  });

  test('returns false if @aws-cdk/core constructs in the tree indicate v1 App', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        nested: {
          id: 'nested',
          path: 'nested',
          children: {
            app: {
              id: 'app',
              path: 'nested/app',
              constructInfo: {
                fqn: '@aws-cdk/core.App',
                version: '1.180.0',
              },
            },
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(false);
  });

  test('returns false if aws-cdk-lib constructs v2 App with version <= 2.38.0', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        nested: {
          id: 'nested',
          path: 'nested',
          children: {
            app: {
              id: 'app',
              path: 'nested/app',
              constructInfo: {
                fqn: 'aws-cdk-lib.App',
                version: '2.38.0',
              },
            },
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(false);
  });

  test('returns true if all v2 Apps in the tree have version > 2.38.0', () => {
    const tree: ConstructTreeNode = {
      id: 'root',
      path: '',
      children: {
        app1: {
          id: 'app1',
          path: 'app1',
          constructInfo: {
            fqn: 'aws-cdk-lib.App',
            version: '2.38.1',
          },
        },
        nested: {
          id: 'nested',
          path: 'nested',
          children: {
            app2: {
              id: 'app2',
              path: 'nested/app2',
              constructInfo: {
                fqn: 'aws-cdk-lib.App',
                version: '2.50.0',
              },
            },
          },
        },
      },
    };
    expect(frameworkSupportsContextOverflow(tree)).toBe(true);
  });
});
