import * as fs from 'fs';
import * as path from 'path';
import { ArtifactMetadataEntryType, CFN_RESOURCE_TYPE_ATTRIBUTE, type MetadataEntry } from '@aws-cdk/cloud-assembly-schema';
import type { CloudFormationStackArtifact } from './artifacts/cloudformation-artifact';
import { ASSET_RESOURCE_METADATA_PATH_KEY } from './assets';
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
  /**
   * Absolute path to the `*.template.json` that declares this construct's CFN
   * resource -- the nested template for resources inside a NestedStack. Set
   * only for CFN resources whose template is resolvable.
   */
  readonly templateFile?: string;
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
  readonly templateFile?: string;
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
  const ctx: WalkContext<T> = { stackIndex, decorate, templateCache: new Map() };
  return Object.values(rawTree.children ?? {})
    .filter((child) => !isCdkInternal(child.id))
    .map((child) => buildNode(child, ctx, undefined, NO_TEMPLATE));
}

/** Shared state for a single {@link buildConstructTree} walk. */
interface WalkContext<T extends ConstructTreeNode> {
  readonly stackIndex: StackMetadataIndex;
  readonly decorate: ConstructNodeDecorator<T>;
  /** Parsed nested templates, cached by absolute path. */
  readonly templateCache: Map<string, CfnTemplate | undefined>;
}

/** The slice of a CloudFormation template the tree walk reads. */
interface CfnTemplate {
  readonly Resources?: Record<string, CfnResource>;
}
interface CfnResource {
  readonly Type?: string;
  readonly Metadata?: Record<string, unknown>;
}

/**
 * The active CloudFormation template threaded down the tree walk: a resolved
 * `{ file, template }` pair, or both `undefined` when there's no resolvable
 * template (the root, or a nested stack that isn't CDK-resolvable). Never a
 * partial mix.
 */
type TemplateScope =
  | { readonly file: string; readonly template: CfnTemplate }
  | { readonly file: undefined; readonly template: undefined };

/** Scope for nodes with no resolvable template: the root seed and unresolvable nested stacks. */
const NO_TEMPLATE: TemplateScope = { file: undefined, template: undefined };

/**
 * Raw tree.json node. The root tree.json holds the FULL hierarchy including
 * Stage children; nested-assembly subdirs don't shard tree.json.
 */
interface RawTreeNode {
  readonly id: string;
  readonly path: string;
  readonly children?: { [key: string]: RawTreeNode };
  readonly attributes?: { [key: string]: unknown };
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
  ctx: WalkContext<T>,
  inheritedStack: StackMetadata | undefined,
  inherited: TemplateScope,
): T {
  const stackHere = ctx.stackIndex.get(raw.path);
  const owner = stackHere ?? inheritedStack;
  // A stack node switches to its own template via the artifact's cached getter,
  // which throws on a missing/corrupt top-level template -- a real assembly error
  // we surface rather than swallow. Other nodes inherit the active scope.
  const scope: TemplateScope = stackHere
    ? { file: stackHere.stack.templateFullPath, template: stackHere.stack.template as CfnTemplate }
    : inherited;

  // Metadata keys carry a leading "/", construct paths in tree.json don't.
  const entries = owner?.metadata.get('/' + raw.path) ?? [];
  const logicalId = logicalIdFromEntries(entries);

  const cfnTypeRaw = raw.attributes?.[CFN_RESOURCE_TYPE_ATTRIBUTE];
  const cfnType = typeof cfnTypeRaw === 'string' ? cfnTypeRaw : undefined;

  // A NestedStack switches its subtree to the nested scope; other nodes inherit.
  const children = Object.values(raw.children ?? {})
    .filter((child) => !isCdkInternal(child.id))
    .map((child) => buildNode(child, ctx, owner, nestedBoundary(child, raw, owner, scope.template, ctx) ?? scope));

  // Only CFN resources (those with a logical ID) carry a templateFile.
  const nodeTemplateFile = logicalId !== undefined ? scope.file : undefined;
  return ctx.decorate(
    { path: raw.path, id: raw.id, type: cfnType, logicalId, templateFile: nodeTemplateFile, children },
    owner?.stack,
    raw.path,
  );
}

function logicalIdFromEntries(entries: MetadataEntry[]): string | undefined {
  const entry = entries.find((e) => e.type === ArtifactMetadataEntryType.LOGICAL_ID);
  return typeof entry?.data === 'string' ? entry.data : undefined;
}

/** Parses a template file (cached by absolute path); undefined when missing/unparseable. */
function loadTemplate(absPath: string, cache: Map<string, CfnTemplate | undefined>): CfnTemplate | undefined {
  if (cache.has(absPath)) return cache.get(absPath);
  let template: CfnTemplate | undefined;
  try {
    template = JSON.parse(fs.readFileSync(absPath, 'utf-8')) as CfnTemplate;
  } catch {
    template = undefined; // missing/unparseable: that subtree just won't resolve a templateFile
  }
  cache.set(absPath, template);
  return template;
}

/**
 * If `child` is a NestedStack, resolves the template scope for its subtree;
 * otherwise returns `undefined` (caller keeps the active scope).
 *
 * Detection keys off the sibling `AWS::CloudFormation::Stack` that aws-cdk-lib
 * emits at `<parent>/<id>.NestedStack/<id>.NestedStackResource` (whose
 * `aws:asset:path` points at the nested template), NOT the construct's fqn -- a
 * jsii-published NestedStack subclass has an fqn that doesn't end in
 * ".NestedStack", but the sibling is named the same regardless. Returns
 * NO_TEMPLATE (not the parent's) when unresolvable, since the nested stack's
 * resources don't live in the parent template.
 */
function nestedBoundary<T extends ConstructTreeNode>(
  child: RawTreeNode,
  parent: RawTreeNode,
  owner: StackMetadata | undefined,
  currentTemplate: CfnTemplate | undefined,
  ctx: WalkContext<T>,
): TemplateScope | undefined {
  const resourceNode = parent.children?.[`${child.id}.NestedStack`]?.children?.[`${child.id}.NestedStackResource`];
  // No sibling -> not a nested stack. A real nested stack always lives under a
  // stack, so `owner` is defined here; the check also narrows it.
  if (!resourceNode || !owner) return undefined;

  const logicalId = logicalIdFromEntries(owner.metadata.get('/' + resourceNode.path) ?? []);
  const assetPath = logicalId !== undefined
    ? currentTemplate?.Resources?.[logicalId]?.Metadata?.[ASSET_RESOURCE_METADATA_PATH_KEY]
    : undefined;
  if (typeof assetPath !== 'string') return NO_TEMPLATE;
  // Asset path is relative to the OWNER stack's assembly dir (the Stage
  // sub-assembly for staged stacks), not necessarily the root assembly.
  const file = path.join(path.dirname(owner.stack.templateFullPath), assetPath);
  const template = loadTemplate(file, ctx.templateCache);
  return template ? { file, template } : NO_TEMPLATE;
}

function isCdkInternal(id: string): boolean {
  return CDK_INTERNAL_IDS.has(id);
}
