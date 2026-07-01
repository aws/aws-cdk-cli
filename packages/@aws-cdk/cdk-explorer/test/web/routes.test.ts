import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PolicyValidationReportJson } from '@aws-cdk/cloud-assembly-schema';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import type { AssemblyReadResult, ConstructNode } from '../../lib/core/assembly-reader';
import { createApiRouter } from '../../lib/web/routes';

let appDir: string;
let app: express.Express;

beforeEach(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-explorer-routes-'));
  fs.writeFileSync(path.join(appDir, 'app.ts'), 'export const x = 1;\n');
  fs.mkdirSync(path.join(appDir, 'lib'));
  fs.writeFileSync(path.join(appDir, 'lib', 'stack.ts'), 'class Stack {}\n');

  app = express();
  app.use('/api', createApiRouter({ appDir }));
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

describe('GET /api/files', () => {
  test('lists the root directory with directories first', async () => {
    const res = await request(app).get('/api/files');
    expect(res.status).toBe(200);
    expect(res.body.dir).toBe('');
    expect(res.body.entries).toEqual([
      { name: 'lib', path: 'lib', type: 'dir' },
      { name: 'app.ts', path: 'app.ts', type: 'file' },
    ]);
  });

  test('lists a subdirectory', async () => {
    const res = await request(app).get('/api/files').query({ dir: 'lib' });
    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([{ name: 'stack.ts', path: path.join('lib', 'stack.ts'), type: 'file' }]);
  });

  test('rejects traversal outside the app directory with 403', async () => {
    const res = await request(app).get('/api/files').query({ dir: '../..' });
    expect(res.status).toBe(403);
  });

  test('returns 404 for a missing directory', async () => {
    const res = await request(app).get('/api/files').query({ dir: 'nope' });
    expect(res.status).toBe(404);
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
    const a = express();
    a.use('/api', createApiRouter({ appDir, assemblyDir: opts.assemblyDir, readAssembly }));
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
    await request(appWith(reader, { assemblyDir: '/custom/out' })).get('/api/tree');
    expect(seen).toBe('/custom/out');
  });
});

describe('GET /api/policy-validation', () => {
  function appWith(readAssembly: (dir: string) => Promise<AssemblyReadResult>): express.Express {
    const a = express();
    a.use('/api', createApiRouter({ appDir, readAssembly }));
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
