import * as chalk from 'chalk';
import type { ConstructTraceJson, PluginReportJson, PolicyViolationJson, ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
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
};

export function hostMessageFromValidation(result: ValidateResult): ActionLessMessage<any> {
  if (result.status === 'failure') {
    return IO.CDK_TOOLKIT_E9600.msg(formatValidateResult(result), result);
  }
  return IO.CDK_TOOLKIT_I9600.msg(formatValidateResult(result), result);
}

export function formatValidateResult(result: ValidateResult): string {
  const violations = flattenViolations(result.pluginReports);

  if (violations.length === 0) {
    return 'Policy validation passed. No violations found.';
  }

  violations.sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity.toLowerCase()] ?? 2;
    const bOrder = SEVERITY_ORDER[b.severity.toLowerCase()] ?? 2;
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
      const severity = normalizeSeverity(violation.severity);

      if (violation.violatingConstructs.length > 0) {
        for (const construct of violation.violatingConstructs) {
          result.push({ severity, description: violation.description, ruleName: violation.ruleName, pluginName, construct });
        }
      } else {
        // Fall back to violatingResources if no constructs
        for (const resource of violation.violatingResources) {
          result.push({
            severity,
            description: violation.description,
            ruleName: violation.ruleName,
            pluginName,
            construct: {
              resourceLogicalId: resource.resourceLogicalId,
              templatePath: resource.templatePath,
              locations: resource.locations,
            },
          });
        }
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
  return 'Warning';
}

function formatViolationBlock(v: FlattenedViolation): string {
  const lines: string[] = [];

  // Line 1: source location
  const location = getLeafLocation(v.construct.constructStack);
  if (location) {
    lines.push(chalk.dim(location));
  }

  // Line 2: severity + description + plugin name
  const severityLabel = formatSeverityLabel(v.severity);
  const pluginLabel = chalk.dim(v.pluginName);
  lines.push(`  ${severityLabel} ${v.description}  ${pluginLabel}`);

  // Line 3: construct path + (logicalId) + construct FQN
  const constructInfo = formatConstructInfo(v.construct);
  lines.push(`    ${chalk.dim(constructInfo)}`);

  // Line 4: acknowledge instruction (omit for Fatal)
  if (v.severity.toLowerCase() !== 'fatal') {
    const ackId = `${v.pluginName}::${v.ruleName}`;
    lines.push(`    ${chalk.dim(`Acknowledge '${ackId}'`)}`);
  }

  return lines.join('\n');
}

function formatSeverityLabel(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'fatal':
      return chalk.red.bold('Fatal');
    case 'error':
      return chalk.red('Error');
    case 'warning':
      return chalk.yellow('Warning');
    default:
      return chalk.yellow('Warning');
  }
}

function formatConstructInfo(construct: ViolatingConstructJson): string {
  const parts: string[] = [];

  if (construct.constructPath) {
    parts.push(`${construct.constructPath} (${construct.resourceLogicalId})`);
  } else {
    parts.push(construct.resourceLogicalId);
  }

  const leaf = getLeafNode(construct.constructStack);
  if (leaf?.construct) {
    parts.push(` ${leaf.construct}`);
  }

  return parts.join(' ');
}

function getLeafLocation(trace: ConstructTraceJson | undefined): string | undefined {
  if (!trace) return undefined;
  const leaf = getLeafNode(trace);
  return leaf?.location;
}

function getLeafNode(trace: ConstructTraceJson | undefined): ConstructTraceJson | undefined {
  if (!trace) return undefined;
  let node = trace;
  while (node.child) {
    node = node.child;
  }
  return node;
}
