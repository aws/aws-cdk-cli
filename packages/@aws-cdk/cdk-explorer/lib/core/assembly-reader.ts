import * as fs from 'fs';
import * as path from 'path';
import { buildConstructTree, CloudAssembly, MANIFEST_FILE, type ConstructTreeNode } from '@aws-cdk/cloud-assembly-api';
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
  readonly children: readonly ConstructNode[];
}

export interface AssemblyData {
  readonly tree: readonly ConstructNode[];
  readonly violations?: PolicyValidationReportJson;
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
  const manifestPath = path.join(assemblyDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { status: 'not-found' };
  }

  try {
    const assembly = new CloudAssembly(assemblyDir);
    // One resolver per readAssembly call: caches parsed source maps across
    // constructs, scoped so a fresh synth observes any moved/edited maps.
    const sourceResolver = new SourceMapResolver();
    const tree = buildConstructTree<ConstructNode>(assembly, (fields, stack, constructPath) => ({
      ...fields,
      sourceLocation: stack
        ? sourceResolver.resolveFrames(findCreationStackTrace(stack, constructPath))
        : undefined,
    }));

    let violations: PolicyValidationReportJson | undefined;
    const warnings = [...sourceResolver.warnings];
    try {
      violations = loadViolations(assemblyDir);
    } catch (err) {
      // The producer writes the validation report synchronously, so a corrupt
      // file is not reachable through normal synth flow. We treat it the same
      // as "no report present" and surface a warning for the rare case.
      warnings.push(`Failed to load ${VALIDATION_REPORT_FILE}: ${(err as Error).message}`);
    }

    return {
      status: 'success',
      data: { tree, violations, warnings },
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
