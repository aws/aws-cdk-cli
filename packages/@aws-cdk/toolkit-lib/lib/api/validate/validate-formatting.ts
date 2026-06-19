import * as path from 'node:path';
import type { PluginReportJson, PolicyViolationJson, ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
import * as chalk from 'chalk';
import type { ValidateResult } from '../../actions/validate';
import type { ActionLessMessage } from '../io/private';
import { IO } from '../io/private';

export function hostMessageFromValidation(fileRoot: string, result: ValidateResult): ActionLessMessage<any> {
  // Always emit at info level so the CLI IoHost doesn't wrap the entire output
  // in a single color. The formatter handles per-severity coloring internally.
  // Consumers detect failure via the structured `data.conclusion` field or exit code.
  return IO.CDK_TOOLKIT_I9600.msg(formatValidateResult(fileRoot, result), result);
}

export function formatValidateResult(fileRoot: string, result: ValidateResult): string {
  return formatValidationReports(fileRoot, result.pluginReports).join('\n\n')
}

export function formatValidationReports(fileRoot: string, reports: PluginReportJson[]): string[] {
  const successfullyExecutedPlugins = reports.filter((r) => isPluginFailure(r) === undefined);
  const pluginFailures = reports.map(isPluginFailure).filter((e) => e !== undefined);

  const violations = flattenViolations(successfullyExecutedPlugins);

  violations.sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity.toLowerCase()] ?? 4;
    const bOrder = SEVERITY_ORDER[b.severity.toLowerCase()] ?? 4;
    return aOrder - bOrder;
  });

  return [
    ...pluginFailures.map(formatPluginFailure),
    ...violations.map((v) => formatViolationBlock(fileRoot, v)),
  ];
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
  const safe = sanitize(severity);
  return safe.charAt(0).toUpperCase() + safe.slice(1);
}

function formatViolationBlock(fileRoot: string, v: FlattenedViolation): string {
  const lines: string[] = [];

  const location = sourceLocation(fileRoot, v.construct.stackTraces);
  if (location) {
    lines.push(chalk.underline(sanitize(location)));
  }

  lines.push([
    chalk.bold(getSeverityColor(v.severity)(sanitize(v.severity))),
    chalk.bold(stripAckTag(sanitize(v.description))),
    chalk.grey(`(${sanitize(v.pluginName)})`),
  ].join(' '));

  const constructInfo = formatConstructInfo(fileRoot, v.construct);
  lines.push(`   ${constructInfo}`);

  if (v.suggestedFix) {
    lines.push(`   Suggested fix: ${sanitize(v.suggestedFix).replace(/\n/g, '\n   ')}`);
  }

  if (isSuppressibleViolation(v)) {
    const ackId = `${sanitize(v.pluginName)}::${sanitize(v.ruleName)}`.replace(/ /g, '-');
    lines.push(`   ${chalk.grey(`Acknowledge with '${ackId}'`)}`);
  } else {
    // If not acknowledgeable, we should still show the rule name for reference.
    lines.push(`   ${chalk.grey(`Rule ${sanitize(v.ruleName)}`)}`);
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

function formatPluginFailure(f: PluginError): string {
  return `${chalk.ansi256(208)('ERROR')} ${sanitize(f.error)}`;
}

function formatConstructInfo(fileRoot: string, construct: ViolatingConstructJson): string {
  const parts: string[] = [];
  const logicalId = sanitize(construct.cloudFormationResource?.logicalId);

  if (construct.constructPath) {
    const cPath = sanitize(construct.constructPath);
    parts.push(logicalId ? `${chalk.bold(cPath)} (${logicalId})` : chalk.bold(cPath));
  } else {
    // No construct information, show template path and logical ID
    if (construct.cloudFormationResource?.templatePath) {
      parts.push(humanFriendlyFilename(fileRoot, sanitize(construct.cloudFormationResource.templatePath)));
    }
    if (logicalId) {
      parts.push(chalk.bold(logicalId));
    }
  }

  if (construct.constructFqn) {
    parts.push(chalk.grey(sanitize(construct.constructFqn)));
  }

  return parts.join(' ');
}

function stripAckTag(description: string): string {
  return description.replace(/\s*\[ack:\s*[^\]]+\]\s*/g, '').trim();
}

function sourceLocation(fileRoot: string, stackTraces: string[] | undefined): string | undefined {
  for (const trace of stackTraces ?? []) {
    const frame = getLeafLocation(trace);
    if (frame && frame.fileName) {
      return `${humanFriendlyFilename(fileRoot, frame.fileName)}:${frame.sourceLocation}`;
    }
  }
  return undefined;
}

function getLeafLocation(stackTrace: string) {
  const frames = stackTrace.split('\n');
  if (frames.length === 0) return undefined;

  // Find the first frame that's user code (not in node_modules or aws-cdk-lib)
  const userFrame = frames.find(f => !f.includes('node_modules') && !f.includes('aws-cdk-lib'));
  const frame = (userFrame ?? frames[0]).trim();

  const match = frame.match(/\((.+)\)$/) || frame.match(/at\s+(.+)$/);
  const location = match ? match[1] : frame;
  return { fileName: location.split(':')[0], sourceLocation: location.split(':').slice(1).join(':') };
}

// Matches C0 control chars (except \t and \n), DEL, and CSI (8-bit mode).
// Strips ANSI escape sequences, carriage returns, backspaces, BEL, and
// bidirectional overrides that could spoof terminal output.
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F\x9B]/g;
function sanitize(s: string | undefined): string {
  return (s ?? '').replace(CONTROL_CHARS, '�');
}

export type FlattenedViolation =
  & Pick<PluginReportJson, 'pluginName'>
  & Pick<PolicyViolationJson, 'description' | 'ruleName' | 'suggestedFix' | 'ruleMetadata'>
  & { severity: string; construct: ViolatingConstructJson };

const SEVERITY_ORDER: Record<string, number> = {
  fatal: 0,
  error: 1,
  warning: 2,
  info: 3,
};

export function humanFriendlyFilename(root: string, filename: string): string {
  const absPath = filename;
  const relPath = path.relative(root, filename);
  return relPath.length < absPath.length ? relPath : absPath;
}

interface PluginError {
  readonly error: string;
}

function isPluginFailure(r: PluginReportJson): PluginError | undefined {
  if (r.conclusion === 'success' || r.violations.length > 0 || !r.metadata?.error) {
    return undefined;
  }
  return { error: r.metadata.error };
}

/**
 * Report whether it is possible to suppress this violation.
 *
 * Violations that are reported as "fatal", or that have been converted from annotations, cannot be suppressed.
 */
function isSuppressibleViolation(violation: { severity?: string; ruleMetadata?: { [key: string]: string } }): boolean {
  const isFatal = violation.severity?.toLowerCase() === 'fatal';
  const isErrorAnnotation = violation.ruleMetadata?.['cdk:annotation'] && violation.severity?.toLowerCase() === 'error';
  return !isFatal && !isErrorAnnotation;
}
