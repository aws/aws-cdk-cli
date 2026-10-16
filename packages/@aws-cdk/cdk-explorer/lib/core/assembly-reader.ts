import { AssemblyIndex, loadUnifiedValidationReport } from '@aws-cdk/cloud-assembly-api';
import type { IReadableCloudAssembly, PluginReportJson } from '@aws-cdk/toolkit-lib';
import { AssemblyIndexWithSourceLocations } from './assembly-index-with-source-locations';

export interface AssemblyData {
  readonly index: AssemblyIndexWithSourceLocations;
  readonly violations?: PluginReportJson[];
  /** Non-fatal warnings collected while reading the assembly (e.g. unparseable source maps). */
  readonly warnings: readonly string[];
  readonly timestamp: number;
}

export type AssemblyReadResult =
  | { readonly status: 'success'; readonly data: AssemblyData; readonly mtimeMs: number }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string };

export async function webAssemblyDataFromAssembly(projectRoot: string, readableAssembly: IReadableCloudAssembly): Promise<AssemblyData> {
  const assembly = readableAssembly.cloudAssembly;
  const warnings: string[] = [];

  const index = await AssemblyIndexWithSourceLocations.create({
    appDir: projectRoot,
    assemblyDir: assembly.directory,
    assemblyIndex: await AssemblyIndex.fromAssembly(assembly),
  });

  let violations: PluginReportJson[] = [];
  try {
    violations = await loadUnifiedValidationReport(assembly, assembly.stacksRecursively);
    // TODO: Resolve sources of 'violations'
  } catch (err: any) {
    warnings.push(`Failed to load diagnostic report: ${err.message}`);
  }

  return {
    index,
    violations,
    warnings,
    timestamp: assembly.mtimeMs,
  };
}
