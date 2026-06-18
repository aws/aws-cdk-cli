import { sideBySide, wrapText } from './format-utils';
import type { DiagnosedStack, StackDiagnosis, StackProblemSource, TracedResourceError } from '../../actions/diagnose';
import { DeploymentError, ToolkitError } from '../../toolkit/toolkit-error';
import { sortByKey } from '../../util';
import type { ActionLessMessage } from '../io/private';
import { IO } from '../io/private';

/**
 * Turn the given stack diagnosis result into an IO message, with default message formatting
 *
 * The default message formatting is what the CLI will print.
 */
export function hostMessageFromDiagnosis(stack: DiagnosedStack): ActionLessMessage<any> {
  const diagnosis = stack.result;

  switch (diagnosis.type) {
    case 'no-problem':
      return IO.CDK_TOOLKIT_I9500.msg(formatNoProblemStack(stack, diagnosis), stack);

    case 'problem':
      return IO.CDK_TOOLKIT_E9500.msg(formatProblemStack(stack, diagnosis), stack);

    case 'error-diagnosing':
      return IO.CDK_TOOLKIT_W9501.msg(formatDiagnosisErrorStack(stack, diagnosis), stack);
  }
}

/**
 * Turn the given diagnosis into a DeploymentError
 */
export function throwDeploymentErrorFromDiagnosis(diag: StackDiagnosis): never {
  switch (diag.type) {
    case 'no-problem':
      throw new ToolkitError('DeploymentErrorNotError', 'Diagnosis should represent an error, but does not');

    case 'error-diagnosing':
      throw new DeploymentError(diag.message, 'ErrorDiagnosisFailed');
  }
  // Guaranteed 'type=problem' here

  const errorCode = diag.problems[0]?.errorCode;
  let defaultErrorCode;
  switch (diag.detectedBy.type) {
    case 'change-set':
      defaultErrorCode = 'ChangeSetCreationFailed';
      break;

    case 'early-validation':
      defaultErrorCode = 'EarlyValidationFailure';
      break;

    case 'deployment':
      defaultErrorCode = 'StackDeployFailed';
      break;
  }

  throw new DeploymentError(formatProblemDiagnosis(diag), errorCode ?? defaultErrorCode);
}

function formatProblemDiagnosis(diag: Extract<StackDiagnosis, { type: 'problem' }>): string {
  switch (diag.detectedBy.type) {
    case 'change-set':
      return formatChangeSetProblems(diag.problems, diag.detectedBy);

    case 'early-validation':
      return formatEarlyValidationProblems(diag.problems, diag.detectedBy);

    case 'deployment':
      return formatDeploymentProblems(diag.problems, diag.detectedBy);
  }
}

function formatChangeSetProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'change-set' }>): string {
  const caption = `Failed to create change set ${detectedBy.changeSetName}`;

  if (problems.length > 0) {
    return `${caption}:\n${formatResourceErrors(problems)}`;
  } else {
    return `${caption}: ${detectedBy.statusReason}`;
  }
}

function formatEarlyValidationProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'early-validation' }>): string {
  const caption = `Early validation failed for change set ${detectedBy.changeSetName}`;
  if (problems.length > 0) {
    return `${caption}:\n${formatResourceErrors(problems)}`;
  } else {
    return caption;
  }
}

function formatDeploymentProblems(problems: TracedResourceError[], detectedBy: Extract<StackProblemSource, { type: 'deployment' }>): string {
  const caption = 'Resource updates failed';

  if (problems.length > 0) {
    return `${caption}:\n${formatResourceErrors(problems)}`;
  } else {
    return `${caption} (${detectedBy.stackStatus}): ${detectedBy.statusReason}`;
  }
}

function formatNoProblemStack(stack: DiagnosedStack, _m: Extract<StackDiagnosis, { type: 'no-problem' }>) {
  // TODO: print stack by construct path, not name
  return `✅ Stack ${stack.stackName}: no issues found.`;
}

function formatProblemStack(stack: DiagnosedStack, m: Extract<StackDiagnosis, { type: 'problem' }>) {
  // TODO: print stack by construct path, not name
  return `❌ Stack ${stack.stackName}:\n${formatProblemDiagnosis(m)}`;
}

function formatDiagnosisErrorStack(stack: DiagnosedStack, m: Extract<StackDiagnosis, { type: 'error-diagnosing' }>) {
  // TODO: print stack by construct path, not name
  return `⚠️ Could not diagnose stack ${stack.stackName}: ${m.message}`;
}

/**
 * Render the resource errors as a flat list of labeled blocks (one per failed resource),
 * in the same style as policy validation reporting.
 *
 * Each block is the resource location header, the error message, an optional source
 * location, and any additional diagnostic context (e.g. ECS stopped-task reasons,
 * CloudWatch logs) rendered as indented sub-sections. Blocks are separated by a blank
 * line.
 */
function formatResourceErrors(es: TracedResourceError[]): string {
  sortByKey(es, (e) => [locateResourceError(e)]);

  // Group by resource location so multiple errors for the same resource render as a single
  // block.
  const byLocation = new Map<string, TracedResourceError[]>();
  for (const e of es) {
    const key = locateResourceError(e);
    (byLocation.get(key) ?? byLocation.set(key, []).get(key)!).push(e);
  }

  const blocks = [...byLocation.values()].map((group) => formatResourceErrorBlock(group));
  return blocks.join('\n\n');
}

const CONTEXT_INDENT = '   ';

/**
 * Render one resource's worth of errors as a labeled block: a single location header, an
 * indented line per error message, an optional source location, and any additional
 * diagnostic context (e.g. ECS stopped-task reasons, CloudWatch logs) as indented lines.
 *
 * The context messages are self-describing
 * (e.g. "Task stopped: ..."). Links are prefixed with a short leader word
 * (e.g. "Tasks:", "Logs:") to distinguish them when more than one is present.
 */
function formatResourceErrorBlock(group: TracedResourceError[]): string {
  const first = group[0];
  const lines: string[] = [];

  lines.push(`${locateResourceError(first)}  ${addendum(' ', first.resourceType, first.logicalId)}`.trim());

  for (const e of group) {
    lines.push(...sideBySide(['  '], '', wrapText(120, e.message)));
  }

  const sourceTrace = group.find((e) => e.sourceTrace?.creationStackTrace)?.sourceTrace;
  if (sourceTrace?.creationStackTrace) {
    lines.push(...sideBySide(['Source Location:'], ' ', sourceTrace.creationStackTrace));
  }

  for (const e of group) {
    for (const ctx of e.additionalContext ?? []) {
      lines.push('');
      for (const msg of ctx.messages) {
        lines.push(`${CONTEXT_INDENT}${msg}`);
      }
      if (ctx.link) {
        const leader = ctx.linkLabel ? `${ctx.linkLabel}: ` : '';
        lines.push(`${CONTEXT_INDENT}${leader}${ctx.link}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Return a /-separated construct path for the given error, or try to build as close a represention as possible if we don't have a construct path
 *
 * The root will be the "app"
 */
function locateResourceError(e: TracedResourceError): string {
  if (e.sourceTrace?.constructPath) {
    return e.sourceTrace?.constructPath;
  }

  const nestedStackParts = e.parentStackLogicalIds.map((l) => `Nested stack ${l}`);
  if (e.logicalId) {
    return [e.topLevelStackHierarchicalId, ...nestedStackParts, e.logicalId].join('/');
  }
  // No logical ID means we are targeting the stack itself
  return [e.topLevelStackHierarchicalId, nestedStackParts].join('/');
}

function addendum(sep: string, ...xs: Array<string | undefined>): string {
  xs = xs.filter(x => x && typeof x === 'string');
  if (xs.length > 0) {
    return `(${xs.join(sep)})`;
  } else {
    return '';
  }
}
