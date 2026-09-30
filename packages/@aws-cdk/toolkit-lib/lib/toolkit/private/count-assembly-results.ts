import * as path from 'path';
import type * as cxapi from '@aws-cdk/cloud-assembly-api';
import { SynthesisMessageLevel } from '@aws-cdk/cloud-assembly-api';
import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import * as fs from 'fs-extra';
import type { IMessageSpan } from '../../api/io/private/span';
import { sum } from '../../util';

const VALIDATION_REPORT_FILE = 'validation-report.json';

export function countAssemblyResults(span: IMessageSpan<any>, assembly: cxapi.CloudAssembly) {
  const stacksRecursively = assembly.stacksRecursively;
  const summary = offlineValidationSummary(assembly);
  const messageWarnings = sum(stacksRecursively.map(s => s.messages.filter(m => m.level === SynthesisMessageLevel.WARNING).length));
  span.incCounter('stacks', stacksRecursively.length);
  span.incCounter('assemblies', asmCount(assembly));
  span.incCounter('errorAnns', sum(stacksRecursively.map(s => s.messages.filter(m => m.level === SynthesisMessageLevel.ERROR).length)));
  // Construct annotation warnings live in stack.messages for legacy assemblies
  // and in the validation report (report-only mode) for newer ones; the two are
  // mutually exclusive, so summing them counts each once.
  span.incCounter('warnings', messageWarnings + summary.reportAnnotationWarnings);
  span.incCounter('offlineValidationWarnings', summary.offlineValidationWarnings);
  span.incCounter('offlineWouldFailDeploy', summary.wouldFailDeploy ? 1 : 0);

  const annotationErrorCodes = stacksRecursively
    .flatMap(s => Object.values(s.metadata ?? {})
      .flatMap(ms => ms.filter(m => m.type === ANNOTATION_ERROR_CODE_TYPE)));
  for (const annotationErrorCode of annotationErrorCodes) {
    span.incCounter(`errorAnn:${annotationErrorCode.data}`);
  }

  function asmCount(x: cxapi.CloudAssembly): number {
    return 1 + x.nestedAssemblies.reduce((acc, asm) => acc + asmCount(asm.nestedAssembly), 0);
  }
}

export interface OfflineValidationSummary {
  /**
   * Whether the offline validation results would have failed a default `cdk deploy`
   *
   * Mirrors `wouldFailDeploy` at the default 'error' threshold over the whole
   * assembly (independent of any `--strict`/`--ignore-errors` on the current
   * command): a deploy fails if there are error-level construct annotations or a
   * policy plugin reported a failure.
   */
  readonly wouldFailDeploy: boolean;

  /**
   * The number of warning-severity violations reported by policy plugins
   *
   * Construct annotation warnings are excluded (they are counted by the
   * `warnings` counter), so this only reflects policy validation plugins.
   */
  readonly offlineValidationWarnings: number;

  /**
   * The number of warning-severity construct annotations recorded in the
   * validation report (report-only assemblies)
   *
   * These are folded into the `warnings` counter, not `offlineValidationWarnings`,
   * so report-only annotation warnings are counted like message-based ones.
   */
  readonly reportAnnotationWarnings: number;
}

/**
 * Summarize the offline validation outcome (policy report + construct annotations) for the whole assembly
 */
export function offlineValidationSummary(assembly: cxapi.CloudAssembly): OfflineValidationSummary {
  const hasErrorAnnotations = assembly.stacksRecursively.some(
    s => s.messages.some(m => m.level === SynthesisMessageLevel.ERROR),
  );

  const pluginReports = loadValidationReport(assembly);

  const warningsFor = (isAnnotation: boolean) => pluginReports
    .filter(r => (r.pluginName === CONSTRUCT_ANNOTATIONS_PLUGINNAME) === isAnnotation)
    .reduce((acc, r) => acc + r.violations.filter(v => v.severity === 'warning').length, 0);

  return {
    wouldFailDeploy: hasErrorAnnotations || pluginReports.some(r => r.conclusion === 'failure'),
    offlineValidationWarnings: warningsFor(false),
    reportAnnotationWarnings: warningsFor(true),
  };
}

/**
 * Load the policy validation report, if any
 *
 * These counters are best-effort telemetry that run on every synth, so a
 * missing or malformed report must never fail the command: on any read or
 * schema error we behave as if there were no report.
 */
function loadValidationReport(assembly: cxapi.CloudAssembly): PluginReportJson[] {
  const reportPath = path.join(assembly.directory, VALIDATION_REPORT_FILE);
  if (!fs.existsSync(reportPath)) {
    return [];
  }
  try {
    return Manifest.loadValidationReport(reportPath).pluginReports;
  } catch {
    return [];
  }
}

/**
 * Well-known and agreed-upon value between aws-cdk-lib and the toolkit
 *
 * Do not change, obviously.
 */
const ANNOTATION_ERROR_CODE_TYPE = 'aws:cdk:error-code';

/**
 * The name of the plugin that emits construct annotations into the validation report.
 *
 * Its warnings are counted by the `warnings` counter, so they are excluded from
 * the policy warning count.
 */
const CONSTRUCT_ANNOTATIONS_PLUGINNAME = 'Construct Annotations';
