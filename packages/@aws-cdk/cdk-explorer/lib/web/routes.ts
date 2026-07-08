import * as fs from 'fs';
import * as path from 'path';
import { ConstructIndex } from '@aws-cdk/cloud-assembly-api';
import type { PolicyValidationReportJson, ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
import { type Router, type Express, type Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import express = require('express');
import type { DirEntry, TreeResponse, ViolationsResponse, WebConstructNode, WebSourceLocation, WebViolation, WebViolationOccurrence } from './protocol';
import { resolveWithinRoot } from './safe-path';
import { classifyReportSeverity, displaySeverity, severityRank } from './severity';
import { readAssembly as defaultReadAssembly, type AssemblyData, type AssemblyReadResult, type ConstructNode } from '../core/assembly-reader';
import type { SourceLocation } from '../core/source-resolver';

/** Largest file the viewer returns inline, to avoid buffering huge artifacts into memory and the response. */
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
  readonly readAssembly?: (assemblyDir: string) => Promise<AssemblyReadResult>;
}

export function createApiRouter(options: ApiOptions): Router {
  const appDir = canonicalDir(options.appDir);
  const assemblyDir = options.assemblyDir ?? path.join(options.appDir, 'cdk.out');
  const readAssembly = options.readAssembly ?? defaultReadAssembly;
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/info', (_req, res) => {
    res.json({ appDir });
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

  router.get('/tree', async (_req, res) => {
    withAssembly(await readAssembly(assemblyDir), res, (data) => {
      const severityByPath = highestSeverityByPath(data.violations);
      const tree = data.tree.map((node) => toWebNode(node, severityByPath, assemblyDir, appDir));
      const body: TreeResponse = { status: 'ok', tree, warnings: data.warnings };
      res.json(body);
    });
  });

  router.get('/policy-validation', async (_req, res) => {
    withAssembly(await readAssembly(assemblyDir), res, (data) => {
      const index = ConstructIndex.fromTree(data.tree);
      const violations = normalizeViolations(data.violations, index, assemblyDir, appDir);
      const body: ViolationsResponse = { status: 'ok', violations };
      res.json(body);
    });
  });

  return router;
}

export function registerApi(app: Express, options: ApiOptions): void {
  app.use('/api', createApiRouter(options));
}

/**
 * Read the cloud assembly and send the shared not-synthesized / error responses,
 * invoking `onReady` with the assembly data only on success.
 */
function withAssembly(
  result: AssemblyReadResult,
  res: Response,
  onReady: (data: AssemblyData) => void,
): void {
  if (result.status === 'not-found') {
    res.json({ status: 'not-synthesized' });
    return;
  }
  if (result.status === 'error') {
    res.status(500).json({ error: result.message });
    return;
  }
  onReady(result.data);
}

/** Ids CDK gives a construct's synthetic default child (the L1 resource it wraps). */
const DEFAULT_CHILD_IDS = new Set(['Resource', 'Default']);

/**
 * Map a core construct node to its wire form, owning every transform the
 * displayed tree needs:
 * - Relativizes paths the client can't resolve (`templateFile` to the cloud
 *   assembly, `sourceLocation.file` to the app dir; a source location outside
 *   the app dir is dropped, since `/api/file` cannot serve it).
 * - Folds a synthetic default child (the leaf L1 resource CDK names "Resource"
 *   or "Default", carrying a CFN type) up into its parent, so an L2 like
 *   `ItemsTable` shows its CFN type directly instead of nesting a redundant
 *   leaf. Only a leaf default child with a type collapses; a resource that
 *   nests further children is left intact.
 * - Annotates each node with the highest severity of any violation on it,
 *   folding an absorbed default child's severity into the parent so the dot
 *   tracks the displayed node. Because the join happens here, the client never
 *   re-derives the collapse rule.
 * Recurses depth-first.
 */
export function toWebNode(
  node: ConstructNode,
  severityByPath: ReadonlyMap<string, string>,
  assemblyDir: string,
  appDir: string,
): WebConstructNode {
  const children = node.children.map((child) => toWebNode(child, severityByPath, assemblyDir, appDir));
  const ownSeverity = severityByPath.get(node.path);
  const defaultChild = children.find(
    (child) => DEFAULT_CHILD_IDS.has(child.id) && child.children.length === 0 && child.type !== undefined,
  );
  if (!defaultChild) {
    const highestSeverity = ownSeverity;
    const inheritedSeverity = highestSeverity ? undefined : worstChildSeverity(children);
    return {
      path: node.path,
      id: node.id,
      type: node.type,
      logicalId: node.logicalId,
      templateFile: node.templateFile ? toPosix(path.relative(assemblyDir, node.templateFile)) : undefined,
      sourceLocation: toWebSourceLocation(node.sourceLocation, appDir),
      highestSeverity,
      ...(inheritedSeverity && { inheritedSeverity }),
      children,
    };
  }
  const highestSeverity = moreSevere(ownSeverity, defaultChild.highestSeverity);
  const remainingChildren = children.filter((child) => child !== defaultChild);
  const inheritedSeverity = highestSeverity ? undefined : worstChildSeverity(remainingChildren);
  return {
    path: node.path,
    id: node.id,
    type: defaultChild.type,
    logicalId: defaultChild.logicalId,
    templateFile: defaultChild.templateFile,
    sourceLocation: toWebSourceLocation(node.sourceLocation, appDir) ?? defaultChild.sourceLocation,
    highestSeverity,
    ...(inheritedSeverity && { inheritedSeverity }),
    children: remainingChildren,
  };
}

/** Build a construct-path to highest-severity-label map from a (raw) validation report. */
function highestSeverityByPath(report: PolicyValidationReportJson | undefined): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const plugin of report?.pluginReports ?? []) {
    for (const violation of plugin.violations ?? []) {
      const label = displaySeverity(classifyReportSeverity(violation.severity, violation.customSeverity));
      for (const vc of violation.violatingConstructs ?? []) {
        const existing = byPath.get(vc.constructPath);
        if (existing === undefined || severityRank(label) < severityRank(existing)) {
          byPath.set(vc.constructPath, label);
        }
      }
    }
  }
  return byPath;
}

/** The more severe of two severity labels (lower rank = more severe); undefined loses to any defined label. */
function moreSevere(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return severityRank(a) <= severityRank(b) ? a : b;
}

/** The worst severity across all children (direct or inherited). */
function worstChildSeverity(children: readonly WebConstructNode[]): string | undefined {
  let worst: string | undefined;
  for (const child of children) {
    worst = moreSevere(worst, child.highestSeverity ?? child.inheritedSeverity);
  }
  return worst;
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
 * Each violating construct is joined to the construct tree (by path): the
 * resolved `sourceLocation` and `cdk.out`-relative `templateFile` come from the
 * tree node when present, falling back to the report's own resource fields.
 * These carry the data a future navigation feature would link from.
 */
export function normalizeViolations(
  report: PolicyValidationReportJson | undefined,
  index: ConstructIndex<ConstructNode>,
  assemblyDir: string,
  appDir: string,
): WebViolation[] {
  return (report?.pluginReports ?? []).flatMap((plugin) =>
    (plugin.violations ?? []).map((violation) => ({
      ruleName: violation.ruleName,
      description: violation.description,
      ...classifyReportSeverity(violation.severity, violation.customSeverity),
      source: plugin.pluginName,
      suggestedFix: violation.suggestedFix,
      occurrences: (violation.violatingConstructs ?? []).map((vc) => toOccurrence(vc, index, assemblyDir, appDir)),
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
