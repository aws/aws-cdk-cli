import type { Stats } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { AssemblyIndexNode } from '@aws-cdk/cloud-assembly-api';
import { MANIFEST_FILE } from '@aws-cdk/cloud-assembly-api';
import type { PluginReportJson, ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
import type { Toolkit } from '@aws-cdk/toolkit-lib';
import { isSensitiveRead, isTemplatePath, resolveWithinRoot } from './safe-path';
import { StalenessTracker } from './staleness';
import { AssemblyIndexWithSourceLocations } from '../core/assembly-index-with-source-locations';
import { webAssemblyDataFromAssembly, type AssemblyData, type AssemblyReadResult } from '../core/assembly-reader';
import { readAssemblyDirectory } from '../core/read-cdk-assembly';
import { resolveAllResourceRanges } from '../core/template-ranges';
import type { Handler, Response, Router } from '../expressy';
import { createRouter } from '../expressy';
import { ENTIRE_TEMPLATE_LOGICALID_MARKER, type LineRange, type TemplateResource, type TemplateResponse, type TreeResponse, type ViolationsResponse, type WebConstructNode, type WebSourceLocation, type WebViolation, type WebViolationOccurrence } from '../web-shared/protocol';
import { classifyReportSeverity, displaySeverity, violationComparator, severityRank } from '../web-shared/severity';

/** Largest file the viewer returns inline, to avoid buffering huge artifacts into memory and the response. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface ApiOptions {
  /** Root of the CDK app; all file listing/reading is confined to this directory. */
  readonly appDir: string;
  /**
   * Cloud assembly directory the construct tree and violations are read from.
   * Defaults to `<appDir>/cdk.out`.
   */
  readonly assemblyDir: string;

  readonly toolkit: Toolkit;

  /**
   * Tracks source-file staleness against synth timing; `/api/file` reads it to
   * stamp each response. Injected by the server, which owns the reference: the
   * assembly watcher advances it once per generation and feeds it synth-start
   * activity. Defaults to a private tracker (never stale) for a standalone
   * router with no watcher driving it.
   */
  readonly staleness?: StalenessTracker;

  readonly requestLogger?: RequestLogger;

  readonly abort: AbortSignal;
}

export interface CreateApiRouterResult {
  router: Router;

  /**
   * Start loading the assembly immediately.
   *
   * We know the user is going to want to load this regardless, and if we start early
   * chances are the assembly will be ready by the time the first request comes in and
   * there is no wait.
   */
  preloadAssembly: () => Promise<void>;
}

export function createApiRouter(options: ApiOptions): CreateApiRouterResult {
  const staleness = options.staleness ?? new StalenessTracker();
  let cachedAssembly: AssemblyReadResult | undefined;

  /** mtime of the assembly's manifest, or undefined when no assembly exists yet. */
  async function manifestMtimeMs(): Promise<number | undefined> {
    try {
      return (await fs.stat(path.join(options.assemblyDir, MANIFEST_FILE))).mtimeMs;
    } catch {
      return undefined;
    }
  }

  /**
   * Read the cloud assembly, memoized on the manifest's mtime. A request whose
   * manifest is unchanged since the last successful read is served from cache
   * without touching the lock.
   *
   * This function can be called multiple times while the assembly is still
   * loading (which may take multiple seconds). When that happens, it will
   * return the same promise, ensuring that no unnecessary reads are started.
   */
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const getCachedAssembly = reuseRunningPromise(async function getCachedAssembly(): Promise<AssemblyReadResult> {
    try {
      const mtimeMs = await manifestMtimeMs();
      if (mtimeMs === undefined) return { status: 'not-found' };
      if (cachedAssembly?.status === 'success' && cachedAssembly.mtimeMs === mtimeMs) return cachedAssembly;

      await using asm = await readAssemblyDirectory(options.toolkit, options.abort, options.assemblyDir);

      cachedAssembly = {
        status: 'success',
        data: await webAssemblyDataFromAssembly(options.appDir, asm),
        mtimeMs,
      };
      return cachedAssembly;
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return {
          status: 'not-found',
        };
      } else {
        return {
          status: 'error',
          message: e.message ?? String(e),
        };
      }
    }
  });

  const router = createRouter();

  if (options.requestLogger) {
    router.get('*', requestLoggingMiddleware(options.requestLogger));
  }

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/info', async (_req, res) => {
    const appDir = await canonicalDir(options.appDir);
    res.json({ appDir });
  });

  router.get('/file', async (req, res) => {
    const appDir = await canonicalDir(options.appDir);
    const requested = typeof req.query.path === 'string' ? req.query.path : '';
    if (!requested) {
      return res.status(400).json({ error: 'path query parameter is required' });
    }
    const resolved = resolveWithinRoot(appDir, requested);
    if (!resolved) {
      return res.status(403).json({ error: 'path escapes application directory' });
    }
    // The app dir is the whole project tree, so containment is not enough: refuse
    // the files under it that hold secrets rather than app source.
    if (isSensitiveRead(resolved)) {
      return res.status(403).json({ error: 'path is not readable by the explorer' });
    }
    let stat: Stats;
    try {
      stat = await fs.stat(resolved.absolutePath);
    } catch {
      return res.status(404).json({ error: 'file not found' });
    }
    if (!stat.isFile()) {
      return res.status(400).json({ error: 'not a file' });
    }
    if (stat.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: `file exceeds ${MAX_FILE_BYTES} byte limit` });
    }
    const buffer = await fs.readFile(resolved.absolutePath);
    if (isBinary(buffer)) {
      return res.status(415).json({ error: 'binary file cannot be displayed' });
    }
    return res.json({
      path: toPosix(resolved.relativePath),
      content: buffer.toString('utf-8'),
      stale: staleness.isStale(stat.mtimeMs),
    });
  });

  router.get('/tree', async (_req, res) => {
    const appDir = await canonicalDir(options.appDir);
    withAssembly(await getCachedAssembly(), res, (data) => {
      const severityByPath = highestSeverityByPath(data.violations);
      const tree = data.index.assemblyIndex.firstLevelChildren.map(
        (node) => toWebNode(data.index, node, severityByPath, options.assemblyDir, appDir),
      );
      const body: TreeResponse = { status: 'ok', tree, warnings: data.warnings, timestamp: data.timestamp };
      res.json(body);
    });
  });

  router.get('/policy-validation', async (_req, res) => {
    withAssembly(await getCachedAssembly(), res, (data) => {
      const violations = normalizeViolations(data.violations, data.index);
      const body: ViolationsResponse = { status: 'ok', violations };
      res.json(body);
    });
  });

  router.get('/template', async (req, res) => {
    const file = typeof req.query.file === 'string' ? req.query.file : '';
    if (!file) {
      return res.status(400).json({ error: 'file query parameter is required' });
    }
    const resolved = resolveWithinRoot(options.assemblyDir, file);
    if (!resolved) {
      return res.status(403).json({ error: 'path escapes assembly directory' });
    }
    // The assembly dir also holds staged assets, so serve only what this endpoint
    // exists to render, and apply the same secret-file policy as /api/file.
    if (!isTemplatePath(resolved.absolutePath) || isSensitiveRead(resolved)) {
      return res.status(403).json({ error: 'path is not a readable template' });
    }
    let content: string;
    try {
      const stat = await fs.stat(resolved.absolutePath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'not a file' });
      }
      if (stat.size > MAX_FILE_BYTES) {
        return res.status(413).json({ error: `file exceeds ${MAX_FILE_BYTES} byte limit` });
      }
      content = await fs.readFile(resolved.absolutePath, 'utf-8');
    } catch {
      return res.status(404).json({ error: 'template not found' });
    }

    const result = await getCachedAssembly();
    // On a cache hit the manifest is unchanged, so the on-disk template read
    // above is the same generation as this index; on a miss the index was just
    // re-read past the synth that changed it.
    const index = result.status === 'success' ? result.data.index : AssemblyIndexWithSourceLocations.empty();
    const resources = buildTemplateResources(content, file, index, options.assemblyDir);
    const body: TemplateResponse = { content, resources };
    return res.json(body);
  });

  return {
    router,
    preloadAssembly: async () => {
      try {
        await getCachedAssembly();
      } catch (e) {
        options.requestLogger?.(`Failed to preload assembly: ${e}`);
      }
    },
  };
}

/**
 * Read the cloud assembly and send the shared not-synthesized / error responses,
 * invoking `onReady` with the assembly data only on success.
 */
function withAssembly(
  result: AssemblyReadResult | { status: 'locked' },
  res: Response,
  onReady: (data: AssemblyData) => void,
): void {
  if (result.status === 'locked') {
    res.status(503).json({ error: 'synth in progress, please retry' });
    return;
  }
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
  index: AssemblyIndexWithSourceLocations,
  node: AssemblyIndexNode,
  severityByPath: ReadonlyMap<string, string>,
  assemblyDir: string,
  appDir: string,
): WebConstructNode {
  const children = Object.values(node.children).map((child) => toWebNode(index, child, severityByPath, assemblyDir, appDir));
  const ownSeverity = severityByPath.get(node.constructPath);
  const defaultChild = children.find(
    (child) => DEFAULT_CHILD_IDS.has(child.id) && child.children.length === 0 && child.type !== undefined,
  );
  if (!defaultChild) {
    const highestSeverity = ownSeverity;
    const inheritedSeverity = highestSeverity ? undefined : worstChildSeverity(children);

    const sourceLocation = index.sourceLocationFor(node);
    return {
      path: node.constructPath,
      id: node.id,
      type: node.cfnResource.type,
      templateLocation: node.cfnResource.assemblyRelativeTemplateFile && node.cfnResource.logicalId ? {
        file: node.cfnResource.assemblyRelativeTemplateFile,
        logicalId: node.cfnResource.logicalId,
      } : undefined,
      sourceLocation,
      highestSeverity,
      ...(inheritedSeverity && { inheritedSeverity }),
      children,
      constructFqn: node.constructInfo?.fqn,
    };
  }
  const highestSeverity = moreSevere(ownSeverity, defaultChild.highestSeverity);
  const remainingChildren = children.filter((child) => child !== defaultChild);
  const inheritedSeverity = highestSeverity ? undefined : worstChildSeverity(remainingChildren);
  return {
    path: node.constructPath,
    id: node.id,
    type: defaultChild.type,
    templateLocation: defaultChild.templateLocation,
    sourceLocation: index.sourceLocationFor(node) ?? defaultChild.sourceLocation,
    highestSeverity,
    ...(inheritedSeverity && { inheritedSeverity }),
    children: remainingChildren,
    constructFqn: node.constructInfo?.fqn,
  };
}

/** Build a construct-path to highest-severity-label map from a (raw) validation report. */
function highestSeverityByPath(reports: PluginReportJson[] | undefined): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const plugin of reports ?? []) {
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

/**
 * Normalize a policy-validation report into the SPA's flat violation model.
 * Each violating construct is joined to the construct tree (by path): the
 * resolved `sourceLocation` and `cdk.out`-relative `templateFile` come from the
 * tree node when present, falling back to the report's own resource fields.
 * These carry the data a future navigation feature would link from.
 */
export function normalizeViolations(
  reports: PluginReportJson[] | undefined,
  index: AssemblyIndexWithSourceLocations,
): WebViolation[] {
  return (reports ?? [])
    .flatMap((plugin) => (plugin.violations ?? [])
      .map((violation) => ({
        ruleName: violation.ruleName,
        description: violation.description,
        ...classifyReportSeverity(violation.severity, violation.customSeverity),
        source: plugin.pluginName,
        suggestedFix: violation.suggestedFix,
        occurrences: (violation.violatingConstructs ?? []).map((vc) => toOccurrence(vc, index)),
      })))
    .sort(violationComparator)
    .reduce(pushOrMerge, []);
}

/** Join one violating construct to its tree node, preferring resolved tree data. */
function toOccurrence(
  vc: ViolatingConstructJson,
  index: AssemblyIndexWithSourceLocations,
): WebViolationOccurrence {
  const traced = index.traceViolation(vc);

  return {
    constructPath: vc.constructPath,
    logicalId: traced?.cfnResource?.logicalId,
    templateFile: traced?.cfnResource?.templatePath,
    sourceLocations: traced?.sourceLocations,
    propertyPaths: vc.cloudFormationResource?.propertyPaths,
  };
}

/**
 * Combine violations from different reports that are otherwise the same
 */
function pushOrMerge(
  violations: WebViolation[],
  next: WebViolation,
): WebViolation[] {
  if (violations.length > 0) {
    const last = violations[violations.length - 1];
    if (last.ruleName === next.ruleName
      && last.description === next.description
      && last.severity === next.severity
      && last.suggestedFix === next.suggestedFix
      && last.source === next.source
    ) {
      mutable(last.occurrences).push(...next.occurrences);
      return violations;
    }
  }

  violations.push(next);
  return violations;
}

/**
 * Build the resource metadata map for a template file. Each resource gets its
 * block line range and the source location of the construct that owns it.
 */
function buildTemplateResources(
  content: string,
  templateFile: string,
  index: AssemblyIndexWithSourceLocations,
  _assemblyDir: string,
): Record<string, TemplateResource> {
  const allRanges = resolveAllResourceRanges(content);
  if (!allRanges) return {};

  const lineOffsets = computeLineOffsets(content);
  const resources: Record<string, TemplateResource> = {};

  resources[ENTIRE_TEMPLATE_LOGICALID_MARKER] = { block: { startLine: 1, endLine: content.split('\n').length } };

  for (const [logicalId, ranges] of Object.entries(allRanges)) {
    const block = offsetRangeToLineRange(ranges.block, lineOffsets);

    let source: WebSourceLocation | undefined;
    if (index) {
      const owner = index.assemblyIndex.byTemplateLocation(templateFile, logicalId);
      if (owner) {
        source = index.sourceLocationFor(owner);
      }
    }

    resources[logicalId] = { block, ...(source && { source }) };
  }
  return resources;
}

/**
 * Compute 0-based byte offsets for the start of each line. Line 1 starts at
 * offset 0. Used for fast offset-to-line conversion.
 */
function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/** Convert a character offset to a 1-based line number using precomputed line offsets. */
function offsetToLine(offset: number, lineOffsets: number[]): number {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (lineOffsets[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo + 1;
}

/** Convert an OffsetRange to a 1-based inclusive LineRange. */
function offsetRangeToLineRange(range: { start: number; end: number }, lineOffsets: number[]): LineRange {
  return {
    startLine: offsetToLine(range.start, lineOffsets),
    endLine: offsetToLine(Math.max(range.start, range.end - 1), lineOffsets),
  };
}

/** Normalize OS separators to '/' so the API contract is stable across platforms. */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Canonical app root: realpath so relative paths match resolveWithinRoot's realpathed output. */
async function canonicalDir(dir: string): Promise<string> {
  return fs.realpath(path.resolve(dir));
}

/** A NUL byte in the first chunk reliably indicates non-text content. */
function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

export type RequestLogger = (message: string) => void;

function requestLoggingMiddleware(handler: RequestLogger): Handler {
  return (req, res, next) => {
    handler(`${req.method} ${req.path}... `);
    const startTime = Date.now();

    let statusCode: number = 200;
    const originalStatus = res.status.bind(res);
    res.status = function (code: number) {
      statusCode = code;
      return originalStatus(code);
    };

    res.on('finish', () => {
      const delta = Date.now() - startTime;
      handler(`${req.method} ${req.path} - ${statusCode} (${delta}ms)`);
    });
    return next();
  };
}

function reuseRunningPromise<A extends (...args: any[]) => Promise<any>>(fn: A): A {
  let runningPromise: Promise<ReturnType<A>> | undefined;
  return ((...args: any[]) => {
    if (!runningPromise) {
      runningPromise = fn(...args).finally(() => {
        runningPromise = undefined;
      });
    }
    return runningPromise;
  }) as any;
}

function mutable<A extends object>(x: A): { -readonly [k in keyof A]: A[k] } {
  return x;
}
