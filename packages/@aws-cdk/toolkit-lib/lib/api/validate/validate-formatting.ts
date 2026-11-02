import { relativeFileLocationRenderer, ValidationReportFormatter } from '@aws-cdk/cloud-assembly-api';
import type { PluginReportJson } from '@aws-cdk/cloud-assembly-schema';
import type { ValidateResult } from '../../actions/validate';
import type { ActionLessMessage } from '../io/private';
import { IO } from '../io/private';

export function hostMessageFromValidation(fileRoot: string, result: ValidateResult): ActionLessMessage<any> {
  // Always emit at info level so the CLI IoHost doesn't wrap the entire output
  // in a single color. The formatter handles per-severity coloring internally.
  // Consumers detect failure via the structured `data.conclusion` field or exit code.
  return IO.CDK_TOOLKIT_E9600.msg(formatValidateResult(fileRoot, result), result);
}

export function formatValidateResult(fileRoot: string, result: ValidateResult): string {
  return formatValidationReports(fileRoot, result.pluginReports).join('\n\n');
}

export function formatValidationReports(fileRoot: string, reports: PluginReportJson[]): string[] {
  return new ValidationReportFormatter({
    fileLocationRenderer: relativeFileLocationRenderer(fileRoot),
  }).formatReports(reports);
}
