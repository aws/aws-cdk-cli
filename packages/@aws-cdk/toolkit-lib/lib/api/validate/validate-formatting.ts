import * as chalk from 'chalk';
import type { ConstructTraceJson, PluginReportJson, ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
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
  // Always use info-level for the formatted output so the CLI doesn't wrap it in red.
  // The result payload carries the status for programmatic consumers.
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
    const pluginName = report.summary.pluginName;

    for (const violation of report.violations) {
      // severity may be a PolicyViolationSeverity instance or a raw string from JSON deserialization
      const rawSeverity = violation.severity as any;
      const severity = normalizeSeverity(typeof rawSeverity === 'string' ? rawSeverity : rawSeverity?.name);

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

  // Line 1: source location
  const location = getLeafLocation(v.construct.constructStack);
  if (location) {
    lines.push(location);
  }

  // Line 2: severity + description (bold together) + plugin name (plain)
  const severityColor = getSeverityColor(v.severity);
  const severityAndDesc = severityColor(chalk.bold(`${formatSeverityName(v.severity)} ${v.description}`));
  lines.push(`${severityAndDesc} ${v.pluginName}`);

  // Line 3: construct path (bold) + (logicalId) + construct FQN
  const constructInfo = formatConstructInfo(v.construct);
  lines.push(`   ${constructInfo}`);

  // Line 4: acknowledge instruction (omit for Fatal)
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

  if (construct.constructPath) {
    parts.push(`${chalk.bold(construct.constructPath)} (${construct.resourceLogicalId})`);
  } else {
    parts.push(chalk.bold(construct.resourceLogicalId));
  }

  const leaf = getLeafNode(construct.constructStack);
  if (leaf?.construct) {
    parts.push(leaf.construct);
  }

  return parts.join(' ');
}

function getLeafLocation(trace: ConstructTraceJson | undefined): string | undefined {
  if (!trace) return undefined;
  const leaf = getLeafNode(trace);
  if (!leaf?.location) return undefined;
  // Location is in format "new ClassName (file:line:col)" — extract just the file:line:col
  const match = leaf.location.match(/\((.+)\)$/);
  return match ? match[1] : leaf.location;
}

function getLeafNode(trace: ConstructTraceJson | undefined): ConstructTraceJson | undefined {
  if (!trace) return undefined;
  let node = trace;
  while (node.child) {
    node = node.child;
  }
  return node;
}
