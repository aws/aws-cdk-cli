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
   * there's no trace or no frame resolves to an in-root user source file.
   */
  public async resolveFrames(frames: readonly string[] | undefined): Promise<SourceLocation | undefined> {
    if (!frames) return undefined;

    // Scan for the first frame that is a supported source file inside the
    // project. For TypeScript apps aws-cdk-lib's renderCallStackJustMyCode
    // pre-filters framework frames into non-parsing placeholders, so the user
    // .ts is first. For jsii host languages (Python/Java) the trace instead
    // carries real aws-cdk-lib and jsii-kernel .js frames (in a temp dir,
    // outside the root) ahead of the user's .py/.java frame, so we skip past
    // unsupported-or-out-of-root frames rather than stop at the first one.
    for (const frame of frames) {
      const parsed = parseFrame(frame);
      if (!parsed) continue;
      const kind = sourceKind(parsed.file);
      if (!kind) continue;
      // The frame's file path is assembly-derived and attacker-influenceable.
      // Never read or surface a location outside the project.
      if (!(await isWithinRoot(this.projectRoot, parsed.file))) continue;
      return kind === 'host' ? normalizeHostFrame(parsed) : this.mapJsToOriginalSource(parsed);
    }
    return undefined;
  }

  /**
   * Map a .js location to its original .ts via a sibling .js.map. Returns the
   * input location unchanged when it isn't a .js file or has no usable map.
   */
  private async mapJsToOriginalSource(loc: SourceLocation): Promise<SourceLocation> {
    // Input is allow-listed to .ts/.tsx/.js by resolveFrames; .ts/.tsx are
    // already source-space, only .js needs mapping back to its original.
    if (!loc.file.endsWith('.js')) return loc;

    const tracer = await this.loadTraceMap(loc.file);
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
    if (!(await isWithinRoot(this.projectRoot, file))) return loc;
    return { file, line: orig.line, column: orig.column + 1 };
  }

  private async loadTraceMap(jsFile: string): Promise<TraceMap | null> {
    const cached = this.cache.get(jsFile);
    if (cached !== undefined) return cached;

    const tracer = await this.readSourceMap(jsFile);
    this.cache.set(jsFile, tracer);
    return tracer;
  }

  /**
   * Load a .js file's source map. Honors the `//# sourceMappingURL=` directive,
   * so it handles maps inlined as a `data:` URI as well as external maps under
   * any filename (resolved relative to the .js). Returns null when the file has
   * no map; warns when a referenced map exists but can't be read or parsed.
   */
  private async readSourceMap(jsFile: string): Promise<TraceMap | null> {
    let code: string;
    try {
      code = await fs.promises.readFile(jsFile, 'utf-8');
    } catch {
      return null; // .js not present/readable -> treat as "no map"
    }

    try {
      // Inline maps live at the .js; external maps live at the referenced file.
      // The map URL tells trace-mapping where `sources` (and sourceRoot) resolve.
      let mapUrl = pathToFileURL(jsFile).href;
      const converter =
        convertSourceMap.fromSource(code)
        ?? (await convertSourceMap.fromMapFileSource(code, async (mapFile) => {
          const mapPath = path.resolve(path.dirname(jsFile), mapFile);
          // sourceMappingURL is assembly-derived; don't read a map outside the
          // project. The throw is caught below and surfaced as a load warning.
          if (!(await isWithinRoot(this.projectRoot, mapPath))) {
            throw new Error(`source map path escapes the project root: ${mapPath}`);
          }
          mapUrl = pathToFileURL(mapPath).href;
          return fs.promises.readFile(mapPath, 'utf-8');
        }));
      return converter ? new TraceMap(converter.toObject(), mapUrl) : null;
    } catch (err) {
      // A map was referenced but couldn't be read/parsed. Surface it once
      // rather than letting a broken map masquerade as "no source map".
      this.collectedWarnings.push(`Source map for ${jsFile} failed to load: ${(err as Error).message}`);
      return null;
    }
  }
}
// TypeScript/JavaScript frames go through source-map resolution (.js -> .ts).
const TS_JS_EXTENSIONS = ['.ts', '.tsx', '.js'] as const;
// jsii host-language frames (Python/Java) already point at user source; they
// need no source map, only column normalization. .go/.cs are deferred until
// their jsii runtimes send host stack traces over the wire.
const HOST_LANGUAGE_EXTENSIONS = ['.py', '.java'] as const;

function sourceKind(file: string): 'tsjs' | 'host' | undefined {
  if (TS_JS_EXTENSIONS.some((ext) => file.endsWith(ext))) return 'tsjs';
  if (HOST_LANGUAGE_EXTENSIONS.some((ext) => file.endsWith(ext))) return 'host';
  return undefined;
}

// jsii host frames are already source-space, but their columns are 0-indexed
// (and 0 when unavailable, e.g. Python). SourceLocation is 1-based, so shift;
// 0 -> 1 lands at the start of the line, the safe default.
function normalizeHostFrame(loc: SourceLocation): SourceLocation {
  return { file: loc.file, line: loc.line, column: loc.column + 1 };
}

// V8 frames are "<name> (<file>:<line>:<col>)". jsii host-language frames
// (aws-cdk-lib's formatExternalFrame) omit the column when it's unavailable
// (the common Python/Java case), emitting "<name> (<file>:<line>)", so the
// column group is optional. Anchoring on "(" avoids capturing a leading "at ".
const FRAME_RE = /\(([^()\s][^()]*?):(\d+)(?::(\d+))?\)\s*$/;

function parseFrame(frame: string): SourceLocation | undefined {
  const m = FRAME_RE.exec(frame);
  if (!m) return undefined;
  const line = Number(m[2]);
  // Host frames may omit the column; treat absent as 0 (unavailable).
  const column = m[3] !== undefined ? Number(m[3]) : 0;
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
export async function isWithinRoot(root: string, candidate: string): Promise<boolean> {
  const realRoot = await realOrSelf(path.resolve(root));
  const realCandidate = await realOrSelf(path.resolve(candidate));
  return realCandidate === realRoot || realCandidate.startsWith(realRoot + path.sep);
}

/** Real path with symlinks resolved, or the resolved input if it does not exist. */
async function realOrSelf(p: string): Promise<string> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return p;
  }
}
