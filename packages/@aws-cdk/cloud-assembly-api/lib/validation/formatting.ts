/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Format validation results in a human-friendly way, with per-severity coloring and construct information.
 *
 * Same formatting is used for both the CLI and the CDK app.
 */
import path from 'path';
import type { PluginReportJson, PolicyViolationJson, ViolatingConstructJson } from '@aws-cdk/cloud-assembly-schema';
import { Colorize } from '../private/color';
import type { IStackFrameFinder } from '../stack-trace';
import { DEFAULT_USER_CODE_FINDER, StackTrace } from '../stack-trace';
import { isSuppressibleViolation, namespaceFromPluginName, normalizeValidationId, parseValidationId, pluginNameFromNamespace } from './parsing';

export interface ValidationReportFormatterOptions {
  /**
   * Customize how to find the relevant stack frames in the source code for each violation.
   *
   * @default - Use the first stack frame that points to a source location
   */
  readonly frameFinder?: IStackFrameFinder;

  /**
   * Customize how file locations are rendered in the output.
   *
   * @default - Render paths relative to cwd
   */
  readonly fileLocationRenderer?: IFileLocationRenderer;
}

export class ValidationReportFormatter {
  private readonly fileLocationRenderer: IFileLocationRenderer;

  constructor(private readonly options: ValidationReportFormatterOptions) {
    this.fileLocationRenderer = options.fileLocationRenderer ?? relativeFileLocationRenderer(process.cwd());
  }

  public formatReports(reports: PluginReportJson[]): string[] {
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
      ...violations.map((v) => this.formatViolationBlock(v)),
    ];
  }

  private formatViolationBlock(v: FlattenedViolation): string {
    const lines: string[] = [];

    const locations = this.sourceLocations(v.construct.stackTraces);

    const maxTraces = 5;

    let additional = false;
    for (const location of locations.slice(0, maxTraces)) {
      lines.push(`${additional ? 'or ' : ''}${Colorize.underline(sanitize(location))}`);
      additional = true;
    }
    if (locations.length > maxTraces) {
      lines.push(Colorize.grey(`(and ${locations.length - maxTraces} more...)`));
    }

    const pluginNs = namespaceFromPluginName(v.pluginName);
    const parsed = parseValidationId(v.ruleName);

    lines.push([
      Colorize.bold(getSeverityColor(v.severity)(sanitize(v.severity))),
      Colorize.bold(stripAckTag(sanitize(v.description))),
      Colorize.grey(`(${sanitize(parsed.namespace ? pluginNameFromNamespace(parsed.namespace) : v.pluginName)})`),
    ].join(' '));

    const constructInfo = this.formatConstructInfo(v.construct);
    lines.push(`   ${constructInfo}`);

    if (v.suggestedFix) {
      lines.push(`   Suggested fix: ${sanitize(v.suggestedFix).replace(/\n/g, '\n   ')}`);
    }

    const ackId = normalizeValidationId(v.ruleName, pluginNs);
    if (isSuppressibleViolation(v)) {
      lines.push(`   ${Colorize.grey(`Acknowledge with '${sanitize(ackId)}'`)}`);
    } else {
      // If not acknowledgeable, we should still show the rule name for reference.
      lines.push(`   ${Colorize.grey(`Rule ${sanitize(ackId)}`)}`);
    }

    return lines.join('\n');
  }

  private sourceLocations(stackTraces: string[] | undefined): string[] {
    const ret: string[] = [];
    for (const trace of stackTraces ?? []) {
      const frame = StackTrace.fromNewlineSeparatedString(trace).findAndParse(this.options.frameFinder ?? DEFAULT_USER_CODE_FINDER);
      if (frame && frame.fileName) {
        const candidate = `${this.fileLocationRenderer.renderAbsoluteFilePath(frame.fileName)}:${frame.sourceLocation}`;

        // No duplicates
        if (!ret.includes(candidate)) {
          ret.push(candidate);
        }
      }
    }
    return ret;
  }

  private formatConstructInfo(construct: ViolatingConstructJson): string {
    const parts: string[] = [];
    const logicalId = sanitize(construct.cloudFormationResource?.logicalId);

    if (construct.constructPath) {
      const cPath = sanitize(construct.constructPath);
      parts.push(logicalId ? `${Colorize.bold(cPath)} (${logicalId})` : Colorize.bold(cPath));
    } else {
      // No construct information, show template path and logical ID
      if (construct.cloudFormationResource?.templatePath) {
        parts.push(this.fileLocationRenderer.renderAbsoluteFilePath(sanitize(construct.cloudFormationResource.templatePath)));
      }
      if (logicalId) {
        parts.push(Colorize.bold(logicalId));
      }
    }

    if (construct.constructFqn) {
      parts.push(Colorize.grey(sanitize(construct.constructFqn)));
    }

    return parts.join(' ');
  }
}

function flattenViolations(reports: PluginReportJson[]): FlattenedViolation[] {
  return reports.flatMap((report) => {
    const pluginName = report.pluginName;
    return report.violations.flatMap((violation) => {
      return violation.violatingConstructs.map((construct) => ({
        severity: normalizeSeverity(violation.severity),
        description: violation.description,
        ruleName: violation.ruleName,
        pluginName,
        construct,
        suggestedFix: violation.suggestedFix,
        ruleMetadata: violation.ruleMetadata,
      }));
    });
  });
}

function normalizeSeverity(severity: string | undefined): string {
  switch (severity?.toLowerCase()) {
    case 'fatal': return 'FATAL';
    case 'error': return 'ERROR';
    case 'warning': return 'WARNING';
    case 'info': return 'INFO';
  }
  if (!severity) return 'WARNING';
  return sanitize(severity);
}

function getSeverityColor(severity: string): (str: string) => string {
  switch (severity.toLowerCase()) {
    case 'fatal': return Colorize.red;
    case 'error': return Colorize.orange;
    case 'warning': return Colorize.yellow;
    default: return Colorize.blue;
  }
}

function stripAckTag(description: string): string {
  return description.replace(/\s*\[ack:\s*[^\]]+\]\s*/g, '').trim();
}

function formatPluginFailure(f: PluginError): string {
  return `${Colorize.orange('ERROR')} ${sanitize(f.error)}`;
}

// Matches C0 control chars (except \t and \n), DEL, and CSI (8-bit mode).
// Strips ANSI escape sequences, carriage returns, backspaces, BEL, and
// bidirectional overrides that could spoof terminal output.
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F\x9B]/g;
function sanitize(s: string | undefined): string {
  return (s ?? '').replace(CONTROL_CHARS, '�');
}

type FlattenedViolation =
  & Pick<PluginReportJson, 'pluginName'>
  & Pick<PolicyViolationJson, 'description' | 'ruleName' | 'suggestedFix' | 'ruleMetadata'>
  & { severity: string; construct: ViolatingConstructJson };

const SEVERITY_ORDER: Record<string, number> = {
  fatal: 0,
  error: 1,
  warning: 2,
  info: 3,
};

interface PluginError {
  readonly error: string;
}

function isPluginFailure(r: PluginReportJson): PluginError | undefined {
  if (r.conclusion === 'success' || r.violations.length > 0 || !r.metadata?.error) {
    return undefined;
  }
  return { error: r.metadata.error };
}

export function stripAnsi(x: string) {
  const pattern = [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
  ].join('|');

  const re = new RegExp(pattern, 'g');
  return x.replaceAll(re, '');
}

export interface IFileLocationRenderer {
  renderAbsoluteFilePath(filePath: string): string;
}

export function relativeFileLocationRenderer(root: string): IFileLocationRenderer {
  return {
    renderAbsoluteFilePath(absPath: string): string {
      const relPath = path.relative(root, absPath);
      return relPath.length < absPath.length ? relPath : absPath;
    },
  };
}
