import * as fs from 'fs';
import * as path from 'path';
import { type Router, type Express } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
import type { DirEntry } from './protocol';
import { resolveWithinRoot } from './safe-path';

/** Largest file the viewer will return inline, to avoid streaming huge artifacts. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ApiOptions {
  /** Root of the CDK app; all file listing/reading is confined to this directory. */
  readonly appDir: string;
}

export function createApiRouter(options: ApiOptions): Router {
  const appDir = canonicalDir(options.appDir);
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/files', (req, res) => {
    const dir = typeof req.query.dir === 'string' ? req.query.dir : '';
    const resolved = resolveWithinRoot(appDir, dir);
    if (!resolved) {
      return res.status(403).json({ error: 'path escapes application directory' });
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return res.status(404).json({ error: 'directory not found' });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'not a directory' });
    }
    return res.json({ dir: toPosix(path.relative(appDir, resolved)), entries: listDir(appDir, resolved) });
  });

  router.get('/file', (req, res) => {
    const requested = typeof req.query.path === 'string' ? req.query.path : '';
    if (!requested) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    const resolved = resolveWithinRoot(appDir, requested);
    if (!resolved) {
      return res.status(403).json({ error: 'path escapes application directory' });
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return res.status(404).json({ error: 'file not found' });
    }
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'not a file' });
    }
    if (stat.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: `file exceeds ${MAX_FILE_BYTES} byte limit` });
    }
    const buffer = fs.readFileSync(resolved);
    if (isBinary(buffer)) {
      return res.status(415).json({ error: 'binary file cannot be displayed' });
    }
    return res.json({ path: toPosix(path.relative(appDir, resolved)), content: buffer.toString('utf-8') });
  });

  return router;
}

export function registerApi(app: Express, options: ApiOptions): void {
  app.use('/api', createApiRouter(options));
}

function listDir(appDir: string, dir: string): DirEntry[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .map((entry): DirEntry => ({
      name: entry.name,
      path: toPosix(path.relative(appDir, path.join(dir, entry.name))),
      type: entry.isDirectory() ? 'dir' : 'file',
    }))
    .sort(byTypeThenName);
}

function byTypeThenName(a: DirEntry, b: DirEntry): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/** Normalize OS separators to '/' so the API contract is stable across platforms. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Canonical app root: realpath so relative paths match resolveWithinRoot's realpathed output. */
function canonicalDir(dir: string): string {
  return fs.realpathSync(path.resolve(dir));
}

/** A NUL byte in the first chunk reliably indicates non-text content. */
function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}
