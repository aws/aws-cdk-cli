import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import * as convertSourceMap from 'convert-source-map';

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
export class SourceMapResolver {
  // Parsed source maps keyed by absolute .js path; null = known to have no map.
  private readonly cache = new Map<string, TraceMap | null>();
  private readonly collectedWarnings: string[] = [];

  /**
   * @param projectRoot - Absolute path to the project the assembly belongs to.
   *   Every file this resolver reads or returns must stay within it. The paths
   *   driving those reads come from the cloud assembly (stack-trace frames and
   *   the source maps they point at), which are attacker-influenceable if
   *   cdk.out is tampered with, so anything escaping the root is dropped
   */
  constructor(private readonly projectRoot: string) {
  }

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
      if (!parsed) continue;
      if (!isSupportedSourceFile(parsed.file)) return undefined;
      // The frame's file path is assembly-derived and attacker-influenceable.
      // Never read or surface a location outside the project.
      if (!isWithinRoot(this.projectRoot, parsed.file)) return undefined;
      return this.mapJsToOriginalSource(parsed);
    }
    return undefined;
  }

  /**
   * Map a .js location to its original .ts via a sibling .js.map. Returns the
   * input location unchanged when it isn't a .js file or has no usable map.
   */
  private mapJsToOriginalSource(loc: SourceLocation): SourceLocation {
    // Input is allow-listed to .ts/.tsx/.js by resolveFrames; .ts/.tsx are
    // already source-space, only .js needs mapping back to its original.
    if (!loc.file.endsWith('.js')) return loc;

    const tracer = this.loadTraceMap(loc.file);
    if (!tracer) return loc;

    // trace-mapping uses 0-based columns, stack frames are 1-based.
    const orig = originalPositionFor(tracer, { line: loc.line, column: loc.column - 1 });
    if (!orig.source || orig.line == null || orig.column == null) return loc;

    // orig.source is already resolved against the map's location (we pass the
    // map URL when building the TraceMap), with any sourceRoot applied — so it's
    // a file:// URL for local maps. Convert it back to a path.
    const file = orig.source.startsWith('file://') ? fileURLToPath(orig.source) : orig.source;
    // `sources` comes from the .js.map, which is also assembly-derived. Keep the
    // mapped original within the project, else fall back to the (in-root) .js.
    if (!isWithinRoot(this.projectRoot, file)) return loc;
    return { file, line: orig.line, column: orig.column + 1 };
  }

  private loadTraceMap(jsFile: string): TraceMap | null {
    const cached = this.cache.get(jsFile);
    if (cached !== undefined) return cached;

    const tracer = this.readSourceMap(jsFile);
    this.cache.set(jsFile, tracer);
    return tracer;
  }

  /**
   * Load a .js file's source map. Honors the `//# sourceMappingURL=` directive,
   * so it handles maps inlined as a `data:` URI as well as external maps under
   * any filename (resolved relative to the .js). Returns null when the file has
   * no map; warns when a referenced map exists but can't be read or parsed.
   */
  private readSourceMap(jsFile: string): TraceMap | null {
    let code: string;
    try {
      code = fs.readFileSync(jsFile, 'utf-8');
    } catch {
      return null; // .js not present/readable -> treat as "no map"
    }

    try {
      // Inline maps live at the .js; external maps live at the referenced file.
      // The map URL tells trace-mapping where `sources` (and sourceRoot) resolve.
      let mapUrl = pathToFileURL(jsFile).href;
      const converter =
        convertSourceMap.fromSource(code)
        ?? convertSourceMap.fromMapFileSource(code, (mapFile) => {
          const mapPath = path.resolve(path.dirname(jsFile), mapFile);
          // sourceMappingURL is assembly-derived; don't read a map outside the
          // project. The throw is caught below and surfaced as a load warning.
          if (!isWithinRoot(this.projectRoot, mapPath)) {
            throw new Error(`source map path escapes the project root: ${mapPath}`);
          }
          mapUrl = pathToFileURL(mapPath).href;
          return fs.readFileSync(mapPath, 'utf-8');
        });
      return converter ? new TraceMap(converter.toObject(), mapUrl) : null;
    } catch (err) {
      // A map was referenced but couldn't be read/parsed. Surface it once
      // rather than letting a broken map masquerade as "no source map".
      this.collectedWarnings.push(`Source map for ${jsFile} failed to load: ${(err as Error).message}`);
      return null;
    }
  }
}
const SUPPORTED_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js'] as const;

function isSupportedSourceFile(file: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext));
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
 * True when `candidate` resolves to a path inside `root` (or is `root` itself).
 * Both are resolved to absolute, symlink-real paths first, so a file reached
 * through a symlinked directory pointing outside `root` is rejected too. Used
 * to keep file reads driven by (attacker-influenceable) cloud-assembly paths
 * within the project before any read happens.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  const realRoot = realOrSelf(path.resolve(root));
  const realCandidate = realOrSelf(path.resolve(candidate));
  return realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep);
}

/** Real path with symlinks resolved, or the resolved input if it does not exist. */
function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}
