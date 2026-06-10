import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactMetadataEntryType, VALIDATION_REPORT_FILE } from '@aws-cdk/cloud-assembly-schema';

/**
 * Programmatic fixture builders. Each builder writes a minimal cdk.out/ to a
 * temp dir and returns its path; cleanupFixture removes it. CloudAssembly
 * construction enforces the schema, which is what catches drift in builders.
 *
 *   const dir = buildFlatAssembly({ stacks: [...] });
 *   try { ... } finally { cleanupFixture(dir); }
 */

/**
 * Pinned schema revision written into fixture manifests. Intentionally a static
 * literal (not Manifest.version()): a fixture frozen at a known revision doubles
 * as a forward-compat test that the reader can still load older assemblies.
 * Deriving the version would make the manifest claim "latest" while its contents
 * stay frozen — i.e. lie about its shape if a future revision changes it.
 */
const ASSEMBLY_SCHEMA_VERSION = '53.0.0';

/** aws-cdk-lib version stamped into fixture tree.json constructInfo. */
const CONSTRUCT_INFO_VERSION = '2.245.0';

/** tree.json schema version written into fixtures. */
const TREE_SCHEMA_VERSION = 'tree-0.1';

export interface ResourceSpec {
  /** Construct id under the stack (e.g. "MyBucket"). */
  readonly id: string;
  /** CFN logical ID (e.g. "MyBucketF68F3FF0"). */
  readonly logicalId: string;
  /** CFN resource type (e.g. "AWS::S3::Bucket"). */
  readonly cfnType: string;
  /** Stack frames for the creation trace (omit for non-TS apps). */
  readonly creationTrace?: readonly string[];
}

export interface StackSpec {
  /** Stack id. Becomes both artifact id and tree path. */
  readonly id: string;
  readonly resources: readonly ResourceSpec[];
}

export interface FlatAssemblySpec {
  readonly stacks: readonly StackSpec[];
  /** Emit `aws:cdk:path` on template resources (default true); false simulates `--no-path-metadata`. */
  readonly pathMetadata?: boolean;
}

export interface StageStackSpec {
  /** Construct id under the Stage. Tree path = `<stage.id>/<this.id>`. */
  readonly id: string;
  readonly resources: readonly ResourceSpec[];
}

export interface StageSpec {
  readonly id: string;
  readonly stacks: readonly StageStackSpec[];
}

export interface NestedAssemblySpec {
  readonly stages: readonly StageSpec[];
}

export interface NestedStackSpec {
  /** Construct id under the parent stack (e.g. "MyNestedStack"). */
  readonly id: string;
  /** Resources inside the nested stack. */
  readonly resources: readonly ResourceSpec[];
}

export interface NestedStackParentSpec {
  /** Parent stack id. */
  readonly id: string;
  /** Top-level resources of the parent stack. */
  readonly resources: readonly ResourceSpec[];
  /** NestedStack children of the parent stack. */
  readonly nestedStacks: readonly NestedStackSpec[];
}

/** Build a flat assembly (stacks directly under App, no Stages). */
export function buildFlatAssembly(spec: FlatAssemblySpec): string {
  const dir = mkAssemblyDir('flat');
  const artifacts: Record<string, unknown> = {
    Tree: { type: 'cdk:tree', properties: { file: 'tree.json' } },
  };

  for (const stack of spec.stacks) {
    artifacts[stack.id] = stackArtifact(stack);
    writeTemplate(dir, stack.id, stack.resources, stack.id, spec.pathMetadata ?? true);
  }

  writeJson(path.join(dir, 'manifest.json'), {
    version: ASSEMBLY_SCHEMA_VERSION,
    artifacts,
  });
  writeJson(path.join(dir, 'tree.json'), {
    version: TREE_SCHEMA_VERSION,
    tree: appNode(spec.stacks.map(stackTreeNode)),
  });
  fs.writeFileSync(path.join(dir, 'cdk.out'), JSON.stringify({ version: ASSEMBLY_SCHEMA_VERSION }));
  return dir;
}

/** Build a Stage-based assembly (each stage produces a nested cloud-assembly). */
export function buildNestedAssembly(spec: NestedAssemblySpec): string {
  const rootDir = mkAssemblyDir('nested');
  const rootArtifacts: Record<string, unknown> = {
    Tree: { type: 'cdk:tree', properties: { file: 'tree.json' } },
  };

  const treeChildren: Record<string, unknown> = {};

  for (const stage of spec.stages) {
    const dirName = `assembly-${stage.id}`;
    rootArtifacts[dirName] = {
      type: 'cdk:cloud-assembly',
      properties: { directoryName: dirName, displayName: stage.id },
    };

    const stageDir = path.join(rootDir, dirName);
    fs.mkdirSync(stageDir, { recursive: true });

    const stageArtifacts: Record<string, unknown> = {};
    for (const stack of stage.stacks) {
      const artifactId = `${stage.id}${stack.id}Artifact`;
      const constructPath = `${stage.id}/${stack.id}`;
      stageArtifacts[artifactId] = {
        type: 'aws:cloudformation:stack',
        environment: 'aws://unknown-account/unknown-region',
        properties: { templateFile: `${artifactId}.template.json` },
        // displayName is the construct path; the reader keys metadata by
        // hierarchicalId, which falls back to displayName.
        displayName: constructPath,
        metadata: stackMetadata(stack.resources, `/${constructPath}`),
      };
      writeTemplate(stageDir, artifactId, stack.resources, constructPath);
    }

    writeJson(path.join(stageDir, 'manifest.json'), {
      version: ASSEMBLY_SCHEMA_VERSION,
      artifacts: stageArtifacts,
    });
    fs.writeFileSync(path.join(stageDir, 'cdk.out'), JSON.stringify({ version: ASSEMBLY_SCHEMA_VERSION }));

    treeChildren[stage.id] = {
      id: stage.id,
      path: stage.id,
      constructInfo: { fqn: 'aws-cdk-lib.Stage', version: CONSTRUCT_INFO_VERSION },
      children: Object.fromEntries(stage.stacks.map((s) => [s.id, {
        id: s.id,
        path: `${stage.id}/${s.id}`,
        constructInfo: { fqn: 'aws-cdk-lib.Stack', version: CONSTRUCT_INFO_VERSION },
        children: resourcesToTreeChildren(`${stage.id}/${s.id}`, s.resources),
      }])),
    };
  }

  writeJson(path.join(rootDir, 'manifest.json'), {
    version: ASSEMBLY_SCHEMA_VERSION,
    artifacts: rootArtifacts,
  });
  writeJson(path.join(rootDir, 'tree.json'), {
    version: TREE_SCHEMA_VERSION,
    tree: appNode(Object.values(treeChildren)),
  });
  fs.writeFileSync(path.join(rootDir, 'cdk.out'), JSON.stringify({ version: ASSEMBLY_SCHEMA_VERSION }));
  return rootDir;
}

/**
 * Build an assembly that mimics a parent stack with NestedStack children.
 * aws-cdk-lib emits NO separate manifest artifact for nested stacks; their
 * resources' metadata lives under the PARENT artifact, keyed by full
 * construct path (e.g. /Parent/MyNestedStack/MyBucket/Resource).
 */
export function buildNestedStackAssembly(spec: { parent: NestedStackParentSpec }): string {
  const dir = mkAssemblyDir('nestedstack');
  const { parent } = spec;

  const metadata: Record<string, unknown[]> = {};
  for (const r of parent.resources) {
    metadata[`/${parent.id}/${r.id}/Resource`] = [logicalIdEntry(r)];
  }
  for (const ns of parent.nestedStacks) {
    for (const r of ns.resources) {
      metadata[`/${parent.id}/${ns.id}/${r.id}/Resource`] = [logicalIdEntry(r)];
    }
  }

  writeJson(path.join(dir, 'manifest.json'), {
    version: ASSEMBLY_SCHEMA_VERSION,
    artifacts: {
      Tree: { type: 'cdk:tree', properties: { file: 'tree.json' } },
      [parent.id]: {
        type: 'aws:cloudformation:stack',
        environment: 'aws://unknown-account/unknown-region',
        properties: { templateFile: `${parent.id}.template.json` },
        displayName: parent.id,
        metadata,
      },
    },
  });

  const parentChildren: Record<string, unknown> = {};
  for (const r of parent.resources) {
    parentChildren[r.id] = resourceTreeNode(parent.id, r);
  }
  for (const ns of parent.nestedStacks) {
    parentChildren[ns.id] = {
      id: ns.id,
      path: `${parent.id}/${ns.id}`,
      constructInfo: { fqn: 'aws-cdk-lib.NestedStack', version: CONSTRUCT_INFO_VERSION },
      children: Object.fromEntries(
        ns.resources.map((r) => [r.id, resourceTreeNode(`${parent.id}/${ns.id}`, r)]),
      ),
    };
  }

  writeJson(path.join(dir, 'tree.json'), {
    version: TREE_SCHEMA_VERSION,
    tree: appNode([{
      id: parent.id,
      path: parent.id,
      constructInfo: { fqn: 'aws-cdk-lib.Stack', version: CONSTRUCT_INFO_VERSION },
      children: parentChildren,
    }]),
  });
  // Parent template: the parent's own resources, plus one
  // AWS::CloudFormation::Stack per nested stack carrying the `aws:asset:path`
  // metadata that points at the nested template (the contract toolkit-lib's
  // nested-stack resolver follows). Each nested template is written flat in the
  // assembly root, holding that nested stack's resources.
  const parentResources: Record<string, unknown> = {};
  for (const r of parent.resources) {
    parentResources[r.logicalId] = {
      Type: r.cfnType,
      Metadata: { 'aws:cdk:path': `${parent.id}/${r.id}/Resource` },
      Properties: {},
    };
  }
  for (const ns of parent.nestedStacks) {
    const nestedTemplateFile = `${parent.id}${ns.id}.nested.template.json`;
    parentResources[`${ns.id}NestedStackResource`] = {
      Type: 'AWS::CloudFormation::Stack',
      Metadata: { 'aws:asset:path': nestedTemplateFile },
      Properties: {},
    };
    const nestedResources: Record<string, unknown> = {};
    for (const r of ns.resources) {
      nestedResources[r.logicalId] = {
        Type: r.cfnType,
        Metadata: { 'aws:cdk:path': `${parent.id}/${ns.id}/${r.id}/Resource` },
        Properties: {},
      };
    }
    writeJson(path.join(dir, nestedTemplateFile), { Resources: nestedResources });
  }
  writeJson(path.join(dir, `${parent.id}.template.json`), { Resources: parentResources });
  fs.writeFileSync(path.join(dir, 'cdk.out'), JSON.stringify({ version: ASSEMBLY_SCHEMA_VERSION }));
  return dir;
}

/** Manifest + tree with no metadata, no traces — for non-TS app graceful-degradation tests. */
export function buildNonTypeScriptAssembly(): string {
  const dir = mkAssemblyDir('nonts');
  writeJson(path.join(dir, 'manifest.json'), {
    version: ASSEMBLY_SCHEMA_VERSION,
    artifacts: {
      Stack1: {
        type: 'aws:cloudformation:stack',
        environment: 'aws://unknown-account/unknown-region',
        properties: { templateFile: 'Stack1.template.json' },
        displayName: 'Stack1',
        // No metadata: non-TS apps emit no aws:cdk:logicalId entries.
      },
      Tree: { type: 'cdk:tree', properties: { file: 'tree.json' } },
    },
  });
  writeJson(path.join(dir, 'tree.json'), {
    version: TREE_SCHEMA_VERSION,
    tree: {
      id: 'App',
      path: '',
      constructInfo: { fqn: 'aws-cdk-lib.App', version: CONSTRUCT_INFO_VERSION },
      children: {
        Stack1: {
          id: 'Stack1',
          path: 'Stack1',
          constructInfo: { fqn: 'aws-cdk-lib.Stack', version: CONSTRUCT_INFO_VERSION },
        },
      },
    },
  });
  writeJson(path.join(dir, 'Stack1.template.json'), { Resources: {} });
  fs.writeFileSync(path.join(dir, 'cdk.out'), JSON.stringify({ version: ASSEMBLY_SCHEMA_VERSION }));
  return dir;
}

/** Drop an unparseable validation-report.json into an existing fixture dir. */
export function withMalformedValidationReport(dir: string): void {
  fs.writeFileSync(path.join(dir, VALIDATION_REPORT_FILE), '{ "pluginReports": [');
}

/**
 * Drop a well-formed but version-LESS validation-report.json: the legacy shape
 * older aws-cdk-lib emits (no `version` field). The reader must still load it.
 */
export function withVersionlessValidationReport(dir: string): void {
  writeJson(path.join(dir, VALIDATION_REPORT_FILE), {
    title: 'Validation Report',
    pluginReports: [],
  });
}

/** Drop a well-formed validation-report.json into an existing fixture dir. */
export function withValidationReport(dir: string, report: {
  version?: string;
  pluginReports: Array<{
    pluginName: string;
    conclusion: 'success' | 'failure';
    violations: Array<{
      ruleName: string;
      description: string;
      severity: 'fatal' | 'error' | 'warning' | 'info' | 'custom';
      violatingConstructs: Array<{
        constructPath: string;
        cloudFormationResource?: { templatePath: string; logicalId: string };
      }>;
    }>;
  }>;
}): void {
  writeJson(path.join(dir, VALIDATION_REPORT_FILE), {
    version: report.version ?? '1.0.0',
    ...report,
  });
}

/** Delete a fixture dir; safe on undefined / missing dirs. */
export function cleanupFixture(dir: string | undefined): void {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- internals ----------

function mkAssemblyDir(prefix: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `cdk-explorer-${prefix}-`));
  return path.join(base, 'cdk.out');
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appNode(children: readonly unknown[]): unknown {
  const childrenMap: Record<string, unknown> = {};
  for (const child of children) {
    const c = child as { id: string };
    childrenMap[c.id] = child;
  }
  return {
    id: 'App',
    path: '',
    constructInfo: { fqn: 'aws-cdk-lib.App', version: CONSTRUCT_INFO_VERSION },
    children: childrenMap,
  };
}

function stackTreeNode(stack: StackSpec): unknown {
  return {
    id: stack.id,
    path: stack.id,
    constructInfo: { fqn: 'aws-cdk-lib.Stack', version: CONSTRUCT_INFO_VERSION },
    children: Object.fromEntries(
      stack.resources.map((r) => [r.id, resourceTreeNode(stack.id, r)]),
    ),
  };
}

function resourcesToTreeChildren(stackPath: string, resources: readonly ResourceSpec[]): Record<string, unknown> {
  return Object.fromEntries(resources.map((r) => [r.id, resourceTreeNode(stackPath, r)]));
}

// Mirrors aws-cdk-lib's L2 construct -> CfnResource child shape.
function resourceTreeNode(parentPath: string, r: ResourceSpec): unknown {
  return {
    id: r.id,
    path: `${parentPath}/${r.id}`,
    children: {
      Resource: {
        id: 'Resource',
        path: `${parentPath}/${r.id}/Resource`,
        attributes: { 'aws:cdk:cloudformation:type': r.cfnType },
      },
    },
  };
}

function stackArtifact(stack: StackSpec): unknown {
  return {
    type: 'aws:cloudformation:stack',
    environment: 'aws://unknown-account/unknown-region',
    properties: { templateFile: `${stack.id}.template.json` },
    displayName: stack.id,
    metadata: stackMetadata(stack.resources, `/${stack.id}`),
  };
}

function stackMetadata(resources: readonly ResourceSpec[], pathPrefix: string): Record<string, unknown[]> {
  const metadata: Record<string, unknown[]> = {};
  for (const r of resources) {
    metadata[`${pathPrefix}/${r.id}/Resource`] = [logicalIdEntry(r)];
  }
  return metadata;
}

function logicalIdEntry(r: ResourceSpec): Record<string, unknown> {
  const entry: Record<string, unknown> = { type: ArtifactMetadataEntryType.LOGICAL_ID, data: r.logicalId };
  if (r.creationTrace && r.creationTrace.length > 0) {
    entry.trace = [...r.creationTrace];
  }
  return entry;
}

function writeTemplate(
  dir: string,
  fileBaseId: string,
  resources: readonly ResourceSpec[],
  constructPathPrefix: string,
  pathMetadata = true,
): void {
  const out: Record<string, unknown> = {};
  for (const r of resources) {
    out[r.logicalId] = {
      Type: r.cfnType,
      // aws:cdk:path mirrors real synth output (on by default), giving each
      // resource its globally-unique construct path for collision-free lookup.
      ...(pathMetadata ? { Metadata: { 'aws:cdk:path': `${constructPathPrefix}/${r.id}/Resource` } } : {}),
      Properties: {},
    };
  }
  writeJson(path.join(dir, `${fileBaseId}.template.json`), { Resources: out });
}
