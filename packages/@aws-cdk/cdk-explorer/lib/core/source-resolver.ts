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

/**
 * Resolves construct creation stack traces to user source locations, caching
 * parsed source maps across calls. Source-map parsing is not free and one
 * cdk.out tree asks for the same .js.map many times, so create one resolver
 * per assembly read and reuse it for every construct.
 */
export class SourceResolver {
  // Parsed source maps keyed by absolute .js path; null = known to have no map.
  private readonly cache = new Map<string, TraceMap | null>();
  private readonly collectedWarnings: string[] = [];

  /** Non-fatal warnings collected during resolution (e.g. an unparseable .js.map). */
  public get warnings(): readonly string[] {
    return this.collectedWarnings;
  }

  /**
   * Resolve the user source location from a creation stack trace (the frames
   * produced by toolkit-lib's findCreationStackTrace). Returns undefined when
   * there's no trace (non-TS apps) or every frame is a skip-placeholder
   * (framework-only call sites).
   */
  public resolveFrames(frames: readonly string[] | undefined): SourceLocation | undefined {
    if (!frames) return undefined;

    // aws-cdk-lib's renderCallStackJustMyCode (in node_modules/aws-cdk-lib/core/
    // lib/stack-trace.js) pre-filters node_modules/node:internal frames into
    // skip-placeholder lines. Those don't match FRAME_RE, so the first frame
    // that parses IS the user call site.
    for (const frame of frames) {
      const parsed = parseFrame(frame);
      if (parsed) return this.mapJsToOriginalSource(parsed);
    }
    return undefined;
  }

  /**
   * Map a .js location to its original .ts via a sibling .js.map. Returns the
   * input location unchanged when it isn't a .js file or has no usable map.
   */
  private mapJsToOriginalSource(loc: SourceLocation): SourceLocation {
    if (loc.file.endsWith('.ts') || loc.file.endsWith('.tsx') || !loc.file.endsWith('.js')) return loc;

    const tracer = this.loadTraceMap(loc.file);
    if (!tracer) return loc;

    // trace-mapping uses 0-based columns, stack frames are 1-based.
    const orig = originalPositionFor(tracer, { line: loc.line, column: loc.column - 1 });
    if (!orig.source || orig.line == null || orig.column == null) return loc;

    const resolvedFile = path.isAbsolute(orig.source)
      ? orig.source
      : path.resolve(path.dirname(loc.file), orig.source);

    return { file: resolvedFile, line: orig.line, column: orig.column + 1 };
  }

  private loadTraceMap(jsFile: string): TraceMap | null {
    const cached = this.cache.get(jsFile);
    if (cached !== undefined) return cached;

    const mapPath = jsFile + '.map';
    if (!fs.existsSync(mapPath)) {
      this.cache.set(jsFile, null);
      return null;
    }
    try {
      const raw = fs.readFileSync(mapPath, 'utf-8');
      const tm = new TraceMap(JSON.parse(raw));
      this.cache.set(jsFile, tm);
      return tm;
    } catch (err) {
      // Map file exists but is unreadable/invalid. Cache the failure so we
      // don't re-attempt every lookup, and surface it once so a broken map
      // doesn't masquerade as "no source map at all".
      this.cache.set(jsFile, null);
      this.collectedWarnings.push(`Source map ${mapPath} failed to load: ${(err as Error).message}`);
      return null;
    }
  }
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
