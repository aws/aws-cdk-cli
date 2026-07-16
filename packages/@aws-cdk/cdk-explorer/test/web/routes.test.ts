import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PolicyValidationReportJson } from '@aws-cdk/cloud-assembly-schema';
import { LockError } from '@aws-cdk/toolkit-lib';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import type { AssemblyReadResult, ConstructNode } from '../../lib/core/assembly-reader';
import { createApiRouter } from '../../lib/web/routes';

let appDir: string;
let app: express.Express;

/** No-op assembly lock; these tests inject readAssembly directly, so no real lock is exercised. */
const noopAssemblyLock = async () => ({ release: () => Promise.resolve() });

/** Writes a minimal manifest so the router's mtime check reaches the injected readAssembly. */
function writeManifest(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{"version":"36.0.0"}');
}

beforeEach(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-routes-'));
  fs.writeFileSync(path.join(appDir, 'app.ts'), 'export const x = 1;\n');
  fs.mkdirSync(path.join(appDir, 'lib'));
  fs.writeFileSync(path.join(appDir, 'lib', 'stack.ts'), 'class Stack {}\n');

  app = express();
  app.use('/api', createApiRouter({ appDir, acquireAssemblyLock: noopAssemblyLock }));
});

afterEach(() => {
  fs.rmSync(appDir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  test('returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('GET /api/file', () => {
  test('returns file content', async () => {
    const res = await request(app).get('/api/file').query({ path: 'app.ts' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: 'app.ts', content: 'export const x = 1;\n' });
  });

  test('requires a path parameter', async () => {
    const res = await request(app).get('/api/file');
    expect(res.status).toBe(400);
  });

  test('rejects traversal with 403', async () => {
    const res = await request(app).get('/api/file').query({ path: '../../../etc/passwd' });
    expect(res.status).toBe(403);
  });

  test('returns 404 for a missing file', async () => {
    const res = await request(app).get('/api/file').query({ path: 'missing.ts' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when the path is a directory', async () => {
    const res = await request(app).get('/api/file').query({ path: 'lib' });
    expect(res.status).toBe(400);
  });

  test('rejects binary files with 415', async () => {
    fs.writeFileSync(path.join(appDir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const res = await request(app).get('/api/file').query({ path: 'bin.dat' });
    expect(res.status).toBe(415);
  });
});

describe('symlink containment', () => {
  test('rejects a symlink inside appDir that points outside with 403', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
    try {
      try {
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(appDir, 'link.txt'));
      } catch {
        return; // symlinks not permitted in this environment; skip
      }
      const res = await request(app).get('/api/file').query({ path: 'link.txt' });
      expect(res.status).toBe(403);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('GET /api/tree', () => {
  /** Build an app whose /api router uses an injected assembly reader. */
  function appWith(
    readAssembly: (dir: string) => Promise<AssemblyReadResult>,
    opts: { assemblyDir?: string } = {},
  ): express.Express {
    const assemblyDir = opts.assemblyDir ?? path.join(appDir, 'cdk.out');
    writeManifest(assemblyDir);
    const a = express();
    a.use('/api', createApiRouter({ appDir, assemblyDir, readAssembly, acquireAssemblyLock: noopAssemblyLock }));
    return a;
  }

  test('maps a successful read into an ok TreeResponse with relativized paths', async () => {
    const realAppDir = fs.realpathSync(appDir);
    const reader = async (dir: string): Promise<AssemblyReadResult> => {
      const node: ConstructNode = {
        path: 'MyStack/Bucket',
        id: 'Bucket',
        type: 'AWS::S3::Bucket',
        logicalId: 'Bucket123',
        templateFile: path.join(dir, 'MyStack.template.json'),
        sourceLocation: { file: path.join(realAppDir, 'lib', 'stack.ts'), line: 12, column: 5 },
        children: [],
      };
      return { status: 'success', data: { tree: [node], warnings: ['heads up'] } };
    };

    const res = await request(appWith(reader)).get('/api/tree');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.warnings).toEqual(['heads up']);
    expect(res.body.tree).toHaveLength(1);
    expect(res.body.tree[0]).toMatchObject({
      path: 'MyStack/Bucket',
      logicalId: 'Bucket123',
      templateFile: 'MyStack.template.json',
      sourceLocation: { file: 'lib/stack.ts', line: 12, column: 5 },
    });
  });

  test('returns not-synthesized (200) when no assembly is found', async () => {
    const res = await request(appWith(async () => ({ status: 'not-found' }))).get('/api/tree');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'not-synthesized' });
  });

  test('returns 500 when the read errors', async () => {
    const res = await request(appWith(async () => ({ status: 'error', message: 'bad manifest' }))).get('/api/tree');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'bad manifest' });
  });

  test('defaults the assembly dir to <appDir>/cdk.out', async () => {
    let seen: string | undefined;
    const reader = async (dir: string): Promise<AssemblyReadResult> => {
      seen = dir;
      return { status: 'not-found' };
    };
    await request(appWith(reader)).get('/api/tree');
    expect(seen).toBe(path.join(appDir, 'cdk.out'));
  });

  test('honors an explicit assemblyDir override', async () => {
    let seen: string | undefined;
    const reader = async (dir: string): Promise<AssemblyReadResult> => {
      seen = dir;
      return { status: 'not-found' };
    };
    const override = path.join(appDir, 'custom-out');
    await request(appWith(reader, { assemblyDir: override })).get('/api/tree');
    expect(seen).toBe(override);
  });
});

describe('GET /api/template', () => {
  const TEMPLATE_OBJ = {
    Resources: {
      Bucket123: {
        Type: 'AWS::S3::Bucket',
        Properties: { BucketName: 'my-bucket', VersioningConfiguration: { Status: 'Enabled' } },
      },
      Topic456: { Type: 'AWS::SNS::Topic' },
    },
  };
  const TEMPLATE_TEXT = JSON.stringify(TEMPLATE_OBJ, undefined, 1);

  function appWith(
    readAssembly: (dir: string) => Promise<AssemblyReadResult>,
    opts: { assemblyDir?: string } = {},
  ): express.Express {
    const assemblyDir = opts.assemblyDir ?? path.join(appDir, 'cdk.out');
    writeManifest(assemblyDir);
    fs.writeFileSync(path.join(assemblyDir, 'MyStack.template.json'), TEMPLATE_TEXT);
    const a = express();
    a.use('/api', createApiRouter({ appDir, assemblyDir, readAssembly, acquireAssemblyLock: noopAssemblyLock }));
    return a;
  }

  test('returns template content and resource line ranges', async () => {
    const realAppDir = fs.realpathSync(appDir);
    const assemblyDir = path.join(appDir, 'cdk.out');
    const reader = async (dir: string): Promise<AssemblyReadResult> => {
      const node: ConstructNode = {
        path: 'MyStack/Bucket',
        id: 'Bucket',
        type: 'AWS::S3::Bucket',
        logicalId: 'Bucket123',
        templateFile: path.join(dir, 'MyStack.template.json'),
        sourceLocation: { file: path.join(realAppDir, 'lib', 'stack.ts'), line: 10, column: 5 },
        children: [],
      };
      return { status: 'success', data: { tree: [node], warnings: [] } };
    };

    const res = await request(appWith(reader)).get('/api/template').query({ file: 'MyStack.template.json' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe(TEMPLATE_TEXT);
    expect(res.body.resources.Bucket123).toBeDefined();
    expect(res.body.resources.Bucket123.block.startLine).toBeGreaterThan(0);
    expect(res.body.resources.Bucket123.block.endLine).toBeGreaterThanOrEqual(res.body.resources.Bucket123.block.startLine);
    expect(res.body.resources.Bucket123.source).toEqual({ file: 'lib/stack.ts', line: 10, column: 5 });
    expect(res.body.resources.Topic456).toBeDefined();
    expect(res.body.resources.Topic456.source).toBeUndefined();
  });

  test('requires a file parameter', async () => {
    const reader = async (): Promise<AssemblyReadResult> => ({ status: 'not-found' });
    const res = await request(appWith(reader)).get('/api/template');
    expect(res.status).toBe(400);
  });

  test('rejects path traversal with 403', async () => {
    const reader = async (): Promise<AssemblyReadResult> => ({ status: 'not-found' });
    const res = await request(appWith(reader)).get('/api/template').query({ file: '../../etc/passwd' });
    expect(res.status).toBe(403);
  });

  test('returns 404 for a missing template', async () => {
    const reader = async (): Promise<AssemblyReadResult> => ({ status: 'not-found' });
    const res = await request(appWith(reader)).get('/api/template').query({ file: 'nope.template.json' });
    expect(res.status).toBe(404);
  });

  test('works without a construct tree (assembly not found)', async () => {
    const reader = async (): Promise<AssemblyReadResult> => ({ status: 'not-found' });
    const res = await request(appWith(reader)).get('/api/template').query({ file: 'MyStack.template.json' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe(TEMPLATE_TEXT);
    expect(res.body.resources.Bucket123).toBeDefined();
    expect(res.body.resources.Bucket123.source).toBeUndefined();
  });
});

describe('GET /api/policy-validation', () => {
  function appWith(readAssembly: (dir: string) => Promise<AssemblyReadResult>): express.Express {
    const assemblyDir = path.join(appDir, 'cdk.out');
    writeManifest(assemblyDir);
    const a = express();
    a.use('/api', createApiRouter({ appDir, assemblyDir, readAssembly, acquireAssemblyLock: noopAssemblyLock }));
    return a;
  }

  test('normalizes violations joined to the construct tree', async () => {
    const realAppDir = fs.realpathSync(appDir);
    const reader = async (dir: string): Promise<AssemblyReadResult> => {
      const node: ConstructNode = {
        path: 'MyStack/Bucket',
        id: 'Bucket',
        type: 'AWS::S3::Bucket',
        logicalId: 'Bucket123',
        templateFile: path.join(dir, 'MyStack.template.json'),
        sourceLocation: { file: path.join(realAppDir, 'lib', 'stack.ts'), line: 7, column: 3 },
        children: [],
      };
      const violations: PolicyValidationReportJson = {
        version: '1.0',
        pluginReports: [
          {
            pluginName: 'cdk-validator',
            conclusion: 'failure',
            violations: [
              {
                ruleName: 'no-public-access',
                description: 'no public access',
                severity: 'error',
                violatingConstructs: [
                  { constructPath: 'MyStack/Bucket', cloudFormationResource: { templatePath: 'x', logicalId: 'y', propertyPaths: ['Properties.Public'] } },
                ],
              },
            ],
          },
        ],
      };
      return { status: 'success', data: { tree: [node], violations, warnings: [] } };
    };

    const res = await request(appWith(reader)).get('/api/policy-validation');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.violations).toHaveLength(1);
    expect(res.body.violations[0]).toMatchObject({ ruleName: 'no-public-access', severity: 'error', source: 'cdk-validator' });
    expect(res.body.violations[0].occurrences[0]).toMatchObject({
      constructPath: 'MyStack/Bucket',
      logicalId: 'Bucket123',
      templateFile: 'MyStack.template.json',
      sourceLocation: { file: 'lib/stack.ts', line: 7, column: 3 },
      propertyPaths: ['Properties.Public'],
    });
  });

  test('returns not-synthesized (200) when no assembly is found', async () => {
    const res = await request(appWith(async () => ({ status: 'not-found' }))).get('/api/policy-validation');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'not-synthesized' });
  });

  test('returns 500 when the read errors', async () => {
    const res = await request(appWith(async () => ({ status: 'error', message: 'boom' }))).get('/api/policy-validation');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});

describe('assembly read lock', () => {
  function appWithLock(acquireAssemblyLock: () => Promise<{ release: () => Promise<void> }>): express.Express {
    const assemblyDir = path.join(appDir, 'cdk.out');
    writeManifest(assemblyDir);
    const a = express();
    a.use('/api', createApiRouter({
      appDir,
      assemblyDir,
      readAssembly: () => ({ status: 'not-found' }),
      acquireAssemblyLock,
    }));
    return a;
  }

  test('acquires the lock and releases it after reading', async () => {
    const release = jest.fn(() => Promise.resolve());
    const acquireAssemblyLock = jest.fn(async () => ({ release }));
    const res = await request(appWithLock(acquireAssemblyLock)).get('/api/tree');
    expect(res.status).toBe(200);
    expect(acquireAssemblyLock).toHaveBeenCalledWith(path.join(appDir, 'cdk.out'));
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('retries while a synth holds the write lock, then reads once it clears', async () => {
    let calls = 0;
    const acquireAssemblyLock = jest.fn(async () => {
      calls += 1;
      if (calls <= 2) throw new LockError('ConcurrentWriteLock', 'a synth is writing');
      return { release: () => Promise.resolve() };
    });
    const res = await request(appWithLock(acquireAssemblyLock)).get('/api/tree');
    expect(res.status).toBe(200);
    expect(acquireAssemblyLock).toHaveBeenCalledTimes(3); // 2 contended + 1 success
  });

  test('returns 503 when the write lock never clears', async () => {
    const acquireAssemblyLock = jest.fn(async () => {
      throw new LockError('ConcurrentWriteLock', 'a synth is writing');
    });
    const res = await request(appWithLock(acquireAssemblyLock)).get('/api/tree');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'synth in progress, please retry' });
  });

  test('returns 500 when the lock fails for a non-contention reason', async () => {
    const acquireAssemblyLock = jest.fn(async () => {
      throw new Error('corrupt manifest');
    });
    const res = await request(appWithLock(acquireAssemblyLock)).get('/api/tree');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'corrupt manifest' });
  });

  test('serves a cached read without re-locking while the manifest mtime is unchanged', async () => {
    const assemblyDir = path.join(appDir, 'cdk.out');
    writeManifest(assemblyDir);
    const acquireAssemblyLock = jest.fn(async () => ({ release: () => Promise.resolve() }));
    const readAssembly = jest.fn((): AssemblyReadResult => ({ status: 'success', data: { tree: [], warnings: [] } }));
    const a = express();
    a.use('/api', createApiRouter({ appDir, assemblyDir, readAssembly, acquireAssemblyLock }));
    await request(a).get('/api/tree');
    await request(a).get('/api/tree');
    expect(readAssembly).toHaveBeenCalledTimes(1); // second request served from cache
    expect(acquireAssemblyLock).toHaveBeenCalledTimes(1); // no lock taken on a cache hit
  });

  test('re-reads under the lock when the manifest mtime changes', async () => {
    const assemblyDir = path.join(appDir, 'cdk.out');
    writeManifest(assemblyDir);
    const acquireAssemblyLock = jest.fn(async () => ({ release: () => Promise.resolve() }));
    const readAssembly = jest.fn((): AssemblyReadResult => ({ status: 'success', data: { tree: [], warnings: [] } }));
    const a = express();
    a.use('/api', createApiRouter({ appDir, assemblyDir, readAssembly, acquireAssemblyLock }));
    await request(a).get('/api/tree');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(assemblyDir, 'manifest.json'), future, future);
    await request(a).get('/api/tree');
    expect(readAssembly).toHaveBeenCalledTimes(2); // mtime changed, so re-read
  });
});
