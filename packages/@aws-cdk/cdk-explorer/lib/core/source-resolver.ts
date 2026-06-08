import * as fs from 'fs';
import * as path from 'path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

/**
 * Resolved source location for a construct, in user-space coordinates.
 * Always 1-based line and column. Resolves to .ts when a sibling source
 * map exists; otherwise to the .js (or whatever the trace produced).
 */
export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** Optional warning sink for non-fatal issues (e.g. unparseable .js.map). */
export type WarnFn = (message: string) => void;

/**
 * Cache of parsed source maps keyed by absolute .js file path. Source-map
 * parsing is not free, and one cdk.out tree can ask for the same .js.map
 * dozens of times. Callers create one cache per assembly read and pass it
 * to every resolveSourceLocation call so the work amortises.
 */
export type SourceMapCache = Map<string, TraceMap | null>;

export function createSourceMapCache(): SourceMapCache {
  return new Map();
}

/**
 * Resolve the user source location from a creation stack trace (the frames
 * produced by toolkit-lib's findCreationStackTrace). Returns undefined when
 * there's no trace (non-TS apps) or every frame is a skip-placeholder
 * (framework-only call sites).
 */
export function resolveFramesToLocation(
  frames: readonly string[] | undefined,
  cache: SourceMapCache,
  onWarn?: WarnFn,
): SourceLocation | undefined {
  if (!frames) return undefined;

  // aws-cdk-lib's renderCallStackJustMyCode (in node_modules/aws-cdk-lib/core/
  // lib/stack-trace.js) pre-filters node_modules/node:internal frames into
  // skip-placeholder lines. Those don't match FRAME_RE, so the first frame
  // that parses IS the user call site.
  for (const frame of frames) {
    const parsed = parseFrame(frame);
    if (parsed) return mapJsToOriginalSource(parsed, cache, onWarn) ?? parsed;
  }
  return undefined;
}

// renderCallStackJustMyCode emits frames as "    at <name> (<file>:<line>:<col>)".
// Anchoring on "(" avoids capturing the leading "at " into the file group.
const FRAME_RE = /\(([^()\s][^()]*?):(\d+):(\d+)\)\s*$/;

function parseFrame(frame: string): SourceLocation | undefined {
  const m = FRAME_RE.exec(frame);
  if (!m) return undefined;
  const line = Number(m[2]);
  const column = Number(m[3]);
  if (!Number.isFinite(line) || !Number.isFinite(column)) return undefined;
  return { file: m[1], line, column };
}

/**
 * Map a .js location to its original .ts via a sibling .js.map. Returns
 * undefined when there's no map; the caller falls back to the .js location.
 */
function mapJsToOriginalSource(
  loc: SourceLocation,
  cache: SourceMapCache,
  onWarn?: WarnFn,
): SourceLocation | undefined {
  if (loc.file.endsWith('.ts') || loc.file.endsWith('.tsx')) return loc;
  if (!loc.file.endsWith('.js')) return undefined;

  const tracer = loadTraceMap(loc.file, cache, onWarn);
  if (!tracer) return undefined;

  // trace-mapping uses 0-based columns, stack frames are 1-based.
  const orig = originalPositionFor(tracer, { line: loc.line, column: loc.column - 1 });
  if (!orig.source || orig.line == null || orig.column == null) return undefined;

  const resolvedFile = path.isAbsolute(orig.source)
    ? orig.source
    : path.resolve(path.dirname(loc.file), orig.source);

  return { file: resolvedFile, line: orig.line, column: orig.column + 1 };
}

function loadTraceMap(jsFile: string, cache: SourceMapCache, onWarn?: WarnFn): TraceMap | null {
  const cached = cache.get(jsFile);
  if (cached !== undefined) return cached;

  const mapPath = jsFile + '.map';
  if (!fs.existsSync(mapPath)) {
    cache.set(jsFile, null);
    return null;
  }
  try {
    const raw = fs.readFileSync(mapPath, 'utf-8');
    const tm = new TraceMap(JSON.parse(raw));
    cache.set(jsFile, tm);
    return tm;
  } catch (err) {
    // Map file exists but is unreadable/invalid. Cache the failure so we
    // don't re-attempt every lookup, and surface it once so a broken map
    // doesn't masquerade as "no source map at all".
    cache.set(jsFile, null);
    onWarn?.(`Source map ${mapPath} failed to load: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
