import { DEFAULT_USER_CODE_FINDER, StackTrace, type AssemblyIndex, type AssemblyIndexNode } from '@aws-cdk/cloud-assembly-api';
import type { ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
import type { SourceLocation } from './source-resolver';

export type AssemblyIndexNodeLike = AssemblyIndexNode | AssemblyResourceNode;

/**
 * Holds an AssemblyIndex, and translates stack traces into source locations
 */
export class AssemblyIndexWithSourceLocations {
  private readonly sourceLocationCache = new Map<AssemblyIndexNode, SourceLocation | undefined>();
  private readonly stackLocationFinder = DEFAULT_USER_CODE_FINDER;
  private readonly nodesBySourceFile: Record<string, Map<number, AssemblyIndexNode[]>> = {};

  constructor(
    public readonly assemblyIndex: AssemblyIndex,
  ) {
    this.indexAssembly();
  }

  public constructsInSourceFile(file: string): Array<[number, AssemblyIndexNode]> {
    return Array.from(this.nodesBySourceFile[file]?.entries() ?? [])
      .flatMap(([line, nodes]) => nodes.map(node => [line, node] as [number, AssemblyIndexNode]));
  }

  public constructsOnLine(file: string, line: number): AssemblyIndexNode[] {
    return this.nodesBySourceFile[file]?.get(line) ?? [];
  }

  public byTemplateLocation(templateFile: string, logicalId: string) {
    return this.assemblyIndex.byTemplateLocation(templateFile, logicalId);
  }

  /**
   * Parse the creation stack to a source location, cached on the object.
   */
  public sourceLocationFor(node: AssemblyIndexNode): SourceLocation | undefined {
    if (!node.creationStack) return undefined;
    if (this.sourceLocationCache.has(node)) {
      return this.sourceLocationCache.get(node);
    }

    const stack = new StackTrace(node.creationStack);
    const frame = stack.findAndParse(this.stackLocationFinder);

    let result: SourceLocation | undefined;
    if (frame?.fileName) {
      const lineLoc = frame?.lineLocation;
      result = {
        file: frame.fileName,
        line: lineLoc?.line ?? 0,
        column: lineLoc?.column ?? 0,
      };
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
        file: frame.fileName,
        line: frame.lineLocation?.line ?? 0,
        column: frame.lineLocation?.column ?? 0,
      } satisfies SourceLocation;
    });

    const creationLocation = traced.node && this.sourceLocationFor(traced.node);
    return {
      violation: traced.violation,
      cfnResource: traced.cfnResource,
      node: traced.node,
      sourceLocations: sourceLocations.length > 0 ? sourceLocations : (creationLocation ? [creationLocation] : []),

    };
  }

  private indexAssembly() {
    recurse.call(this, this.assemblyIndex.root);

    function recurse(this: AssemblyIndexWithSourceLocations, node: AssemblyIndexNode) {
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
    }
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
  readonly assemblyRelativeTemplateFile: string;

  readonly cfnProperties?: Record<string, unknown>;
}

export interface AssemblyIndexViolationWithSource {
  readonly violation: ViolatingConstructJson;
  readonly node?: AssemblyIndexNode;
  readonly cfnResource?: ViolatingConstructJson['cloudFormationResource'];
  readonly sourceLocations: SourceLocation[];
}
