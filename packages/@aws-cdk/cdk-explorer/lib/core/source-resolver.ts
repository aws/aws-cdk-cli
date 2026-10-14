import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import * as convertSourceMap from 'convert-source-map';
import { type RelativePath, type AssemblyIndexWithSourceLocations, type SourceLocation } from './assembly-index-with-source-locations';
import { pathToFileURL } from './safe-url';

/**
 * Resolves construct creation stack traces to user source locations, caching
 * parsed source maps across calls. Source-map parsing is not free and one
 * cdk.out tree asks for the same .js.map many times, so create one resolver
 * per assembly read and reuse it for every construct.
 */
export class SourceMapResolver {
  // Parsed source maps keyed by absolute .js path; null = known to have no map.
  private readonly cache = new Map<string, TraceMap | undefined>();
  private readonly collectedWarnings: string[] = [];

  /**
   * @param projectRoot - Absolute path to the project the assembly belongs to.
   *   Every file this resolver reads or returns must stay within it. The paths
   *   driving those reads come from the cloud assembly (stack-trace frames and
   *   the source maps they point at), which are attacker-influenceable if
   *   cdk.out is tampered with, so anything escaping the root is dropped
   */
  constructor(private readonly index: AssemblyIndexWithSourceLocations) {
  }

  /** Non-fatal warnings collected during resolution (e.g. an unparseable .js.map). */
  public get warnings(): readonly string[] {
    return this.collectedWarnings;
  }

  /**
   * Map a .js location to its original .ts via a sibling .js.map. Returns the
   * input location unchanged when it isn't a .js file or has no usable map.
   */
  public async reverseMapJs(loc: SourceLocation): Promise<SourceLocation> {
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
    const origFile = orig.source.startsWith('file://') ? fileURLToPath(orig.source) : orig.source;

    return {
      file: this.index.appDir.relative(origFile),
      line: orig.line,
      column: orig.column + 1,
    };
  }

  private async loadTraceMap(jsFile: RelativePath): Promise<TraceMap | undefined> {
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
  private async readSourceMap(jsFile: RelativePath): Promise<TraceMap | undefined> {
    const fullSourceFilePath = this.index.appDir.absolute(jsFile);

    let code: string;
    try {
      code = await fs.readFile(fullSourceFilePath, 'utf-8');
    } catch {
      return undefined; // .js not present/readable -> treat as "no map"
    }

    try {
      // Inline maps live at the .js; external maps live at the referenced file.
      // The map URL tells trace-mapping where `sources` (and sourceRoot) resolve.
      let mapUrl = pathToFileURL(fullSourceFilePath).href;
      let converter = convertSourceMap.fromSource(code);

      if (!converter) {
        converter = await convertSourceMap.fromMapFileSource(code, async (mapFile) => {
          const mapPath = path.resolve(path.dirname(fullSourceFilePath), mapFile);
          // sourceMappingURL is assembly-derived; don't read a map outside the
          // project. The throw is caught below and surfaced as a load warning.
          if (!(await this.index.appDir.contains(mapPath))) {
            throw new Error(`source map path escapes the project root: ${mapPath}`);
          }
          mapUrl = pathToFileURL(mapPath).href;
          return fs.readFile(mapPath, 'utf-8');
        });
      }

      return converter ? new TraceMap(converter.toObject(), mapUrl) : undefined;
    } catch (err) {
      // A map was referenced but couldn't be read/parsed. Surface it once
      // rather than letting a broken map masquerade as "no source map".
      this.collectedWarnings.push(`Source map for ${jsFile} failed to load: ${(err as Error).message}`);
      return undefined;
    }
  }
}
