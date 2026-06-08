import * as fs from 'fs';
import * as path from 'path';
import { buildConstructTree, CloudAssembly, type ConstructTreeNode } from '@aws-cdk/cloud-assembly-api';
import { Manifest, VALIDATION_REPORT_FILE, type PolicyValidationReportJson } from '@aws-cdk/cloud-assembly-schema';
import { createSourceMapCache, resolveSourceLocation, type SourceLocation, type WarnFn } from './source-resolver';

/**
 * A construct from the cloud assembly, decorated with the user source location
 * where it was created. Extends the generic tree node from cloud-assembly-api
 * with the source-map-resolved location the LSP/explorer surfaces.
 */
export interface ConstructNode extends ConstructTreeNode {
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
 * Decorates the cloud assembly's construct tree with the source location of
 * each node and attaches any policy-validation violations. Tree construction
 * (tree.json + stack-metadata join) is delegated to buildConstructTree.
 */
export function readAssembly(assemblyDir: string, onWarn?: WarnFn): AssemblyReadResult {
  const manifestPath = path.join(assemblyDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { status: 'not-found' };
  }

  try {
    const assembly = new CloudAssembly(assemblyDir);
    // One source-map cache per readAssembly call: avoids re-parsing the same
    // .js.map for every construct, while keeping the cache scoped so a fresh
    // synth observes any moved/edited maps.
    const sourceMapCache = createSourceMapCache();
    const tree = buildConstructTree<ConstructNode>(assembly, (fields, metadataEntries) => ({
      ...fields,
      sourceLocation: resolveSourceLocation(metadataEntries, sourceMapCache, onWarn),
    }));

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

/** Loads the policy-validation report from the assembly dir, if present. */
function loadViolations(assemblyDir: string): PolicyValidationReportJson | undefined {
  const reportPath = path.join(assemblyDir, VALIDATION_REPORT_FILE);
  if (!fs.existsSync(reportPath)) return undefined;
  return Manifest.loadValidationReport(reportPath);
}
