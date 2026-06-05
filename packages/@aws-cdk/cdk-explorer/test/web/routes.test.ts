import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
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
