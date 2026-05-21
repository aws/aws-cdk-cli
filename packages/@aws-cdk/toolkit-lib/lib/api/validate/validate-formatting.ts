import * as path from 'node:path';
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
  // Always emit at info level so the CLI IoHost doesn't wrap the entire output
  // in a single color. The formatter handles per-severity coloring internally.
  // Consumers detect failure via the structured `data.conclusion` field or exit code.
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
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function formatViolationBlock(v: FlattenedViolation): string {
  const lines: string[] = [];

  const location = getLeafLocation(v.construct.stackTraces);
  if (location) {
    lines.push(chalk.underline(location));
  }

  const severityColor = getSeverityColor(v.severity);
  const description = stripAckTag(v.description);
  const severityAndDesc = severityColor(chalk.bold(`${v.severity}: ${description}`));
  lines.push(`${severityAndDesc} ${v.pluginName}`);

  const constructInfo = formatConstructInfo(v.construct);
  lines.push(`   ${constructInfo}`);

  if (v.severity.toLowerCase() !== 'fatal') {
    const ackId = `${v.pluginName}::${v.ruleName}`.replace(/ /g, '-');
    lines.push(`   Acknowledge '${ackId}'`);
  }

  return lines.join('\n');
}

function getSeverityColor(severity: string): (str: string) => string {
  switch (severity.toLowerCase()) {
    case 'fatal': return chalk.red;
    case 'error': return chalk.ansi256(208);
    case 'warning': return chalk.yellow;
    default: return chalk.blue;
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

function stripAckTag(description: string): string {
  return description.replace(/\s*\[ack:\s*[^\]]+\]\s*/g, '').trim();
}

function getLeafLocation(stackTraces: string[] | undefined): string | undefined {
  if (!stackTraces || stackTraces.length === 0) return undefined;
  const lastTrace = stackTraces[stackTraces.length - 1];
  const frames = lastTrace.split('\n');
  if (frames.length === 0) return undefined;
  const leafFrame = frames[0].trim();
  const match = leafFrame.match(/\((.+)\)$/) || leafFrame.match(/at\s+(.+)$/);
  const location = match ? match[1] : leafFrame;
  return path.isAbsolute(location.split(':')[0]) ? path.relative(process.cwd(), location) : location;
}
