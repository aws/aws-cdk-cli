import { AssemblyIndex, loadUnifiedValidationReport } from '@aws-cdk/cloud-assembly-api';
import type { IReadableCloudAssembly, PluginReportJson } from '@aws-cdk/toolkit-lib';
import type { RelativePath } from './assembly-index-with-source-locations';
import { AssemblyIndexWithSourceLocations } from './assembly-index-with-source-locations';
import { SourceMapResolver } from './source-resolver';

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

  const index = await AssemblyIndexWithSourceLocations.createUnindexed({
    appDir: projectRoot,
    assemblyDir: assembly.directory,
    assemblyIndex: await AssemblyIndex.fromAssembly(assembly),
  });

  let violations: PluginReportJson[] = [];
  try {
    violations = await loadUnifiedValidationReport(assembly, assembly.stacksRecursively);
  } catch (err: any) {
    warnings.push(`Failed to load diagnostic report: ${err.message}`);
  }

  // Collect all source files
  const sourceFiles = index.allSourceFiles();
  for (const f of sourceFilesInViolations(violations, index)) {
    sourceFiles.add(f);
  }

  // Read source maps for .js files and index based on the mapped locations
  const map = new SourceMapResolver(index);
  await map.loadSourceMapFor(...Array.from(sourceFiles).filter(file => file.endsWith('.js')));
  index.setSourceResolver({ resolve: (loc) => map.reverseMapJs(loc) });
  index.indexAssembly();

  warnings.push(...map.warnings);

  return {
    index,
    violations,
    warnings,
    timestamp: assembly.mtimeMs,
  };
}

function* sourceFilesInViolations(
  violations: PluginReportJson[],
  index: AssemblyIndexWithSourceLocations,
): Iterable<RelativePath> {
  for (const plugin of violations ?? []) {
    for (const violation of plugin.violations ?? []) {
      for (const vc of violation.violatingConstructs ?? []) {
        const traced = index.traceViolation(vc);
        for (const loc of traced.sourceLocations) {
          yield loc.file;
        }
      }
    }
  }
}
