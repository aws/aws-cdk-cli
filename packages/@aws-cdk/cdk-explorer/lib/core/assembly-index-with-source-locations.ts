import { promises as fs } from 'fs';
import * as path from 'path';
import { AssemblyIndex, DEFAULT_USER_CODE_FINDER, StackTrace, type AssemblyIndexNode, type ConstructInfo } from '@aws-cdk/cloud-assembly-api';
import type { ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
import { type Branded } from './type-brands';

export type AssemblyIndexNodeLike = AssemblyIndexNode | AssemblyResourceNode;

export interface AssemblyIndexWithSourceLocationsOptions {
  readonly appDir: string;
  readonly assemblyDir: string;
  readonly assemblyIndex: AssemblyIndex;
}

export interface ISourceFileResolver {
  resolve(file: SourceLocation): SourceLocation;
}

/**
 * Holds an AssemblyIndex, and translates stack traces into source locations
 */
export class AssemblyIndexWithSourceLocations {
  public static empty() {
    return new AssemblyIndexWithSourceLocations({
      appDir: '/tmp',
      assemblyDir: '/tmp',
      assemblyIndex: new AssemblyIndex(),
    });
  }

  public static async createAndIndex(options: AssemblyIndexWithSourceLocationsOptions) {
    const ret = new AssemblyIndexWithSourceLocations({
      appDir: await realOrSelf(options.appDir),
      assemblyDir: await realOrSelf(options.assemblyDir),
      assemblyIndex: options.assemblyIndex,
    });
    ret.indexAssembly();
    return ret;
  }

  public static async createUnindexed(options: AssemblyIndexWithSourceLocationsOptions) {
    return new AssemblyIndexWithSourceLocations({
      appDir: await realOrSelf(options.appDir),
      assemblyDir: await realOrSelf(options.assemblyDir),
      assemblyIndex: options.assemblyIndex,
    });
  }

  public readonly assemblyIndex: AssemblyIndex;
  public readonly appDir: PathTranslator;
  public readonly assemblyDir: PathTranslator;

  private sourceResolver?: ISourceFileResolver;
  private readonly sourceLocationCache = new Map<AssemblyIndexNode, SourceLocation | undefined>();
  private readonly stackLocationFinder = DEFAULT_USER_CODE_FINDER;
  private readonly nodesBySourceFile: Record<RelativePath, Map<number, AssemblyIndexNode[]>> = {};

  private constructor(options: AssemblyIndexWithSourceLocationsOptions) {
    this.assemblyIndex = options.assemblyIndex;
    this.appDir = new PathTranslator(options.appDir);
    this.assemblyDir = new PathTranslator(options.assemblyDir);
  }

  public constructsInSourceFile(file: RelativePath): Array<[number, AssemblyIndexNode]> {
    return Array.from(this.nodesBySourceFile[file]?.entries() ?? [])
      .flatMap(([line, nodes]) => nodes.map(node => [line, node] as [number, AssemblyIndexNode]));
  }

  public constructsOnLine(file: RelativePath, line: number): AssemblyIndexNode[] {
    return this.nodesBySourceFile[file]?.get(line) ?? [];
  }

  public byTemplateLocation(templateFile: RelativePath, logicalId: string) {
    return this.assemblyIndex.byTemplateLocation(templateFile, logicalId);
  }

  public setSourceResolver(sourceResolver: ISourceFileResolver | undefined) {
    this.sourceResolver = sourceResolver;
  }

  /**
   * Parse the creation stack to a source location, cached on the object.
   */
  public sourceLocationFor(node: AssemblyIndexNode): SourceLocation | undefined {
    if (!node.creationStack) return undefined;
    if (this.sourceLocationCache.has(node)) {
      return this.sourceLocationCache.get(node);
    }

    let result = this.unmappedSourceLocationFor(node);

    if (result && this.sourceResolver) {
      result = this.sourceResolver.resolve(result);
    }

    this.sourceLocationCache.set(node, result);
    return result;
  }

  public traceViolation(violation: ViolatingConstructJson): AssemblyIndexViolationWithSource {
    const traced = this.assemblyIndex.traceViolation(violation);
    const sourceLocations: SourceLocation[] = (traced.stackTraces ?? []).flatMap((stackTrace) => {
      const frame = new StackTrace(stackTrace).findFirstUserFrame();
      if (!frame) return [];

      return {
        file: this.appDir.relative(frame.fileName),
        line: frame.lineLocation?.line ?? 0,
      } satisfies SourceLocation;
    }).map(loc => this.sourceResolver?.resolve(loc) ?? loc);

    const creationLocation = traced.node && this.sourceLocationFor(traced.node);
    return {
      violation: traced.violation,
      cfnResource: traced.cfnResource ? {
        ...traced.cfnResource,
        templatePath: this.assemblyDir.relative(traced.cfnResource.templatePath),
      } : undefined,
      node: traced.node,
      sourceLocations: sourceLocations.length > 0 ? sourceLocations : (creationLocation ? [creationLocation] : []),
    };
  }

  private unmappedSourceLocationFor(node: AssemblyIndexNode): SourceLocation | undefined {
    if (!node.creationStack) return undefined;
    const stack = new StackTrace(node.creationStack);
    const frame = stack.findAndParse(this.stackLocationFinder);

    let result: SourceLocation | undefined;
    if (frame?.fileName) {
      const lineLoc = frame?.lineLocation;
      result = {
        file: this.appDir.relative(frame.fileName),
        line: lineLoc?.line ?? 0,
      };
    }

    return result;
  }

  /**
   * Find all referenced files in the assembly.
   */
  public allSourceFiles() {
    const sourceFiles = new Set<RelativePath>();

    this.forEveryNode((node) => {
      const sourceLocation = this.unmappedSourceLocationFor(node);
      if (sourceLocation?.file) {
        sourceFiles.add(sourceLocation.file);
      }
    });

    return sourceFiles;
  }

  public indexAssembly() {
    // In case the source locations have changed, clear the cache before re-indexing.
    this.sourceLocationCache.clear();

    this.forEveryNode((node) => {
      const sourceLocation = this.sourceLocationFor(node);
      if (sourceLocation?.file) {
        if (!this.nodesBySourceFile[sourceLocation.file]) {
          this.nodesBySourceFile[sourceLocation.file] = new Map();
        }
        const line = sourceLocation.line;
        if (!this.nodesBySourceFile[sourceLocation.file].has(line)) {
          this.nodesBySourceFile[sourceLocation.file].set(line, []);
        }
        this.nodesBySourceFile[sourceLocation.file].get(line)!.push(node);
      }
    });
  }

  private forEveryNode(callback: (node: AssemblyIndexNode) => void) {
    recurse.call(this, this.assemblyIndex.root);

    function recurse(this: AssemblyIndexWithSourceLocations, node: AssemblyIndexNode) {
      callback(node);
      for (const child of Object.values(node.children ?? {})) {
        recurse.call(this, child);
      }
    }
  }
}

export class PathTranslator {
  constructor(public readonly directory: string) {
  }

  /**
   * Make sure the given path is relative to the root directories (either app or assembly).
   *
   * If it's relative, we assume it's already relative to that directory; if it's
   * absolute we make it relative.
   *
   * In either case, if a path tries to escape the root directory we are going to mangle
   * it to in invalid path that is guaranteed to not escape the given root.
   *
   * Also turn it into a POSIX path always.
   */
  public relative(file: string): RelativePath {
    const absPath = path.isAbsolute(file) ? file : path.join(this.directory, file);
    const relPath = path.relative(this.directory, absPath);
    const parts = relPath.split(path.sep);
    if (parts[0] === '..') {
      return 'ESCAPING' as RelativePath;
    }
    return parts.join(path.posix.sep) as RelativePath;
  }

  public absolute(relPath: RelativePath): AbsolutePath {
    return path.join(this.directory, relPath) as AbsolutePath;
  }

  public async contains(file: string): Promise<boolean> {
    const absPath = await realOrSelf(path.resolve(this.directory, file));
    return absPath === this.directory || absPath.startsWith(this.directory + path.sep);
  }
}

export function isResourceNode(node: AssemblyIndexNodeLike): node is AssemblyResourceNode {
  return !!node.cfnResource && 'logicalId' in node.cfnResource && 'assemblyRelativeTemplateFile' in node.cfnResource && 'type' in node.cfnResource;
}

/**
 * A construct from tree.json joined with the CloudFormation metadata of the
 * stack it belongs to: the construct path/id plus, for CFN resources, the
 * logical ID and resource type. Readers that need more (for example a source
 * location) extend this and build the richer tree via {@link buildConstructTree}.
 */
export interface AssemblyResourceNode {
  readonly constructPath: string;
  readonly id: string;
  readonly cfnResource: DefinitelyCloudFormationResource;
  readonly constructInfo?: ConstructInfo;
}

export interface DefinitelyCloudFormationResource {
  /**
   * CloudFormation resource type.
   */
  readonly type: string;

  /**
   * CFN logical ID
   *
   * Comes from either `tree.json` or metadata.
   *
   * This is usually the logical ID in the `Resources` section of the CloudFormation template,
   * but it may also be in the `Parameters` section or `Conditions` section; we don't have
   * enough information to tell.
   */
  readonly logicalId: string;

  /**
   * Template file.
   *
   * Comes from metadata.
   */
  readonly assemblyRelativeTemplateFile: RelativePath;

  readonly cfnProperties?: Record<string, unknown>;
}

export interface AssemblyIndexViolationWithSource {
  readonly violation: ViolatingConstructJson;
  readonly node?: AssemblyIndexNode;
  readonly cfnResource?: AssemblyIndexCloudFormationResource;
  readonly sourceLocations: SourceLocation[];
}

export interface AssemblyIndexCloudFormationResource {
  /**
   * The path to the CloudFormation template containing this resource.
   *
   * This path is relative to the Cloud Assembly root directory.
   */
  readonly templatePath: RelativePath;

  /**
   * The logical ID of the resource in the CloudFormation template.
   */
  readonly logicalId: string;

  /**
   * Properties within the construct where the violation was detected.
   *
   * Either a single component, in which case it regards a top-level property
   * name, or a JSON path (starting with `$.`) to indicate a deeper property.
   *
   * @default - no locations
   */
  readonly propertyPaths?: string[];
}

export type RelativePath = Branded<string, 'RelativePath'>;
export type AbsolutePath = Branded<string, 'AbsolutePath'>;

export function assertRelativePath(x: string): RelativePath;
export function assertRelativePath(x: string | undefined): RelativePath | undefined;
export function assertRelativePath(x: string | undefined): RelativePath | undefined {
  if (x === undefined) {
    return undefined;
  }
  if (path.isAbsolute(x)) {
    throw new Error(`Expecting a relative path, got ${x}`);
  }
  return x as RelativePath;
}

/**
 * Resolved source location for a construct, in user-space coordinates.
 * Always 1-based line and column. Resolves to .ts when a sibling source
 * map exists; otherwise to the .js (or whatever the trace produced).
 */
export interface SourceLocation {
  readonly file: RelativePath;
  readonly line: number;
}

/** Real path with symlinks resolved, or the resolved input if it does not exist. */
async function realOrSelf(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}
