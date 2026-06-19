import * as fs from 'fs-extra';
import { Manifest, PluginReportJson, PolicyValidationReportConclusion } from "@aws-cdk/cloud-assembly-schema";
import * as path from "path";
import { StackCollection } from "../../api/cloud-assembly/stack-collection";
import { collectAnnotationReport } from "./collect-annotation-report";
import { MinimumSeverity } from '../types';
import { IoHelper } from '../../api/io/private/io-helper';
import { ValidateResult } from '../../actions/validate';
import { hostMessageFromValidation } from '../../api/validate/validate-formatting';
import { AssemblyError } from '../toolkit-error';

const VALIDATION_REPORT_FILE = 'validation-report.json';

/**
 * The name of the plugin that emits construct annotations into the validation report.
 *
 * @see https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/core/lib/private/annotation-plugin.ts
 */
const CONSTRUCT_ANNOTATIONS_PLUGINNAME = 'Construct Annotations';

interface AssemblyLike {
  readonly directory: string;
}

/**
 * Return a validation report that contains the validation report that the CDK app has written, as well as any Construct Metadata annotations in the manifest.
 *
 * This function takes into account the CDK app can already have written the
 * construct annotations into the validation report, or not, depending on the
 * setting of a deprecated feature flag. If the annotations are already in the report,
 * they are not copied.
 *
 * Afterwards, the list of violations is filtered to only include those that are relevant to the stacks selected for validation.
 *
 * Returns whether an explicit report file was found or not.
 */
export async function obtainUnifiedValidationReport(assembly: AssemblyLike, stacks: StackCollection): Promise<PluginReportJson[]>  {
  const ret: PluginReportJson[] = [];

  const reportPath = path.join(assembly.directory, VALIDATION_REPORT_FILE);
  if (await fs.pathExists(reportPath)) {
    const selectedStackIds = new Set(stacks.hierarchicalIds);
    const report = Manifest.loadValidationReport(reportPath);

    // Filter the report to only include violations for the selected stacks
    const filteredReports = filterReportsByStacks(report.pluginReports, selectedStackIds);
    ret.push(...filteredReports);
  }

  const alreadyHasAnnotations = ret.some((r) => r.pluginName === CONSTRUCT_ANNOTATIONS_PLUGINNAME);
  if (!alreadyHasAnnotations) {
    const annotationReport = collectAnnotationReport(stacks);
    if (annotationReport.violations.length > 0 || annotationReport.conclusion === 'failure') {
      ret.push(annotationReport);
    }
  }

  // Remove all inconsequential reports
  return ret;
}

/**
 * Return a success/failure conclusion from the given report
 */
export function combineConclusions(reports: PluginReportJson[]): PolicyValidationReportConclusion {
  const reportHasFailures = reports.some((r) => r.conclusion === 'failure');
  return reportHasFailures ? 'failure' : 'success';
}

/**
 * For operations that are NOT `cdk validate`, read the validation report and produce a failure if validation failed.
 *
 * Validation failed if there are any plugin reports with a failure conclusion, or if there are any warnings and the assembly is in strict mode.
 */
export async function throwIfValidationFailures(assembly: AssemblyLike, stacks: StackCollection, failAt: MinimumSeverity, ioHelper: IoHelper): Promise<void> {
  const pluginReports = await obtainUnifiedValidationReport(assembly, stacks);
  if (pluginReports.length === 0) {
    return;
  }

  const conclusion = combineConclusions(pluginReports);
  const result: ValidateResult = { conclusion, pluginReports };
  await ioHelper.notify(hostMessageFromValidation(result));


  switch (failAt) {
    case 'error':
      if (conclusion === 'failure') {
        const error = AssemblyError.withStacks('Found errors', stacks.stackArtifacts);
        error.attachSynthesisErrorCode('AnnotationErrors');
        throw error;
      }
      break;
    case 'warn':
      // if we're failing at 'warn', then both warnings and errors cause failure, so the initial conclusion is correct
      if (conclusion === 'failure' || hasWarnings(pluginReports)) {
        const error = AssemblyError.withStacks('Found warnings (--strict mode)', stacks.stackArtifacts);
        error.attachSynthesisErrorCode('StrictAnnotationWarnings');
        throw error;
      }

      break;
    case 'none':
      // if we're not failing at all, then the conclusion is always success
      break;
  }
}

function hasWarnings(reports: PluginReportJson[]): boolean {
  return reports.some((r) => r.violations.some((v) => v.severity === 'warning'));
}

/**
 * Remove violations that aren't in onde of the given stacks
 */
function filterReportsByStacks(reports: PluginReportJson[], selectedStackIds: Set<string>): PluginReportJson[] {
  return reports.map((report) => {
    const filteredViolations = report.violations.filter((violation) => {
      if (violation.violatingConstructs.length === 0) return true;
      return violation.violatingConstructs.some((c) =>
        selectedStackIds.has(c.constructPath?.split('/')[0] ?? ''),
      );
    }).map((violation) => {
      if (violation.violatingConstructs.length === 0) return violation;
      return {
        ...violation,
        violatingConstructs: violation.violatingConstructs.filter((c) =>
          selectedStackIds.has(c.constructPath?.split('/')[0] ?? ''),
        ),
      };
    });

    return {
      ...report,
      violations: filteredViolations,
      conclusion: filteredViolations.length > 0 ? report.conclusion : ('success' as const),
    };
  });
}