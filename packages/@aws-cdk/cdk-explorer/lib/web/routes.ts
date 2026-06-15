import * as fs from 'fs';
import * as path from 'path';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import type { PolicyValidationReportJson, ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
import { type Router, type Express } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
import type { DirEntry, TreeResponse, ViolationsResponse, WebConstructNode, WebSourceLocation, WebViolation, WebViolationOccurrence } from './protocol';
import { resolveWithinRoot } from './safe-path';
import { readAssembly as defaultReadAssembly, type AssemblyReadResult, type ConstructNode } from '../core/assembly-reader';
import type { SourceLocation } from '../core/source-resolver';

/** Largest file the viewer will return inline, to avoid streaming huge artifacts. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ApiOptions {
  /** Root of the CDK app; all file listing/reading is confined to this directory. */
  readonly appDir: string;
  /**
   * Cloud assembly directory the construct tree and violations are read from.
   * Defaults to `<appDir>/cdk.out`.
   */
  readonly assemblyDir?: string;
  /**
   * Reader for the cloud assembly. Injectable for tests; defaults to the real
   * `readAssembly` against {@link assemblyDir}.
   */
  readonly readAssembly?: (assemblyDir: string) => AssemblyReadResult;
}

export function createApiRouter(options: ApiOptions): Router {
  const appDir = canonicalDir(options.appDir);
  const assemblyDir = options.assemblyDir ?? path.join(options.appDir, 'cdk.out');
  const readAssembly = options.readAssembly ?? defaultReadAssembly;
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

  router.get('/tree', (_req, res) => {
    const result = readAssembly(assemblyDir);
    if (result.status === 'not-found') {
      const body: TreeResponse = { status: 'not-synthesized' };
      return res.json(body);
    }
    if (result.status === 'error') {
      return res.status(500).json({ error: result.message });
    }
    const tree = result.data.tree.map((node) => toWebNode(collapseDefaultChildren(node), assemblyDir, appDir));
    const body: TreeResponse = { status: 'ok', tree, warnings: result.data.warnings };
    return res.json(body);
  });

  router.get('/policy-validation', (_req, res) => {
    const result = readAssembly(assemblyDir);
    if (result.status === 'not-found') {
      const body: ViolationsResponse = { status: 'not-synthesized' };
      return res.json(body);
    }
    if (result.status === 'error') {
      return res.status(500).json({ error: result.message });
    }
    const index = ConstructIndex.fromTree(result.data.tree);
    const violations = normalizeViolations(result.data.violations, index, assemblyDir, appDir);
    const body: ViolationsResponse = { status: 'ok', violations, reportError: result.data.violationsError };
    return res.json(body);
  });

  return router;
}

export function registerApi(app: Express, options: ApiOptions): void {
  app.use('/api', createApiRouter(options));
}

/**
 * Map a core construct node to its wire form. Absolute filesystem paths are
 * relativized to roots the client can resolve: `templateFile` to the cloud
 * assembly directory, `sourceLocation.file` to the app directory. A source
 * location that resolves outside the app directory is dropped, since
 * `/api/file` cannot serve it. Recurses over children.
 */
export function toWebNode(node: ConstructNode, assemblyDir: string, appDir: string): WebConstructNode {
  return {
    path: node.path,
    id: node.id,
    type: node.type,
    logicalId: node.logicalId,
    templateFile: node.templateFile ? toPosix(path.relative(assemblyDir, node.templateFile)) : undefined,
    sourceLocation: toWebSourceLocation(node.sourceLocation, appDir),
    children: node.children.map((child) => toWebNode(child, assemblyDir, appDir)),
  };
}

/** Ids CDK gives a construct's synthetic default child (the L1 resource it wraps). */
const DEFAULT_CHILD_IDS = new Set(['Resource', 'Default']);

/**
 * Fold each construct's synthetic default child (the leaf L1 resource CDK names
 * "Resource" or "Default") up into its parent, so an L2 like `ItemsTable` shows
 * its CFN type directly instead of nesting a redundant `Resource` leaf. The
 * parent absorbs the child's CFN identity (type, logicalId, templateFile) and
 * the child is dropped. Only a leaf default child carrying a CFN type collapses,
 * so resources that nest further children are left intact. Recurses depth-first.
 *
 * Display-only: violation joining still keys off the full (uncollapsed) tree,
 * whose construct paths end in ".../Resource".
 */
export function collapseDefaultChildren(node: ConstructNode): ConstructNode {
  const children = node.children.map(collapseDefaultChildren);
  const defaultChild = children.find(
    (child) => DEFAULT_CHILD_IDS.has(child.id) && child.children.length === 0 && child.type !== undefined,
  );
  if (!defaultChild) {
    return { ...node, children };
  }
  return {
    ...node,
    type: defaultChild.type,
    logicalId: defaultChild.logicalId,
    templateFile: defaultChild.templateFile,
    sourceLocation: node.sourceLocation ?? defaultChild.sourceLocation,
    children: children.filter((child) => child !== defaultChild),
  };
}

/** Relativize a source location to the app dir, dropping any that escape it. */
function toWebSourceLocation(loc: SourceLocation | undefined, appDir: string): WebSourceLocation | undefined {
  if (!loc) return undefined;
  const file = toPosix(path.relative(appDir, loc.file));
  if (file === '..' || file.startsWith('../')) return undefined;
  return { file, line: loc.line, column: loc.column };
}

/**
 * Normalize a policy-validation report into the SPA's flat violation model.
 * Each violating construct is joined to the construct tree (by path) so the
 * panel can navigate to the resource and its source: the resolved
 * `sourceLocation` and `cdk.out`-relative `templateFile` come from the tree
 * node when present, falling back to the report's own resource fields.
 */
export function normalizeViolations(
  report: PolicyValidationReportJson | undefined,
  index: ConstructIndex<ConstructNode>,
  assemblyDir: string,
  appDir: string,
): WebViolation[] {
  return (report?.pluginReports ?? []).flatMap((plugin) =>
    plugin.violations.map((violation) => ({
      ruleName: violation.ruleName,
      description: violation.description,
      severity: violation.severity,
      customSeverity: violation.customSeverity,
      source: plugin.pluginName,
      suggestedFix: violation.suggestedFix,
      occurrences: violation.violatingConstructs.map((vc) => toOccurrence(vc, index, assemblyDir, appDir)),
    })));
}

/** Join one violating construct to its tree node, preferring resolved tree data. */
function toOccurrence(
  vc: ViolatingConstructJson,
  index: ConstructIndex<ConstructNode>,
  assemblyDir: string,
  appDir: string,
): WebViolationOccurrence {
  const node = index.byPath(vc.constructPath);
  const templateFile = node?.templateFile
    ? toPosix(path.relative(assemblyDir, node.templateFile))
    : vc.cloudFormationResource?.templatePath;
  return {
    constructPath: vc.constructPath,
    logicalId: node?.logicalId ?? vc.cloudFormationResource?.logicalId,
    templateFile,
    sourceLocation: toWebSourceLocation(node?.sourceLocation, appDir),
    propertyPaths: vc.cloudFormationResource?.propertyPaths,
  };
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
