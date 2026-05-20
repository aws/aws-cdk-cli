import * as chalk from 'chalk';
import type { PluginReportJson, ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
import type { ValidateResult } from '../../actions/validate';
import type { ActionLessMessage } from '../io/private';
import { IO } from '../io/private';

interface FlattenedViolation {
  readonly severity: string;
  readonly description: string;
  readonly ruleName: string;
  readonly pluginName: string;
  readonly construct: ViolatingConstructJson;
}

const SEVERITY_ORDER: Record<string, number> = {
  fatal: 0,
  error: 1,
  warning: 2,
  info: 3,
};

export function hostMessageFromValidation(result: ValidateResult): ActionLessMessage<any> {
  return IO.CDK_TOOLKIT_I9600.msg(formatValidateResult(result), result);
}

export function formatValidateResult(result: ValidateResult): string {
  const violations = flattenViolations(result.pluginReports);

  if (violations.length === 0) {
    return 'Policy validation passed. No violations found.';
  }

  violations.sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity.toLowerCase()] ?? 4;
    const bOrder = SEVERITY_ORDER[b.severity.toLowerCase()] ?? 4;
    return aOrder - bOrder;
  });

  const blocks = violations.map((v) => formatViolationBlock(v));
  return blocks.join('\n\n');
}

function flattenViolations(pluginReports: PluginReportJson[]): FlattenedViolation[] {
  const result: FlattenedViolation[] = [];

  for (const report of pluginReports) {
    const pluginName = report.pluginName;

    for (const violation of report.violations) {
      const severity = normalizeSeverity(violation.severity);

      for (const construct of violation.violatingConstructs) {
        result.push({ severity, description: violation.description, ruleName: violation.ruleName, pluginName, construct });
      }
    }
  }

  return result;
}

function normalizeSeverity(severity: string | undefined): string {
  if (!severity) return 'Warning';
  const lower = severity.toLowerCase();
  if (lower === 'fatal') return 'Fatal';
  if (lower === 'error') return 'Error';
  if (lower === 'warning') return 'Warning';
  if (lower === 'info') return 'Info';
  return severity;
}

function formatViolationBlock(v: FlattenedViolation): string {
  const lines: string[] = [];

  const location = getLeafLocation(v.construct.stackTraces);
  if (location) {
    lines.push(location);
  }

  const severityColor = getSeverityColor(v.severity);
  const severityAndDesc = severityColor(chalk.bold(`${formatSeverityName(v.severity)} ${v.description}`));
  lines.push(`${severityAndDesc} ${v.pluginName}`);

  const constructInfo = formatConstructInfo(v.construct);
  lines.push(`   ${constructInfo}`);

  if (v.severity.toLowerCase() !== 'fatal') {
    const ackId = `${v.pluginName}::${v.ruleName}`;
    lines.push(`   Acknowledge '${ackId}'`);
  }

  return lines.join('\n');
}

function formatSeverityName(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'fatal': return 'Fatal';
    case 'error': return 'Error';
    case 'warning': return 'Warning';
    case 'info': return 'Info';
    default: return severity;
  }
}

function getSeverityColor(severity: string): (str: string) => string {
  switch (severity.toLowerCase()) {
    case 'fatal': return chalk.red;
    case 'error': return chalk.hex('#FFA500');
    case 'warning': return chalk.yellow;
    case 'info': return chalk.yellow;
    default: return chalk.yellow;
  }
}

function formatConstructInfo(construct: ViolatingConstructJson): string {
  const parts: string[] = [];
  const logicalId = construct.cloudFormationResource?.logicalId;

  if (construct.constructPath) {
    parts.push(logicalId ? `${chalk.bold(construct.constructPath)} (${logicalId})` : chalk.bold(construct.constructPath));
  } else if (logicalId) {
    parts.push(chalk.bold(logicalId));
  }

  if (construct.constructFqn) {
    parts.push(construct.constructFqn);
  }

  return parts.join(' ');
}

function getLeafLocation(stackTraces: string[] | undefined): string | undefined {
  if (!stackTraces || stackTraces.length === 0) return undefined;
  const lastTrace = stackTraces[stackTraces.length - 1];
  const frames = lastTrace.split('\n');
  if (frames.length === 0) return undefined;
  const leafFrame = frames[0];
  const match = leafFrame.match(/\((.+)\)$/);
  return match ? match[1] : leafFrame;
}
