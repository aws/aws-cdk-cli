import * as fs from 'fs';
import * as path from 'path';
import { ArtifactMetadataEntryType, CFN_RESOURCE_TYPE_ATTRIBUTE, type MetadataEntry } from '@aws-cdk/cloud-assembly-schema';
import type { CloudFormationStackArtifact } from './artifacts/cloudformation-artifact';
import type { CloudAssembly } from './cloud-assembly';

/** Construct ids that aws-cdk-lib injects into the tree but aren't user constructs. */
const CDK_INTERNAL_IDS = new Set(['Tree', 'CDKMetadata', 'BootstrapVersion', 'CheckBootstrapVersion']);

/**
 * A construct from tree.json joined with the CloudFormation metadata of the
 * stack it belongs to: the construct path/id plus, for CFN resources, the
 * logical ID and resource type. Readers that need more (for example a source
 * location) extend this and build the richer tree via {@link buildConstructTree}.
 */
export interface ConstructTreeNode {
  readonly path: string;
  readonly id: string;
  /** CFN resource type (e.g. "AWS::S3::Bucket"), if this construct is a CFN resource. */
  readonly type?: string;
  /** CFN logical ID, if this construct maps to a CFN resource. */
  readonly logicalId?: string;
  readonly children: readonly ConstructTreeNode[];
}

/**
 * The generic fields {@link buildConstructTree} computes for each node before a
 * consumer decorates it. `children` are already the decorated node type.
 */
export interface ConstructTreeNodeFields<T extends ConstructTreeNode> {
  readonly path: string;
  readonly id: string;
  readonly type?: string;
  readonly logicalId?: string;
  readonly children: readonly T[];
}

/**
 * Produces a node of type `T` from the generic fields, the owning stack
 * artifact (if any), and the construct path. Readers use the stack + path to
 * attach extra data (for example a source location traced from the stack).
 */
export type ConstructNodeDecorator<T extends ConstructTreeNode> = (
  fields: ConstructTreeNodeFields<T>,
  stack: CloudFormationStackArtifact | undefined,
  constructPath: string,
) => T;

/**
 * A pre-built index over a construct tree. Walks the tree once and exposes
 * O(1) path lookup plus pre-order iteration over every node, so callers never
 * re-implement the recursive descent over `children`.
 *
 * Generic over the concrete node type, so callers that store richer nodes get
 * those richer nodes back from `byPath()` and iteration.
 */
export class ConstructIndex<T extends ConstructTreeNode = ConstructTreeNode> implements Iterable<T> {
  /** Build an index from the roots of a construct tree. */
  public static fromTree<T extends ConstructTreeNode>(tree: readonly T[]): ConstructIndex<T> {
    const byPath = new Map<string, T>();
    // Pre-order insertion: iteration order below relies on the Map preserving it.
    visit(tree, (node) => byPath.set(node.path, node));
    return new ConstructIndex(byPath);
  }

  private constructor(private readonly byPathMap: Map<string, T>) {
  }

  /** The node at a given construct path, or undefined if absent. */
  public byPath(constructPath: string): T | undefined {
    return this.byPathMap.get(constructPath);
  }

  /** Number of nodes in the tree. */
  public get size(): number {
    return this.byPathMap.size;
  }

  /** Pre-order iteration over every node in the tree. */
  public [Symbol.iterator](): Iterator<T> {
    return this.byPathMap.values();
  }
}

/** The single recursive descent over a construct tree. */
function visit<T extends ConstructTreeNode>(nodes: readonly T[], fn: (node: T) => void): void {
  for (const node of nodes) {
    fn(node);
    // In a homogeneous tree the children are the same concrete node type.
    if (node.children.length > 0) visit(node.children as readonly T[], fn);
  }
}

/**
 * Read a cloud assembly's tree.json and join it with each stack's manifest
 * metadata to produce a construct tree where every CFN resource carries its
 * logicalId and CFN type.
 *
 * Supports:
 *  - Flat assemblies (stacks directly under App).
 *  - Stage-based apps: each Stage produces a nested cloud-assembly artifact
 *    under assembly-STAGE/. stacksRecursively descends into them.
 *  - NestedStack contents: aws-cdk-lib emits the per-resource metadata for
 *    nested-stack constructs into the PARENT stack's artifact metadata,
 *    keyed by full construct path.
 *
 * The `decorate` callback turns each node's generic fields and its metadata
 * entries into the concrete node type (e.g. attaching a resolved source location).
 */
export function buildConstructTree<T extends ConstructTreeNode>(
  assembly: CloudAssembly,
  decorate: ConstructNodeDecorator<T>,
): T[] {
  const treeArtifact = assembly.tree();
  if (!treeArtifact) return [];

  const rawTree = loadTree(path.join(assembly.directory, treeArtifact.file));
  if (!rawTree) return [];

  const stackIndex = buildStackIndex(assembly.stacksRecursively);
  return Object.values(rawTree.children ?? {})
    .filter((child) => !isCdkInternal(child.id))
    .map((child) => buildNode(child, stackIndex, undefined, decorate));
}

/**
 * Raw tree.json node. The root tree.json holds the FULL hierarchy including
 * Stage children; nested-assembly subdirs don't shard tree.json.
 */
interface RawTreeNode {
  readonly id: string;
  readonly path: string;
  readonly children?: { [key: string]: RawTreeNode };
  readonly attributes?: { [key: string]: unknown };
  readonly constructInfo?: { readonly fqn: string; readonly version: string };
}

/** A stack artifact plus its metadata Map, keyed (in the index) by construct path. */
interface StackMetadata {
  readonly stack: CloudFormationStackArtifact;
  readonly metadata: Map<string, MetadataEntry[]>;
}
type StackMetadataIndex = Map<string, StackMetadata>;

function loadTree(treePath: string): RawTreeNode | undefined {
  if (!fs.existsSync(treePath)) return undefined;
  const content = JSON.parse(fs.readFileSync(treePath, 'utf-8'));
  return content.tree;
}

/**
 * Index a stack's metadata by its tree-path key. Uses hierarchicalId, which
 * resolves to stack.node.path for everything aws-cdk-lib emits. Caches the
 * metadata Map because stack.metadata re-reads from disk on each access.
 */
function buildStackIndex(stacks: CloudFormationStackArtifact[]): StackMetadataIndex {
  const index: StackMetadataIndex = new Map();
  for (const stack of stacks) {
    index.set(stack.hierarchicalId, { stack, metadata: new Map(Object.entries(stack.metadata)) });
  }
  return index;
}

function buildNode<T extends ConstructTreeNode>(
  raw: RawTreeNode,
  stackIndex: StackMetadataIndex,
  inheritedStack: StackMetadata | undefined,
  decorate: ConstructNodeDecorator<T>,
): T {
  // When a node IS a stack, switch to that stack. Otherwise inherit the
  // parent's: this routes NestedStack children to the parent's metadata,
  // since aws-cdk-lib emits their entries there.
  const owner = stackIndex.get(raw.path) ?? inheritedStack;

  // Metadata keys carry a leading "/", construct paths in tree.json don't.
  const entries = owner?.metadata.get('/' + raw.path) ?? [];

  const logicalIdEntry = entries.find((e) => e.type === ArtifactMetadataEntryType.LOGICAL_ID);
  const logicalId = typeof logicalIdEntry?.data === 'string' ? logicalIdEntry.data : undefined;

  const cfnTypeRaw = raw.attributes?.[CFN_RESOURCE_TYPE_ATTRIBUTE];
  const cfnType = typeof cfnTypeRaw === 'string' ? cfnTypeRaw : undefined;

  const children = Object.values(raw.children ?? {})
    .filter((child) => !isCdkInternal(child.id))
    .map((child) => buildNode(child, stackIndex, owner, decorate));

  return decorate({ path: raw.path, id: raw.id, type: cfnType, logicalId, children }, owner?.stack, raw.path);
}

function isCdkInternal(id: string): boolean {
  return CDK_INTERNAL_IDS.has(id);
}
