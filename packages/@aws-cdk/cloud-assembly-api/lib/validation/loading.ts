import { promises as fs } from 'fs';
import * as path from 'path';
import { Manifest } from '@aws-cdk/cloud-assembly-schema';
import type * as cxschema from '@aws-cdk/cloud-assembly-schema';
import type { CloudFormationStackArtifact } from '../artifacts/cloudformation-artifact';
import { SynthesisMessageLevel } from '../metadata';
import { ANNOTATION_PLUGIN_NAME } from './parsing';

const VALIDATION_REPORT_FILE = 'validation-report.json';

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
export async function loadUnifiedValidationReport(
  assembly: AssemblyLike,
  stacks: CloudFormationStackArtifact[],
): Promise<cxschema.PluginReportJson[]> {
  const ret: cxschema.PluginReportJson[] = [];

  const reportPath = path.join(assembly.directory, VALIDATION_REPORT_FILE);
  if (await pathExists(reportPath)) {
    const selectedStackIds = new Set(stacks.map(stack => stack.hierarchicalId));
    const report = Manifest.loadValidationReport(reportPath);

    // Filter the report to only include violations for the selected stacks
    const filteredReports = filterReportsByStacks(report.pluginReports, selectedStackIds);
    ret.push(...filteredReports);
  }

  const alreadyHasAnnotations = ret.some((r) => r.pluginName === ANNOTATION_PLUGIN_NAME);
  if (!alreadyHasAnnotations) {
    const annotationReport = pluginReportFromAnnotations(stacks);
    if (annotationReport.violations.length > 0 || annotationReport.conclusion === 'failure') {
      ret.push(annotationReport);
    }
  }

  // Remove all inconsequential reports
  return ret;
}

/**
 * Report only violations that are in one of the given stacks
 */
function filterReportsByStacks(reports: cxschema.PluginReportJson[], selectedStackIds: Set<string>): cxschema.PluginReportJson[] {
  const stackIds = Array.from(selectedStackIds);

  return reports.map(filterReport);

  function filterReport(report: cxschema.PluginReportJson): cxschema.PluginReportJson {
    // Filter the violations of this report down. In order to be backwards compatible with previously established behavior,
    // if a violation has no constructs associated with it, we retain it. Otherwise, we remove it if it has no constructs left.
    const violationsWithoutConstructs = new Set(report.violations.flatMap((v, i) => v.violatingConstructs.length === 0 ? [i] : []));

    const filteredViolations = report
      .violations.map(v => ({
        ...v,
        violatingConstructs: v.violatingConstructs.filter(constructMatches),
      })).filter((v, i) => v.violatingConstructs.length > 0 || violationsWithoutConstructs.has(i));

    return {
      ...report,
      violations: filteredViolations,
      conclusion: filteredViolations.length > 0 ? report.conclusion : ('success' as const),
    };
  }

  function constructMatches(c: cxschema.ViolatingConstructJson) {
    //  If we don't have a construct path, we can't filter out this violation so we have to keep it.
    return !c.constructPath || stackIds.some((stackId) => c.constructPath === stackId || c.constructPath?.startsWith(`${stackId}/`));
  }
}

/**
 * Collect annotation metadata (warnings and errors) from the construct tree
 * and convert them into a NamedValidationPluginReport that can be merged
 * into the same report pipeline as plugin violations.
 *
 * Effectively the same as what happens here:
 * <https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/core/lib/private/collect-annotation-report.ts>
 */
function pluginReportFromAnnotations(stacks: CloudFormationStackArtifact[]): cxschema.PluginReportJson {
  // The return type requires that we combine violations by rule, so we have to group them first here.
  const ruleMap = new Map<string, cxschema.PolicyViolationJson>();

  for (const stack of stacks) {
    for (const entry of stack.messages) {
      let severity: cxschema.PolicyViolationSeverity | undefined;

      switch (entry.level) {
        case SynthesisMessageLevel.WARNING:
          severity = 'warning';
          break;
        case SynthesisMessageLevel.ERROR:
          severity = 'error';
          break;
        case SynthesisMessageLevel.INFO:
          severity = 'info';
          break;
      }

      const { message, ruleName } = splitDescriptionAndId(String(entry.entry.data));
      const ruleKey = `${ruleName}|${severity}|${message}`;
      let violation = ruleMap.get(ruleKey);
      if (!violation) {
        violation = {
          ruleName: ruleName ?? `${severity}-annotation`,
          description: message,
          severity,
          violatingConstructs: [],
          ruleMetadata: {
            'cdk:annotation': 'true',
          },
        };
        ruleMap.set(ruleKey, violation);
      }

      violation.violatingConstructs.push({
        constructPath: entry.id.replace(/^\//, ''), // remove leading slash

        // TODO: see if this information can be obtained from tree.json
        // cloudFormationResource
        // constructFqn:
        // libraryVersion

        // TODO: see if we can get this from metadata stack traces. We may need to re-enable them for
        // annotations in the core library. Otherwise we should probably get a stack trace to the resource itself.
        // stackTraces
      });
    }
  }

  const violations = Array.from(ruleMap.values());
  const hasErrors = violations.some(v => v.severity === 'error');
  return {
    pluginName: ANNOTATION_PLUGIN_NAME,
    conclusion: hasErrors ? 'failure' : 'success',
    violations,
  };
}

/**
 * Annotations have IDs in two places:
 *
 * - Warnings have `[ack:<id>]` in the message.
 * - Errors have `(<namespace>::<id>)` in the message.
 *
 * Separate the rule name from the rest of the description.
 */
function splitDescriptionAndId(message: string): { message: string; ruleName?: string } {
  const ackMatch = message.match(/\[ack: ([^\]]+)\]/);
  if (ackMatch) {
    return { message: message.replace(ackMatch[0], '').trim(), ruleName: ackMatch[1] };
  }

  const idMatch = message.match(/\(([^()]+::[^()]+)\)$/);
  if (idMatch) {
    return { message: message.replace(idMatch[0], '').trim(), ruleName: idMatch[1] };
  }

  return { message };
}

async function pathExists(pathName: string) {
  try {
    await fs.access(pathName);
    return true;
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
    return false;
  }
}
