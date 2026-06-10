import * as fs from 'fs';
import * as path from 'path';
import { ASSET_RESOURCE_METADATA_PATH_KEY, buildConstructTree, CloudAssembly, PATH_METADATA_KEY, type ConstructTreeNode } from '@aws-cdk/cloud-assembly-api';
import { VALIDATION_REPORT_FILE, type PolicyValidationReportJson } from '@aws-cdk/cloud-assembly-schema';
import { findCreationStackTrace } from '@aws-cdk/toolkit-lib';
import { SourceMapResolver, type SourceLocation } from './source-resolver';

/**
 * A construct from the cloud assembly, decorated with the user source location
 * where it was created. Extends the generic tree node from cloud-assembly-api
 * with the source-map-resolved location the LSP/explorer surfaces.
 */
export interface ConstructNode extends ConstructTreeNode {
  /** User source location where the construct was created; undefined for non-TS apps. */
  readonly sourceLocation?: SourceLocation;
  /**
   * Absolute path to the `*.template.json` that declares this construct's CFN
   * resource (the nested template for resources inside a NestedStack). Set only
   * for CFN resources, and only when the template is resolvable.
   */
  readonly templateFile?: string;
  readonly children: readonly ConstructNode[];
}

export interface AssemblyData {
  readonly tree: readonly ConstructNode[];
  readonly violations?: PolicyValidationReportJson;
  /** Set when validation-report.json fails to load. The tree still loads. */
  readonly violationsError?: string;
  /** Non-fatal warnings collected while reading the assembly (e.g. unparseable source maps). */
  readonly warnings: readonly string[];
}

export type AssemblyReadResult =
  | { readonly status: 'success'; readonly data: AssemblyData }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string };

/**
 * Decorates the cloud assembly's construct tree with the source location of
 * each node and attaches any policy-validation violations. Tree construction
 * (tree.json + stack-metadata join) is delegated to buildConstructTree.
 */
export function readAssembly(assemblyDir: string): AssemblyReadResult {
  const manifestPath = path.join(assemblyDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { status: 'not-found' };
  }

  try {
    const assembly = new CloudAssembly(assemblyDir);
    // One resolver per readAssembly call: caches parsed source maps across
    // constructs, scoped so a fresh synth observes any moved/edited maps.
    const sourceResolver = new SourceMapResolver();
    const templateFiles = buildTemplateFileIndex(assembly);
    const tree = buildConstructTree<ConstructNode>(assembly, (fields, stack, constructPath) => ({
      ...fields,
      sourceLocation: stack
        ? sourceResolver.resolveFrames(findCreationStackTrace(stack, constructPath))
        : undefined,
      // Construct path is globally unique, so it resolves a resource even when
      // it shares a logical ID with a twin in a nested stack. Fall back to the
      // per-stack logical-ID map when path metadata is off (see the index doc).
      templateFile: fields.logicalId !== undefined && stack
        ? templateFiles.byConstructPath.get(constructPath)
          ?? templateFiles.byStack.get(stack.hierarchicalId)?.get(fields.logicalId)
        : undefined,
    }));

    let violations: PolicyValidationReportJson | undefined;
    let violationsError: string | undefined;
    try {
      violations = loadViolations(assemblyDir);
    } catch (err) {
      violationsError = (err as Error).message;
    }

    return {
      status: 'success',
      data: { tree, violations, violationsError, warnings: sourceResolver.warnings },
    };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}

/** Loads the policy-validation report from the assembly dir, if present. */
function loadViolations(assemblyDir: string): PolicyValidationReportJson | undefined {
  const reportPath = path.join(assemblyDir, VALIDATION_REPORT_FILE);
  if (!fs.existsSync(reportPath)) return undefined;
  // Read as data, not via Manifest.loadValidationReport: that loader's version-compat
  // check throws on older aws-cdk-lib reports that omit `version`. We only consume
  // pluginReports, which are version-independent across producer versions.
  return JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as PolicyValidationReportJson;
}

/** The slice of a CloudFormation template this reader reads. */
interface CfnTemplate {
  readonly Resources?: Record<string, CfnResource>;
}
interface CfnResource {
  readonly Type?: string;
  readonly Metadata?: Record<string, unknown>;
}

/**
 * Two ways to find the template that declares a resource. Both are built from
 * the same walk; the decorator tries `byConstructPath` first, then `byStack`.
 */
interface TemplateFileIndex {
  /**
   * Construct path -> absolute template path. The PRIMARY key, because a
   * construct path is globally unique across the whole assembly. Logical IDs
   * are NOT: CDK hashes them relative to the enclosing Stack, and a NestedStack
   * resets that scope -- so a parent resource and a resource in its own nested
   * stack can share a logical ID while living in different templates. Keying on
   * the construct path disambiguates those twins. Sourced from `aws:cdk:path`
   * resource metadata, present whenever path metadata is enabled.
   */
  readonly byConstructPath: Map<string, string>;
  /**
   * Stack hierarchicalId -> (logical ID -> absolute template path). The
   * FALLBACK, used when `aws:cdk:path` is absent (path metadata is on by
   * default in `cdk synth` but can be disabled via `--no-path-metadata`).
   * Keyed per stack because logical IDs are only unique within a stack.
   */
  readonly byStack: Map<string, Map<string, string>>;
}

/**
 * Indexes every CFN resource to the template that declares it, descending into
 * CDK-managed nested stacks via the `aws:asset:path` resource metadata (the
 * link CDK's own deploy/diff uses; absent when asset metadata is disabled, in
 * which case the nested stack is unresolvable and its resources are omitted).
 */
function buildTemplateFileIndex(assembly: CloudAssembly): TemplateFileIndex {
  const byConstructPath = new Map<string, string>();
  const byStack = new Map<string, Map<string, string>>();
  for (const stack of assembly.stacksRecursively) {
    const byLogicalId = new Map<string, string>();
    const walk = (templateFile: string, template: CfnTemplate): void => {
      for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
        byLogicalId.set(logicalId, templateFile);
        const constructPath = resource.Metadata?.[PATH_METADATA_KEY];
        if (typeof constructPath === 'string') {
          byConstructPath.set(constructPath, templateFile);
        }
        const assetPath = resource.Type === 'AWS::CloudFormation::Stack'
          ? resource.Metadata?.[ASSET_RESOURCE_METADATA_PATH_KEY]
          : undefined;
        if (typeof assetPath === 'string') {
          const nestedFile = path.join(assembly.directory, assetPath);
          walk(nestedFile, JSON.parse(fs.readFileSync(nestedFile, 'utf-8')) as CfnTemplate);
        }
      }
    };
    walk(stack.templateFullPath, stack.template as CfnTemplate);
    byStack.set(stack.hierarchicalId, byLogicalId);
  }
  return { byConstructPath, byStack };
}
