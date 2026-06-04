import * as fs from 'fs';
import * as path from 'path';
import { CloudAssembly, type CloudFormationStackArtifact } from '@aws-cdk/cloud-assembly-api';
import {
  ArtifactMetadataEntryType,
  Manifest,
  type MetadataEntry,
  type PolicyValidationReportJson,
} from '@aws-cdk/cloud-assembly-schema';
import { createSourceMapCache, resolveSourceLocation, type SourceLocation, type SourceMapCache, type WarnFn } from './source-resolver';

/** A construct from tree.json plus the CFN metadata the LSP surfaces. */
export interface ConstructNode {
  readonly path: string;
  readonly id: string;
  /** CFN resource type (e.g. "AWS::S3::Bucket"), if this construct is a CFN resource. */
  readonly type?: string;
  /** CFN logical ID, if this construct maps to a CFN resource. */
  readonly logicalId?: string;
  /** User source location where the construct was created; undefined for non-TS apps. */
  readonly sourceLocation?: SourceLocation;
  readonly children: readonly ConstructNode[];
}

export interface AssemblyData {
  readonly tree: readonly ConstructNode[];
  readonly violations?: PolicyValidationReportJson;
  /** Set when validation-report.json fails to load. The tree still loads. */
  readonly violationsError?: string;
}

export type AssemblyReadResult =
  | { readonly status: 'success'; readonly data: AssemblyData }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string };

/**
 * Reads a cdk.out/ directory and joins tree.json with each stack's manifest
 * metadata to produce a ConstructNode tree where every CFN resource carries
 * its logicalId, CFN type, and source location.
 *
 * Supports:
 *  - Flat assemblies (stacks directly under App).
 *  - Stage-based apps: each Stage produces a nested cloud-assembly artifact
 *    under assembly-STAGE/. stacksRecursively descends into them.
 *  - NestedStack contents: aws-cdk-lib emits the per-resource metadata for
 *    nested-stack constructs into the PARENT stack's artifact metadata,
 *    keyed by full construct path.
 */
export function readAssembly(assemblyDir: string, onWarn?: WarnFn): AssemblyReadResult {
  const manifestPath = path.join(assemblyDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { status: 'not-found' };
  }

  try {
    const assembly = new CloudAssembly(assemblyDir);
    const rawTree = loadTree(assemblyDir);
    const stacks = assembly.stacksRecursively;

    const stackIndex = buildStackIndex(stacks);
    // One source-map cache per readAssembly call: avoids re-parsing the same
    // .js.map for every construct, while keeping the cache scoped so a fresh
    // synth observes any moved/edited maps.
    const sourceMapCache = createSourceMapCache();
    const tree = rawTree
      ? buildTree(rawTree, stackIndex, sourceMapCache, onWarn)
      : [];

    let violations: PolicyValidationReportJson | undefined;
    let violationsError: string | undefined;
    try {
      violations = loadViolations(assemblyDir);
    } catch (err) {
      violationsError = err instanceof Error ? err.message : String(err);
    }

    return {
      status: 'success',
      data: { tree, violations, violationsError },
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
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

/** Per-stack metadata Map, keyed by the stack's construct path. */
type StackMetadataIndex = Map<string, Map<string, MetadataEntry[]>>;

// tree.json attribute carrying the CFN resource type. aws-cdk-lib emits this
// in `private/`; @aws-cdk/cloud-assembly-schema does not re-export it.
const CFN_TYPE_ATTRIBUTE = 'aws:cdk:cloudformation:type';

function loadTree(assemblyDir: string): RawTreeNode | undefined {
  const treePath = path.join(assemblyDir, 'tree.json');
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
    index.set(stack.hierarchicalId, new Map(Object.entries(stack.metadata)));
  }
  return index;
}

function buildTree(
  root: RawTreeNode,
  stackIndex: StackMetadataIndex,
  sourceMapCache: SourceMapCache,
  onWarn?: WarnFn,
): ConstructNode[] {
  return Object.values(root.children ?? {})
    .filter((child) => !isCdkInternal(child.id))
    .map((child) => buildNode(child, stackIndex, undefined, sourceMapCache, onWarn));
}

function buildNode(
  raw: RawTreeNode,
  stackIndex: StackMetadataIndex,
  inheritedMetadata: Map<string, MetadataEntry[]> | undefined,
  sourceMapCache: SourceMapCache,
  onWarn?: WarnFn,
): ConstructNode {
  // When a node IS a stack, switch to that stack's metadata. Otherwise inherit
  // the parent's: this routes NestedStack children to the parent's metadata,
  // since aws-cdk-lib emits their entries there.
  const metadata = stackIndex.get(raw.path) ?? inheritedMetadata;

  // Metadata keys carry a leading "/", construct paths in tree.json don't.
  const entries = metadata?.get('/' + raw.path) ?? [];

  const logicalIdEntry = entries.find((e) => e.type === ArtifactMetadataEntryType.LOGICAL_ID);
  const logicalId = typeof logicalIdEntry?.data === 'string' ? logicalIdEntry.data : undefined;

  const cfnTypeRaw = raw.attributes?.[CFN_TYPE_ATTRIBUTE];
  const cfnType = typeof cfnTypeRaw === 'string' ? cfnTypeRaw : undefined;

  const sourceLocation = resolveSourceLocation(entries, sourceMapCache, onWarn);

  return {
    path: raw.path,
    id: raw.id,
    type: cfnType,
    logicalId,
    sourceLocation,
    children: Object.values(raw.children ?? {})
      .filter((child) => !isCdkInternal(child.id))
      .map((child) => buildNode(child, stackIndex, metadata, sourceMapCache, onWarn)),
  };
}

const CDK_INTERNAL_IDS = new Set(['Tree', 'CDKMetadata', 'BootstrapVersion', 'CheckBootstrapVersion']);

function isCdkInternal(id: string): boolean {
  return CDK_INTERNAL_IDS.has(id);
}

/** Canonical filename of the policy-validation report inside cdk.out/. */
export const VALIDATION_REPORT_FILE = 'validation-report.json';

function loadViolations(assemblyDir: string): PolicyValidationReportJson | undefined {
  const reportPath = path.join(assemblyDir, VALIDATION_REPORT_FILE);
  if (!fs.existsSync(reportPath)) return undefined;
  return Manifest.loadValidationReport(reportPath);
}
